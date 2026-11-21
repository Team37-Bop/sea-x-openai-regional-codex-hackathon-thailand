#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REGION=${AWS_REGION:-us-east-1}
EXPECTED_ACCOUNT_ID=${EXPECTED_AWS_ACCOUNT_ID:-${TF_VAR_expected_account_id:-}}

command -v gh >/dev/null || { echo 'GitHub CLI (gh) is required.' >&2; exit 1; }
gh auth status >/dev/null
cd "$ROOT"
REPOSITORY=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}

if [[ ! "$EXPECTED_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
  echo 'Set EXPECTED_AWS_ACCOUNT_ID (or TF_VAR_expected_account_id) to the intended 12-digit AWS account ID.' >&2
  exit 1
fi
account=$(aws sts get-caller-identity --query Account --output text)
if [[ "$account" != "$EXPECTED_ACCOUNT_ID" ]]; then
  echo 'Refusing GitHub configuration: authenticated AWS account does not match EXPECTED_AWS_ACCOUNT_ID.' >&2
  exit 1
fi

role=$(terraform -chdir="$ROOT/terraform/bootstrap" output -raw github_deploy_role_arn)
bucket=$(terraform -chdir="$ROOT/terraform/bootstrap" output -raw terraform_state_bucket)
key=$(terraform -chdir="$ROOT/terraform/bootstrap" output -raw terraform_state_key)

gh variable set AWS_DEPLOY_ROLE_ARN --repo "$REPOSITORY" --body "$role"
gh variable set AWS_ACCOUNT_ID --repo "$REPOSITORY" --body "$account"
gh variable set AWS_REGION --repo "$REPOSITORY" --body "$REGION"
gh variable set TF_STATE_BUCKET --repo "$REPOSITORY" --body "$bucket"
gh variable set TF_STATE_KEY --repo "$REPOSITORY" --body "$key"
gh variable set WAF_MODE --repo "$REPOSITORY" --body "count"

echo "Configured GitHub Actions variables for $REPOSITORY and the expected AWS account."
