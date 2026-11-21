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
mkdir -p "$PACKAGE_DIR/server" "$PACKAGE_DIR/src"
cp src/routes.json "$PACKAGE_DIR/src/routes.json"
printf '{"type":"commonjs"}\n' > "$PACKAGE_DIR/package.json"

# The CommonJS bundle contains the application and its runtime dependencies. Server-relative
# resources resolve from the handler directory in both the checkout and deployed archive.
./node_modules/.bin/esbuild server/lambda-handler.mjs \
  --bundle --platform=node --target=node24 --format=cjs \
  --define:import.meta.url=bopModuleURL \
  --banner:js="const bopModuleURL = require('node:url').pathToFileURL(__filename).href;" \
  --outfile="$PACKAGE_DIR/server/lambda-handler.js"

find "$PACKAGE_DIR" -type d -exec chmod 0755 {} +
find "$PACKAGE_DIR" -type f -exec chmod 0644 {} +
node scripts/test-lambda-package.mjs "$PACKAGE_DIR"

# Terraform archive_file records file metadata in the ZIP.
TZ=UTC find "$PACKAGE_DIR" -exec touch -h -t 198001010000 {} +
size=$(node --input-type=module - "$PACKAGE_DIR" <<'NODE'
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
function sizeOf(path) {
  const stat = statSync(path);
  if (stat.isFile()) return stat.size;
  return readdirSync(path).reduce((bytes, name) => bytes + sizeOf(join(path, name)), 0);
}
console.log(sizeOf(process.argv[2]));
NODE
)
if (( size > 250 * 1024 * 1024 )); then
  echo "Deployment package exceeds Lambda's unzipped size limit: $size bytes" >&2
  exit 1
fi
printf 'Prepared API Lambda package: %s bytes\n' "$size"
