#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROFILE=${AWS_PROFILE:-com7business-ruchida}
EXPECTED_SUFFIX=${EXPECTED_ACCOUNT_SUFFIX:-0081}
OUTPUT="$ROOT/terraform/bootstrap/generated"

account=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
if [[ ${account: -4} != "$EXPECTED_SUFFIX" ]]; then
  echo "Refusing policy generation outside account ending in $EXPECTED_SUFFIX." >&2
  exit 1
fi

umask 077
state=$(mktemp)
trap 'rm -f "$state"' EXIT
AWS_PROFILE="$PROFILE" terraform -chdir="$ROOT/terraform/app" show -json > "$state"
node "$ROOT/scripts/generate-ci-update-policy.mjs" "$state" "$OUTPUT"
echo 'Generated update-only policies. Infrastructure creation and destructive data operations remain SSO-admin tasks.'
