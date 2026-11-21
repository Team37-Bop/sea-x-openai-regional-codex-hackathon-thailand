import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';

function assertPackageModes(directory) {
  assert.equal(statSync(directory).mode & 0o777, 0o755, `${directory} must use mode 0755`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) assertPackageModes(entryPath);
    else assert.equal(statSync(entryPath).mode & 0o777, 0o644, `${entryPath} must use mode 0644`);
  }
}

const bundleArgument = process.argv[2];
assert.ok(bundleArgument, 'expected the packaged Lambda bundle path');

const bundlePath = path.resolve(bundleArgument);
const packageRoot = path.dirname(path.dirname(bundlePath));
assertPackageModes(packageRoot);
const packageMetadata = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
assert.equal(packageMetadata.type, 'commonjs', 'Lambda package must define a CommonJS boundary');
assert.doesNotThrow(() => readFileSync(path.join(packageRoot, 'src/routes.json')));

process.env.BOP_FAKE_LLM = '1';
process.env.BOP_RUNTIME_SECRET_ID = '';
process.env.BOP_NO_STORE = '1';
process.env.LINE_CHANNEL_SECRET = 'line-test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-test-token';

const originalCwd = process.cwd();
process.chdir(packageRoot);
try {
  const require = createRequire(import.meta.url);
  const bundle = require(bundlePath);

  assert.equal(typeof bundle.handler, 'function', 'packaged Lambda must export handler');
  assert.equal(
    typeof bundle.handleApiGatewayEvent,
    'function',
    'packaged Lambda must export the API Gateway adapter',
  );

  let metadata;
  const chunks = [];
  const stream = new PassThrough();
  stream.on('data', chunk => chunks.push(chunk));
  await bundle.handleApiGatewayEvent(
    { httpMethod: 'GET', path: '/api/health', headers: { accept: 'application/json' } },
    stream,
    {
      HttpResponseStream: {
        from(raw, value) {
          metadata = value;
          return raw;
        },
      },
    },
  );
  await new Promise(resolve => stream.writableFinished ? resolve() : stream.once('finish', resolve));

  assert.equal(metadata.statusCode, 200);
  assert.equal(JSON.parse(Buffer.concat(chunks).toString('utf8')).provider, 'fake');
  console.log('ok   packaged CommonJS Lambda serves the health route');
} finally {
  process.chdir(originalCwd);
}
