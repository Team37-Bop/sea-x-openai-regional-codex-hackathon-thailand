import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';

const root = path.resolve(process.argv[2]);
function checkModes(directory) {
  assert.equal(statSync(directory).mode & 0o777, 0o755, directory);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) checkModes(file);
    else assert.equal(statSync(file).mode & 0o777, 0o644, file);
  }
}
checkModes(root);
assert.ok(Object.keys(JSON.parse(readFileSync(path.join(root, 'src/routes.json')))).length);
process.env.LAMBDA_TASK_ROOT = root;
process.env.BOP_NO_STORE = '1';

process.env.BOP_FAKE_LLM = '1';
process.env.BOP_SPLIT_MIN_DAYS = '3';
delete process.env.BOP_RUNTIME_SECRET_ID;
globalThis.awslambda = {
  streamifyResponse: handler => handler,
  HttpResponseStream: {
    from(stream, metadata) {
      stream.metadata = metadata;
      return stream;
    },
  },
};
const require = createRequire(import.meta.url);
assert.equal(require(path.join(root, 'package.json')).type, 'commonjs');
const { handler } = require(path.join(root, 'server/lambda-handler.js'));

async function invoke(httpMethod, route, body) {
  const chunks = [];
  const stream = new PassThrough();
  stream.on('data', chunk => chunks.push(chunk));
  await handler({ httpMethod, path: route, headers: { 'content-type': 'application/json' }, body }, stream, {});
  assert.ok(stream.writableFinished);
  assert.equal(stream.metadata.statusCode, 200);
  return { headers: new Headers(stream.metadata.headers), text: Buffer.concat(chunks).toString('utf8') };
}

const health = await invoke('GET', '/api/health');
assert.match(health.headers.get('content-type'), /application\/json/);
assert.equal(JSON.parse(health.text).provider, 'fake');

const trip = await invoke('POST', '/api/plan', JSON.stringify({ setup: {
  city: 'เชียงใหม่', startDate: '2026-11-25', endDate: '2026-11-27', members: [{ name: 'มิน' }],
} }));
assert.match(trip.headers.get('content-type'), /application\/x-ndjson/);
const events = trip.text.trim().split('\n').map(line => JSON.parse(line));
assert.equal(events.filter(event => event.type === 'day').length, 3);
assert.equal(events.at(-1).type, 'done');
assert.equal(events.at(-1).plan.days.length, 3);
console.log('Packaged Lambda serves health and streams three itinerary days.');
