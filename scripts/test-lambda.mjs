import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

process.env.BOP_FAKE_LLM = '1';
process.env.BOP_RUNTIME_SECRET_ID = '';
process.env.BOP_NO_STORE = '1';
process.env.LINE_CHANNEL_SECRET = 'line-test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-test-token';

const { handleApiGatewayEvent } = await import('../server/lambda-handler.mjs');

async function invoke(event) {
  let metadata;
  const output = [];
  const stream = new PassThrough();
  stream.on('data', chunk => output.push(chunk));
  const runtime = {
    HttpResponseStream: {
      from(raw, value) { metadata = value; return raw; },
    },
  };
  await handleApiGatewayEvent(event, stream, runtime);
  await new Promise(resolve => stream.writableFinished ? resolve() : stream.once('finish', resolve));
  return { metadata, body: Buffer.concat(output).toString('utf8') };
}

const health = await invoke({
  httpMethod: 'GET',
  path: '/api/health',
  headers: { accept: 'application/json' },
});
assert.equal(health.metadata.statusCode, 200);
assert.equal(health.metadata.headers['Content-Type'], 'application/json');
assert.equal(health.metadata.headers['X-Content-Type-Options'], 'nosniff');
assert.equal(JSON.parse(health.body).provider, 'fake');
console.log('ok   API Gateway event reaches the existing health route');

const unsupported = await invoke({
  httpMethod: 'POST',
  path: '/api/plan',
  headers: { 'content-type': 'text/plain' },
  body: '{}',
  isBase64Encoded: false,
});
assert.equal(unsupported.metadata.statusCode, 415);
assert.match(unsupported.body, /"code":"bad_request"/);
console.log('ok   streaming adapter preserves request boundary responses');

const webhook = await invoke({
  httpMethod: 'POST',
  path: '/api/line/webhook',
  headers: { 'content-type': 'application/json', 'x-line-signature': 'forged' },
  body: '{"events":[]}',
});
assert.equal(webhook.metadata.statusCode, 401);
assert.match(webhook.body, /invalid_signature/);
console.log('ok   API Gateway preserves raw LINE webhook signature validation');

const query = await invoke({
  httpMethod: 'GET',
  path: '/api/unknown',
  headers: {},
  multiValueQueryStringParameters: { q: ['one', 'two'] },
});
assert.equal(query.metadata.statusCode, 404);
console.log('ok   API Gateway query and unknown-route handling');

console.log('all passed');
