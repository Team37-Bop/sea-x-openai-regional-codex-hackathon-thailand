#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
echo 'generate-deploy-policy.sh now delegates to the scoped update-only policy generator.'
exec "$ROOT/scripts/generate-ci-update-policy.sh" "$@"
