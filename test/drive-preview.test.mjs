import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.BOP_CACHE_DIR = await mkdtemp(join(tmpdir(), 'bop-drive-preview-'));
const { drivePreview } = await import('../server/drive-preview.mjs');

test('known Bangkok and Chiang Mai aliases route in direction order, using arrival or departure as the anchor', async (t) => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    paths.push(new URL(url).pathname);
    return Response.json({
      routes: [
        {
          geometry: {
            coordinates: [
              [100.5018, 13.7563],
              [98.9853, 18.7883],
            ],
          },
          duration: 30000,
          distance: 690000,
        },
      ],
    });
  });
  const result = await drivePreview({ dir: 'go', city: 'Chiang Mai', place: 'กทม.', time: '06:00' });
  assert.match(paths[0], /routed-car\/route\/v1\/driving\/100\.5018,13\.7563;98\.9853,18\.7883/);
  assert.deepEqual([result.dep, result.arr, result.depDayOffset, result.overnight], ['20:50', '06:00', -1, true]);
  assert.deepEqual(
    [result.km, result.minutes, result.approx, result.liveTraffic, result.includesRest],
    [690, 550, false, false, false],
  );
  const back = await drivePreview({ dir: 'back', city: 'จ.เชียงใหม่', place: 'กรุงเทพมหานคร' });
  assert.match(paths[1], /98\.9853,18\.7883;100\.5018,13\.7563/);
  assert.deepEqual([back.dep, back.arr, back.arrDayOffset], ['18:00', '03:10', 1]);
  const defaultGo = await drivePreview({ dir: 'go', city: 'เชียงใหม่', place: 'Bangkok' });
  assert.equal(defaultGo.arr, '10:00');
  assert.equal(paths.length, 2);
});
test('the shared router falls back to Valhalla for an unknown named place and explicit destination coordinates', async (t) => {
  const hosts = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url);
    hosts.push(u.hostname);
    if (u.hostname === 'nominatim.openstreetmap.org') {
      assert.equal(u.searchParams.get('q'), 'เมืองเริ่มต้นทดสอบ');
      return Response.json([{ name: 'เมืองเริ่มต้นทดสอบ', lat: '17.5', lon: '98.5', category: 'place' }]);
    }
    if (u.hostname === 'routing.openstreetmap.de') return Response.json({ routes: [] });
    return Response.json({
      trip: {
        legs: [
          {
            shape: {
              coordinates: [
                [98.5, 17.5],
                [98.8, 17.8],
              ],
            },
          },
        ],
        summary: { time: 3600, length: 50 },
      },
    });
  });
  const out = await drivePreview({ dir: 'go', cityLL: [17.8, 98.8], place: 'เมืองเริ่มต้นทดสอบ' });
  assert.equal(out.km, 50);
  assert.equal(out.approx, false);
  // The road model rounds adjusted free-flow minutes upwards.
  assert.deepEqual([out.dep, out.arr], ['08:54', '10:00']);
  assert.deepEqual(hosts, [
    'nominatim.openstreetmap.org',
    'routing.openstreetmap.de',
    'valhalla1.openstreetmap.de',
  ]);
});
test('unroutable coordinates give a labelled straight-line estimate with a duration and valid clocks', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const value = await drivePreview({ dir: 'go', cityLL: [18, 99], placeLL: [17, 99], time: '9:05' });
  assert.equal(mock.mock.callCount(), 2);
  assert.ok(value.approx);
  assert.ok(value.km > 111 && value.km < 112);
  assert.equal(value.minutes, 132);
  assert.equal(value.dep, '06:53');
  assert.equal(value.arr, '09:05');
});
test('missing endpoints, unknown direction, and invalid clocks fail before routing or geocoding', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => {
    throw Error('unexpected lookup');
  });
  for (const body of [
    { dir: 'go', city: 'เชียงใหม่' },
    { dir: 'back', place: 'กรุงเทพฯ' },
    { dir: 'either' },
    { dir: 'go', city: 'เชียงใหม่', place: 'กรุงเทพฯ', time: '25:01' },
  ]) {
    await assert.rejects(drivePreview(body), { code: 'bad_request' });
  }
  assert.equal(mock.mock.callCount(), 0);
});
