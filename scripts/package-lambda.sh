#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PACKAGE_DIR="$ROOT/.build/lambda"
cd "$ROOT"

npm ci
npm test
npm run build
npm audit --omit=dev --audit-level=high

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/server"
printf '{"type":"commonjs"}\n' > "$PACKAGE_DIR/package.json"

# Keep the application modules native ESM so their import.meta.url paths resolve.
# Bundle the adapter and SDK as CommonJS for Lambda's Node.js runtime.
find server -maxdepth 1 -type f -name '*.mjs' \
  ! -name 'lambda-handler.mjs' ! -name 'runtime-secrets.mjs' \
  -exec cp {} "$PACKAGE_DIR/server/" \;
./node_modules/.bin/esbuild server/lambda-handler.mjs \
  --bundle --platform=node --target=node24 --format=cjs \
  --external:./index.mjs --outfile="$PACKAGE_DIR/server/lambda-handler.js"

find "$PACKAGE_DIR" -type d -exec chmod 0755 {} +
find "$PACKAGE_DIR" -type f -exec chmod 0644 {} +
node scripts/test-lambda-package.mjs "$PACKAGE_DIR"

# Terraform archive_file records file metadata in the ZIP.
TZ=UTC find "$PACKAGE_DIR" -exec touch -h -t 198001010000 {} +
size=$(du -sb "$PACKAGE_DIR" | awk '{print $1}')
if (( size > 250 * 1024 * 1024 )); then
  echo "Deployment package exceeds Lambda's unzipped size limit: $size bytes" >&2
  exit 1
fi
printf 'Prepared API Lambda package: %s bytes\n' "$size"
