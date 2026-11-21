import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { readEvents } from '../web/stream.js';
import { coordinates } from '../web/map.js';
process.env.BOP_FAKE_LLM = '1';
globalThis.awslambda = { streamifyResponse: (f) => f };
const { invoke } = await import('../server/lambda-handler.mjs');
async function request(event) {
  let metadata,
    payload = '';
  const out = new Writable({
    write(chunk, enc, done) {
      payload += chunk;
      done();
    },
  });
  await invoke(event, out, (stream, meta) => {
    assert.equal(metadata, undefined);
    metadata = meta;
    return stream;
  });
  return { code: metadata.statusCode, headers: metadata.headers, payload };
}
test('Lambda adapter serves HEAD and SPA, rejects invalid media and preserves base64 JSON', async () => {
  const get = await request({ path: '/planner' });
  assert.equal(get.code, 200);
  assert.match(get.payload, /<html lang="th">/);
  const head = await request({ path: '/index.html', httpMethod: 'HEAD' });
  assert.equal(head.payload, '');
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(get.payload));
  assert.equal((await request({ path: '/missing.asset' })).code, 404);
  const wrong = await request({ path: '/api/plan', httpMethod: 'POST', body: '{}' });
  assert.equal(wrong.code, 415);
  assert.equal(JSON.parse(wrong.payload).code, 'bad_request');
  const right = await request({
    path: '/api/weather-check',
    httpMethod: 'POST',
    headers: { 'Content-Type': 'application/json' },
    isBase64Encoded: true,
    body: Buffer.from('{"plan":{"days":[]}}').toString('base64'),
  });
  assert.equal(right.code, 200);
  assert.equal(JSON.parse(right.payload.trim().split('\n').at(-1)).type, 'done');
});
test('split Thai NDJSON, ignored noise and unterminated last line', async () => {
  const bytes = Buffer.from('{"type":"step","text":"จัดทริป"}\nnoise\n{"type":"done","ok":true}');
  const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
  const rows = [];
  const result = await readEvents(new Response(Readable.toWeb(Readable.from(chunks))), (event) =>
    rows.push(event),
  );
  assert.equal(result.ok, true);
  assert.equal(rows[0].text, 'จัดทริป');
  await assert.rejects(() => readEvents(new Response('{"type":"step"}'), () => {}), { code: 'cut' });
  assert.deepEqual(coordinates('98.5,18.7'), [98.5, 18.7]);
  assert.deepEqual(coordinates({ lat: 18, lng: 99 }), [99, 18]);
  assert.equal(coordinates('0,0'), undefined);
});

test('place photo connections only use publicly routable addresses', async () => {
  const {publicAddresses} = await import('../server/public-fetch.mjs');
  const records = ['1.1.1.1','10.0.0.1','169.254.169.254','127.0.0.1','::1','fd00::1','::ffff:192.168.1.1','2606:4700:4700::1111']
    .map(address => ({address}));
  assert.deepEqual(publicAddresses(records).map(item => item.address),['1.1.1.1','2606:4700:4700::1111']);
});
