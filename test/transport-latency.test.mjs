import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

process.env.BOP_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'fixture-key';
process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_fixture';
delete process.env.BOP_FAKE_LLM;
const { transport } = await import('../server/plan.mjs');

test('the default mode overlaps Duffel and web lookup while a successful explicit flight skips the model', async (t) => {
  const setup = { city: 'เชียงใหม่', cityAirport: 'CNX', startDate: '2027-01-03', days: 1,
    members: [{ name: 'May' }], arrive: { from: 'BKK', by: 'undecided' } };
  const ctx = { signal: new AbortController().signal, usage: {}, step() {} };
  const offer = { id: 'off_fixture', total_amount: '900', total_currency: 'THB', slices: [{ segments: [{
    departing_at: '2027-01-03T07:00:00', arriving_at: '2027-01-03T09:00:00',
    origin: { iata_code: 'BKK' }, destination: { iata_code: 'CNX' },
  }] }] };
  const web = { options: [{ by: 'train', carrier: 'Rail', dep: '07:00', arr: '10:00', price: 300 }] };
  const release = Promise.withResolvers(), started = Promise.withResolvers();
  const calls = [];
  let hold = false;
  let modelStatus = 200;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const { hostname } = new URL(url);
    calls.push(hostname);
    if (hold) {
      started.resolve();
      await release.promise;
    }
    if (hostname === 'api.duffel.com') return Response.json({ data: { offers: [offer] } });
    assert.equal(hostname, 'api.openai.com');
    if (modelStatus !== 200) return Response.json({ error: { message: 'Fixture error' } }, { status: modelStatus });
    const event = { type: 'response.completed', response: { status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(web) }] }] } };
    return new Response('event: response.completed\ndata: ' + JSON.stringify(event) + '\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
  });
  // Load the SDK before holding either provider's response.
  await transport({ ...setup, arrive: { ...setup.arrive, by: 'train' } }, 'go', ctx);
  calls.length = 0;
  hold = true;
  const result = transport(setup, 'go', ctx);
  await started.promise;
  await setImmediate();
  const beforeFirstResponse = [...calls];
  hold = false;
  release.resolve();
  const options = await result;
  assert.deepEqual(beforeFirstResponse.sort(), ['api.duffel.com', 'api.openai.com']);
  assert.deepEqual([...calls].sort(), beforeFirstResponse);
  assert.deepEqual(options.map(row => [row.by, row.recommended]), [['flight', true], ['train', false]]);
  calls.length = 0;
  await transport({ ...setup, arrive: { ...setup.arrive, by: 'flight' } }, 'go', ctx);
  assert.deepEqual(calls, ['api.duffel.com']);
  modelStatus = 400;
  assert.deepEqual((await transport(setup, 'go', ctx)).map(row => row.by), ['flight']);
  modelStatus = 403;
  await assert.rejects(transport(setup, 'go', ctx), { code: 'auth' });
  calls.length = 0;
  await assert.rejects(transport(setup, 'go', { ...ctx, signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.deepEqual(calls, []);
});
