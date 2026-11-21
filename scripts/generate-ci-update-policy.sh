#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_ACCOUNT_ID=${EXPECTED_AWS_ACCOUNT_ID:-${TF_VAR_expected_account_id:-}}
OUTPUT="$ROOT/terraform/bootstrap/generated"

if [[ ! "$EXPECTED_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
  echo 'Set EXPECTED_AWS_ACCOUNT_ID (or TF_VAR_expected_account_id) to the intended 12-digit AWS account ID.' >&2
  exit 1
fi
account=$(aws sts get-caller-identity --query Account --output text)
if [[ "$account" != "$EXPECTED_ACCOUNT_ID" ]]; then
  echo 'Refusing policy generation: authenticated AWS account does not match EXPECTED_AWS_ACCOUNT_ID.' >&2
  exit 1
fi

umask 077
state=$(mktemp)
trap 'rm -f "$state"' EXIT
terraform -chdir="$ROOT/terraform/app" show -json > "$state"
node "$ROOT/scripts/generate-ci-update-policy.mjs" "$state" "$OUTPUT"
echo 'Generated update-only policies. Infrastructure creation and destructive data operations remain SSO-admin tasks.'
