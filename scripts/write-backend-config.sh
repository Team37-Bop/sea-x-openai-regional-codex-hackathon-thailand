#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BOOTSTRAP_DIR="$ROOT/terraform/bootstrap"
APP_OUTPUT="$ROOT/terraform/app/backend.hcl"
BOOTSTRAP_OUTPUT="$BOOTSTRAP_DIR/backend.hcl"
PROJECT_TAG=${TF_VAR_project_tag:-sea-openai}
ENVIRONMENT=${TF_VAR_environment:-prod}
region=${AWS_REGION:-us-east-1}

bucket=${TF_STATE_BUCKET:-}
app_key=${TF_STATE_KEY:-}
if [[ -z "$bucket" && -f "$APP_OUTPUT" ]]; then
  bucket=$(sed -nE 's/^bucket[[:space:]]*=[[:space:]]*"([^"]+)"/\1/p' "$APP_OUTPUT")
  app_key=$(sed -nE 's/^key[[:space:]]*=[[:space:]]*"([^"]+)"/\1/p' "$APP_OUTPUT")
fi
if [[ -z "$bucket" ]] && command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  cd "$ROOT"
  REPOSITORY=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
  bucket=$(gh variable get TF_STATE_BUCKET --repo "$REPOSITORY" 2>/dev/null || true)
  app_key=$(gh variable get TF_STATE_KEY --repo "$REPOSITORY" 2>/dev/null || true)
fi
if [[ -z "$bucket" ]]; then
  echo 'Set TF_STATE_BUCKET or configure the GitHub TF_STATE_BUCKET repository variable.' >&2
  exit 1
fi
app_key=${app_key:-$PROJECT_TAG/$ENVIRONMENT/terraform.tfstate}

umask 077
write_backend() {
  local output=$1 key=$2
  cat > "$output" <<EOF
bucket       = "$bucket"
key          = "$key"
region       = "$region"
encrypt      = true
use_lockfile = true
EOF
  chmod 600 "$output"
}
write_backend "$APP_OUTPUT" "$app_key"
write_backend "$BOOTSTRAP_OUTPUT" "$PROJECT_TAG/$ENVIRONMENT/bootstrap.tfstate"
echo 'Wrote gitignored backend configurations for application and bootstrap state.'
