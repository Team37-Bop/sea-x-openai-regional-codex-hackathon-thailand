#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPOSITORY=${GITHUB_REPOSITORY:-222-KPR/sea-x-openai-regional-codex-hackathon-thailand}
PROFILE=${AWS_PROFILE:-com7business-ruchida}
REGION=${AWS_REGION:-us-east-1}
EXPECTED_SUFFIX=${EXPECTED_ACCOUNT_SUFFIX:-0081}

command -v gh >/dev/null || { echo 'GitHub CLI (gh) is required.' >&2; exit 1; }
gh auth status >/dev/null

account=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
if [[ ${account: -4} != "$EXPECTED_SUFFIX" ]]; then
  echo "Refusing GitHub configuration outside the account ending in $EXPECTED_SUFFIX." >&2
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

echo "Configured GitHub Actions variables for $REPOSITORY and account ending in $EXPECTED_SUFFIX."
