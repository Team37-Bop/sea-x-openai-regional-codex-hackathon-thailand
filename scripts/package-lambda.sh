#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BUILD_ROOT="$ROOT/.build"
PACKAGE_DIR="$BUILD_ROOT/lambda"

cd "$ROOT"

npm ci
npm test
npm run build
if [[ ! -s "$ROOT/dist/assets/maplibre-gl-worker.mjs" ]]; then
  echo 'MapLibre worker asset is missing from the production build.' >&2
  exit 1
fi
npm audit --omit=dev --audit-level=high

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/server" "$PACKAGE_DIR/src"
# The repository is ESM, but Lambda must load this bundle as CommonJS so the
# AWS SDK's dynamic Node built-in requires remain valid at runtime.
printf '{"type":"commonjs"}\n' > "$PACKAGE_DIR/package.json"

# Bundle server code and production dependencies into one deterministic CommonJS
# artifact. AWS SDK v3 contains dynamic built-in requires that fail in a bundled
# ESM file (`Dynamic require of "node:https" is not supported`).
./node_modules/.bin/esbuild server/lambda-handler.mjs \
  --bundle \
  --platform=node \
  --target=node24 \
  --format=cjs \
  --outfile="$PACKAGE_DIR/server/lambda-handler.js" \
  --log-level=warning
cp src/routes.json "$PACKAGE_DIR/src/routes.json"

# File modes are part of the ZIP. Normalize them so the package is identical
# under developer (umask 0002) and CI (umask 0022) environments.
find "$PACKAGE_DIR" -type d -exec chmod 0755 {} +
find "$PACKAGE_DIR" -type f -exec chmod 0644 {} +
npm run test:lambda-package -- "$PACKAGE_DIR/server/lambda-handler.js"

if find "$PACKAGE_DIR" -maxdepth 2 \( -name '.env*' -o -name 'env.local' \) | grep -q .; then
  echo 'Refusing to package an environment file.' >&2
  exit 1
fi

# Terraform archive_file includes mtimes. Normalize them so identical source and
# lockfiles produce the same ZIP hash across CI runners and local machines.
find "$PACKAGE_DIR" -exec touch -h -t 198001010000 {} +

size=$(du -sb "$PACKAGE_DIR" | awk '{print $1}')
max=$((250 * 1024 * 1024))
if (( size > max )); then
  echo "Deployment package exceeds Lambda's unzipped size limit: $size bytes" >&2
  exit 1
fi

printf 'Prepared deterministic API Lambda package: %s bytes\n' "$size"
