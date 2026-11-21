import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupSuggestions } from '../server/location-suggest.mjs';
import { localSuggestions, locationTerm } from '../web/location-suggest.js';

test('member wishes match Thai aliases by destination and replace only the active comma-delimited wish', () => {
  assert.equal(localSuggestions('วัดโพ', { kind: 'place', city: 'Bangkok' })[0].name, 'วัดโพธิ์');
  const [item] = localSuggestions('ท่าแพ', { kind: 'place', city: 'เชียงใหม่' });
  assert.equal(item.name, 'ประตูท่าแพ');
  assert.deepEqual(localSuggestions('ท่าแพ', { kind: 'place', city: 'Bangkok' }), []);
  const wishes = 'วัดเจดีย์หลวง, ท่าแพ , ตลาดวโรรส';
  const term = locationTerm(wishes, wishes.indexOf('แพ') + 2, true);
  assert.equal(term.query, 'ท่าแพ');
  assert.equal(
    wishes.slice(0, term.start) + item.name + wishes.slice(term.end),
    'วัดเจดีย์หลวง, ประตูท่าแพ , ตลาดวโรรส',
  );
  assert.deepEqual(locationTerm('A, ', 3, true), { start: 3, end: 3, query: '' });
  assert.equal(locationTerm(' A，B ', 0, true).query, 'A');
});

test('Thai prefixes and abbreviations resolve on the first keystroke without a service', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw Error('unexpected request');
  });
  assert.equal((await lookupSuggestions('ก', { kind: 'city' }))[0].name, 'กรุงเทพฯ');
  assert.equal(network.mock.callCount(), 0);
  assert.equal(localSuggestions('กทม.', { kind: 'city' })[0].airport, 'BKK');
  assert.equal(localSuggestions('bkk', { kind: 'transport' })[0].airport, 'BKK');
  assert.equal(localSuggestions('ดอนเม', { kind: 'transport' })[0].airport, 'DMK');
  assert.equal(localSuggestions('สุวรรณ', { kind: 'transport' })[0].airport, 'BKK');
  assert.equal(localSuggestions('CNX', { kind: 'transport' })[0].name, 'สนามบินเชียงใหม่ (CNX)');
  assert.equal(localSuggestions('chiangm', { kind: 'city' })[0].name, 'เชียงใหม่');
  assert.equal(localSuggestions('Đà Nẵng', { kind: 'city' })[0].cc, 'VN');
  assert.equal(
    localSuggestions('โน', { kind: 'stay', city: 'Da Nang' })[0].name,
    'Novotel Danang Premier Han River',
  );
  assert.equal(localSuggestions('โน', { kind: 'stay', city: 'โตเกียว' }).length, 0);
});
test('city search uses Photon city layer, returns coherent coordinates, and caches repeated queries', async (t) => {
  let url;
  const mock = t.mock.method(globalThis, 'fetch', async (input, options) => {
    url = new URL(input);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({
      features: [
        {
          geometry: { coordinates: [100.6, 14.3] },
          properties: { name: 'อยุธยา', type: 'city', countrycode: 'th', country: 'Thailand' },
        },
        {
          geometry: { coordinates: [100.6, 14.3] },
          properties: { name: 'อยุธยา', type: 'city', countrycode: 'th', country: 'Thailand' },
        },
        { geometry: { coordinates: [999, 50] }, properties: { name: 'Bad coordinates', type: 'city' } },
        { geometry: { coordinates: [100, 15] }, properties: { name: 'Wrong layer', type: 'street' } },
      ],
    });
  });
  const rows = await lookupSuggestions('อยุ', { kind: 'city' });
  assert.equal(url.hostname, 'photon.komoot.io');
  assert.equal(url.searchParams.get('layer'), 'city');
  assert.equal(url.searchParams.get('q'), 'อยุ');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'อยุธยา');
  assert.equal(rows[0].cc, 'TH');
  assert.equal(rows[0].currency, 'THB');
  assert.deepEqual(rows[0].ll, [14.3, 100.6]);
  assert.deepEqual(await lookupSuggestions('อยุ', { kind: 'city' }), rows);
  assert.equal(mock.mock.callCount(), 1);
});
test('lodging search uses the destination bias and excludes wrong tags and far-away namesakes', async (t) => {
  let url;
  t.mock.method(globalThis, 'fetch', async (input) => {
    url = new URL(input);
    const place = (name, ll, type) => ({
      properties: { name, osm_key: 'tourism', osm_value: type, countrycode: 'VN' },
      geometry: { coordinates: ll },
    });
    return Response.json({
      features: [
        place('River Hotel Hanoi', [105.85, 21.03], 'hotel'),
        place('River Hotel Danang', [108.22, 16.07], 'hotel'),
        place('River Road', [108.2, 16.08], 'highway'),
      ],
    });
  });
  const rows = await lookupSuggestions('Riv', { kind: 'stay', city: 'ดานัง', center: [16.05, 108.2] });
  assert.equal(url.searchParams.get('lat'), '16.050');
  assert.ok(url.searchParams.getAll('osm_tag').includes('tourism:hotel'));
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Novotel Danang Premier Han River', 'River Hotel Danang'],
  );
});
test('the same POI prefix stays within the selected destination across cached searches', async (t) => {
  const features = [
    ['Riverside market Bangkok', [100.5, 13.75]],
    ['Riverside market Chiang Mai', [99, 18.79]],
  ].map(([name, coordinates]) => ({ properties: { name, countrycode: 'TH' }, geometry: { coordinates } }));
  const network = t.mock.method(globalThis, 'fetch', async () => Response.json({ features }));
  const names = async (city) =>
    (await lookupSuggestions('Riverside mar', { kind: 'place', city })).map((row) => row.name);
  assert.deepEqual(await names('กรุงเทพฯ'), ['Riverside market Bangkok']);
  assert.deepEqual(await names('เชียงใหม่'), ['Riverside market Chiang Mai']);
  assert.deepEqual(await names('กรุงเทพฯ'), ['Riverside market Bangkok']);
  assert.equal(network.mock.callCount(), 2);
});
test('invalid and cancelled searches never reach the service', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw Error('unexpected request');
  });
  await assert.rejects(lookupSuggestions('a'.repeat(121)), { code: 'bad_request' });
  await assert.rejects(lookupSuggestions('hello', { kind: 'unrecognized' }), { code: 'bad_request' });
  await assert.rejects(lookupSuggestions('hello', { kind: 'city', center: [999, 0] }), {
    code: 'bad_request',
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(lookupSuggestions('Hotel', { kind: 'stay', signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(network.mock.callCount(), 0);
});
test('editing a pending query aborts upstream work; rate limits leave the shortlist available', async (t) => {
  const controller = new AbortController();
  let started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const mock = t.mock.method(globalThis, 'fetch', async (_, options) => {
    started();
    return new Promise((_, reject) =>
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }),
    );
  });
  const searching = lookupSuggestions('Mountain lodge', { kind: 'stay', signal: controller.signal });
  await began;
  controller.abort();
  await assert.rejects(searching, { name: 'AbortError' });
  mock.mock.mockImplementation(async () => new Response(null, { status: 429 }));
  const fallback = await lookupSuggestions('สุวร', { kind: 'transport' });
  assert.equal(fallback[0].airport, 'BKK');
  await lookupSuggestions('ดอนเมื', { kind: 'transport' });
  assert.equal(mock.mock.callCount(), 2);
});
