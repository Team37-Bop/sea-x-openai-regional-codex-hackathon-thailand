import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { loadRuntimeSecrets } from '../server/runtime-secrets.mjs';
import { SECURITY_HEADERS } from '../server/security.mjs';

const target = { ANTHROPIC_API_KEY: 'local-wins' };
const loaded = await loadRuntimeSecrets({
  secretId: 'test/runtime',
  target,
  fetchSecret: async () => JSON.stringify({
    ANTHROPIC_API_KEY: 'must-not-overwrite',
    OPEN_METEO_API_KEY: 'loaded-at-runtime',
    NODE_OPTIONS: '--inspect',
    HOST: 'attacker.example',
  }),
});
assert.equal(target.ANTHROPIC_API_KEY, 'local-wins');
assert.equal(target.OPEN_METEO_API_KEY, 'loaded-at-runtime');
assert.equal(target.NODE_OPTIONS, undefined);
assert.equal(target.HOST, undefined);
assert.deepEqual(loaded.sort(), ['ANTHROPIC_API_KEY', 'OPEN_METEO_API_KEY']);
assert.deepEqual(await loadRuntimeSecrets({ secretId: '', target: {} }), []);
await assert.rejects(
  loadRuntimeSecrets({ secretId: 'bad', target: {}, fetchSecret: async () => 'not-json' }),
  /JSON object/,
);
console.log('ok   runtime secret allowlist and local override');

assert.match(SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
assert.match(SECURITY_HEADERS['Strict-Transport-Security'], /max-age=31536000/);
console.log('ok   production security headers');

const freePort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(error => error ? reject(error) : resolve(port));
  });
});

const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    AWS_LAMBDA_HTTP_ENDPOINT: `127.0.0.1:${freePort}`,
    BOP_FAKE_LLM: '1',
    BOP_RUNTIME_SECRET_ID: '',
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
try {
  const deadline = Date.now() + 10_000;
  while (!output.includes(`listening on 127.0.0.1:${freePort}`)) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${output}`);
    if (Date.now() > deadline) throw new Error(`server did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const response = await fetch(`http://127.0.0.1:${freePort}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  const body = await response.json();
  assert.equal(body.provider, 'fake');

  const unsupported = await fetch(`http://127.0.0.1:${freePort}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  assert.equal(unsupported.status, 415);

  const nonObject = await fetch(`http://127.0.0.1:${freePort}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null',
  });
  assert.match(await nonObject.text(), /"code":"bad_request"/);
  console.log('ok   Lambda Web bind address, headers, and request boundary');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}

console.log('all passed');
