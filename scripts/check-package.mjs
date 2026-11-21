import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
process.env.BOP_FAKE_LLM = '1';
delete process.env.BOP_RUNTIME_SECRET_ID;
let meta;
globalThis.awslambda = {
  streamifyResponse: (fn) => fn,
  HttpResponseStream: {
    from: (stream, headers) => {
      assert.equal(meta, undefined);
      meta = headers;
      return stream;
    },
  },
};
const { handler } = createRequire(import.meta.url)('../build/lambda/index.cjs');
let body = '';
await handler(
  { httpMethod: 'GET', path: '/api/health' },
  new Writable({
    write(chunk, encoding, next) {
      body += chunk;
      next();
    },
  }),
);
assert.equal(meta.statusCode, 200);
assert.equal(JSON.parse(body).provider, 'fake');
console.log('Packaged streaming handler served health');
