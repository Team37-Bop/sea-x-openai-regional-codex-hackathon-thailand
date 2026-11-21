#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REGION=${AWS_REGION:-us-east-1}
ENV_FILE=${1:-"$ROOT/.env.local"}
EXPECTED_SECRET_ARN=${2:-}
EXPECTED_ACCOUNT_ID=${EXPECTED_AWS_ACCOUNT_ID:-${TF_VAR_expected_account_id:-}}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

if [[ ! "$EXPECTED_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
  echo 'Set EXPECTED_AWS_ACCOUNT_ID (or TF_VAR_expected_account_id) to the intended 12-digit AWS account ID.' >&2
  exit 1
fi
account=$(aws sts get-caller-identity --query Account --output text)
if [[ "$account" != "$EXPECTED_ACCOUNT_ID" ]]; then
  echo 'Refusing secret update: authenticated AWS account does not match EXPECTED_AWS_ACCOUNT_ID.' >&2
  exit 1
fi

# This output always identifies the Terraform-managed secret. The active read
# source may belong to another application and must never be a write target.
SECRET_ID=$(terraform -chdir="$ROOT/terraform/app" output -raw runtime_secret_arn)
if [[ -n "$EXPECTED_SECRET_ARN" && "$EXPECTED_SECRET_ARN" != "$SECRET_ID" ]]; then
  echo 'Refusing secret update: the supplied ARN differs from the application-owned secret.' >&2
  exit 1
fi

if [[ "$SECRET_ID" != arn:*:secretsmanager:"$REGION":"$EXPECTED_ACCOUNT_ID":secret:?* ]]; then
  echo 'Refusing secret update: the application-owned secret ARN is outside the expected region or account.' >&2
  exit 1
fi
# Keep relative input paths relative to the caller when resolving project modules.
if [[ "$ENV_FILE" != /* ]]; then ENV_FILE="$PWD/$ENV_FILE"; fi
cd "$ROOT"

node --input-type=module - "$ENV_FILE" "$SECRET_ID" "$REGION" <<'NODE'
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import {
  DescribeSecretCommand, GetSecretValueCommand, PutSecretValueCommand,
  SecretsManagerClient, UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';
import { isMissingCurrentVersion, runtimeSecretKeys } from './server/runtime-secrets.mjs';

class InvalidSecret extends Error {}

const [envFile, secretId, region] = process.argv.slice(2);
const client = new SecretsManagerClient({ region });
const source = parseEnv(readFileSync(envFile, 'utf8'));
const updates = Object.fromEntries(runtimeSecretKeys()
  .filter(key => source[key]?.trim())
  .map(key => [key, source[key]]));
if (!Object.keys(updates).length) throw new Error('No supported non-empty runtime fields were found.');

async function readCurrent() {
  let response;
  try {
    response = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: 'AWSCURRENT' }));
  } catch (error) {
    if (!isMissingCurrentVersion(error)) throw error;
    const metadata = await client.send(new DescribeSecretCommand({ SecretId: secretId }));
    if (Object.keys(metadata.VersionIdsToStages || {}).length) {
      throw new InvalidSecret('Secret has staged versions but no current version. Resolve its staging labels before syncing.');
    }
    return { version: undefined, values: {} };
  }
  let values;
  try { values = JSON.parse(response.SecretString); }
  catch { throw new InvalidSecret('Current secret must contain a JSON object of strings.'); }
  if (!response.VersionId || values === null || typeof values !== 'object' || Array.isArray(values) ||
      Object.values(values).some(value => typeof value !== 'string')) {
    throw new InvalidSecret('Current secret must contain a JSON object of strings and have a version ID.');
  }
  return { version: response.VersionId, values };
}

try {
  const { version, values } = await readCurrent();
  if (updates.OPENAI_API_KEY && updates.OPENAI_APIKEY && updates.OPENAI_API_KEY !== updates.OPENAI_APIKEY) {
    throw new InvalidSecret('The two OpenAI key aliases in the input file disagree.');
  }
  // Either spelling rotates the same credential if the other spelling is already stored.
  const openai = updates.OPENAI_API_KEY || updates.OPENAI_APIKEY;
  if (openai) {
    for (const key of ['OPENAI_API_KEY', 'OPENAI_APIKEY']) {
      if (Object.hasOwn(values, key)) updates[key] = openai;
    }
  }
  if (Object.entries(updates).every(([key, value]) => values[key] === value)) {
    console.log('Current runtime secret already contains the supplied fields.');
  } else {
    const id = randomUUID();
    const label = `bop-sync-${id}`;
    await client.send(new PutSecretValueCommand({
      SecretId: secretId, ClientRequestToken: id, VersionStages: [label],
      SecretString: JSON.stringify({ ...values, ...updates }),
    }));
    try {
      // AWS verifies the previous holder of AWSCURRENT. A competing writer must retry the merge.
      await client.send(new UpdateSecretVersionStageCommand({
        SecretId: secretId, VersionStage: 'AWSCURRENT', MoveToVersionId: id, RemoveFromVersionId: version,
      }));
    } finally {
      await client.send(new UpdateSecretVersionStageCommand({
        SecretId: secretId, VersionStage: label, RemoveFromVersionId: id,
      }));
    }
    console.log('Updated the current runtime secret.');
  }
} catch (error) {
  // Only print fixed validation messages and SDK error codes, never request details.
  const code = /^[A-Za-z0-9_]+$/.test(error.name) ? error.name : 'Error';
  console.error(error instanceof InvalidSecret ? error.message :
    `Secrets Manager sync failed (${code}). Check version stages and permissions before retrying.`);
  process.exitCode = 1;
} finally {
  client.destroy();
}
NODE
