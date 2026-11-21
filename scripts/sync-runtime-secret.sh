#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REGION=${AWS_REGION:-us-east-1}
ENV_FILE=${1:-"$ROOT/.env.local"}
SECRET_ID=${2:-}
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

if [[ -z "$SECRET_ID" ]]; then
  SECRET_ID=$(terraform -chdir="$ROOT/terraform/app" output -raw runtime_secret_arn)
fi

cd "$ROOT"
umask 077
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

node --input-type=module - "$ENV_FILE" "$tmp" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { runtimeSecretKeys } from './server/runtime-secrets.mjs';

const [envFile, output] = process.argv.slice(2);
const source = parseEnv(readFileSync(envFile, 'utf8'));
const allowed = new Set(runtimeSecretKeys());
const selected = Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key) && value));
if (!Object.keys(selected).length) {
  console.error('No supported runtime secret values were found.');
  process.exit(2);
}
writeFileSync(output, JSON.stringify(selected), { mode: 0o600 });
console.log(`Prepared ${Object.keys(selected).length} secret fields (values withheld).`);
NODE

# PutSecretValue never returns SecretString. Keep the full response out of logs anyway.
version_id=$(aws secretsmanager put-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_ID" \
  --secret-string "file://$tmp" \
  --query VersionId \
  --output text)
printf 'Stored a new AWSCURRENT secret version (%s).\n' "$version_id"
