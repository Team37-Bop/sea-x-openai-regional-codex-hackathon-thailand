import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEdits, checks, normalize, source } from '../server/domain.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.BOP_CACHE_DIR = await mkdtemp(join(tmpdir(), 'bop-route-tests-'));
const { route } = await import('../server/geo.mjs');
const { fare, schedule } = await import('../server/schedule.mjs');
import { weather } from '../server/weather.mjs';
import { createForecast, rainCommand, rankAlerts } from '../web/forecast.js';

const context = () => ({ signal: new AbortController().signal, step() {}, emit() {}, usage: {} });
const base = { startDate: '2026-11-20', members: [{ id: 'a', name: 'แอน' }], days: 1 };
const stop = (id, extra = {}) => ({
  id,
  n: id,
  k: 'sight',
  ll: [18, 99],
  t0: '12:00',
  t1: '13:00',
  ...extra,
});

test('setup preserves supplied end dates and validates selected supplier capabilities', () => {
  const setup = normalize({
    ...base,
    endDate: '2026-12-20',
    extra: 'x'.repeat(1200),
    hotelArea: 'นิมมาน',
    members: [
      { id: 'a', name: 'n'.repeat(60), budget: 1234.6, maxWalkKm: -1 },
      { id: 'a', name: 'บี' },
    ],
    arrive: {
      time: '9:05',
      choice: {
        carrier: 'Bop',
        dep: '7:00',
        arr: '9:05',
        checked: 'live',
        offerId: 'off_x1',
        bookable: true,
      },
    },
    depart: { choice: { carrier: 'Bop', dep: '7:00', arr: '9:05', checked: 'live', offerId: 'bad' } },
  });
  assert.equal(setup.city, 'เชียงใหม่');
  assert.equal(setup.days, 7);
  assert.equal(setup.endDate, '2026-12-20');
  assert.equal(setup.stay.mode, 'auto');
  assert.equal(setup.arrive.time, '09:05');
  assert.equal(setup.arrive.choice.checked, 'live');
  assert.equal(setup.depart.choice.checked, 'estimate');
  assert.equal(setup.members[0].name.length, 40);
  assert.equal(setup.members[0].budget, 1235);
  assert.equal(setup.members[0].maxWalkKm, undefined);
  assert.equal(setup.extra.length, 1000);
  assert.equal(setup.members[1].id, 'a_');
  assert.equal(normalize(base).arrive, undefined);
  assert.deepEqual(source({ url: 'https://site.example/page#x', title: 'หน้า' }, ['HTTPS://SITE.EXAMPLE/Page/']), {
    url: 'https://site.example/page#x',
    title: 'หน้า',
    checked: 'web',
  });
});
test('aggregates walking, meals, stars, weekday, clock and departure rules independently', () => {
  const setup = normalize({
    ...base,
    arrive: { by: 'flight', time: '13:00' },
    depart: { by: 'flight', time: '19:30' },
    members: [
      { id: 'a', name: 'แอน', wants: ['วัด', 'ตลาด'], avoid: 'กุ้ง', budget: 200, maxWalkKm: 2.3 },
      { id: 'b', name: 'บี', note: 'ระวังบันได' },
    ],
  });
  const stops = [
    stop('market', {
      k: 'market',
      star: 'a',
      meal: 'lunch',
      t0: '14:00',
      t1: '15:00',
      walk: 1.24,
      cost: 175,
      veg: true,
      days: { only: ['sat', 'sun'], closed: ['fri'], hours: { fri: '08:00-14:30' } },
      closures: [{ date: '2026-11-20', why: 'ปิดซ่อม' }],
    }),
    stop('dinner', {
      k: 'food',
      meal: 'dinner',
      t0: '17:00',
      t1: '17:30',
      diet: true,
      cost: 60,
      leg: { m: 'walk', km: 1.1, cost: 0 },
    }),
    stop('airport', { k: 'transit', t0: '18:15', t1: '18:15', leg: { m: 'car', km: 14, cost: 25 } }),
  ];
  const report = checks({ days: [{ date: '2026-11-20', stops }] }, setup);
  assert.equal(report.maxWalk, 2.3);
  assert.equal(report.total, 260);
  assert.deepEqual(report.ds, [{ walk: 2.3, cost: 260 }]);
  const rule = (id) => report.list.find((r) => r.id === id);
  for (const id of ['a/walk', 'meals', 'departure']) assert.equal(rule(id).ok, true, id);
  for (const id of ['a/food', 'a/wishes', 'a/budget', 'hours', 'open-days']) assert.equal(rule(id).ok, false, id);
  assert.match(rule('open-days').problems[0], /เสาร์\/อาทิตย์/);
  assert.match(rule('a/food').problems[0], /market/);
  assert.equal(report.mem.b.txt, 'ไม่มีเงื่อนไขพิเศษ');
});
test('scheduled stops keep dwell, canonical aliases, travel waits, prices and fallback coordinates', async () => {
  const setup = normalize({
    ...base,
    city: 'เมืองที่ไม่ทราบพิกัด',
    members: Array.from({ length: 5 }, (_, i) => ({ name: 'คน' + i })),
  });
  const result = await schedule(
    {
      stops: [
        { id: 'dup', n: 'จุดแรก', k: 'sight', t0: '09:00', t1: '10:00', ll: [18, 99] },
        {
          id: 'dup',
          n: 'จุดสอง',
          k: 'sight',
          t0: '10:10',
          t1: '11:10',
          leg: { m: 'car', min: 25 },
          ll: [18.1, 99],
        },
        { id: 'later', n: 'จุดสาม', k: 'sight', t0: '14:00', t1: '15:00', mode: 'walk', ll: [18.101, 99] },
      ],
    },
    0,
    setup,
    context(),
    [],
    new Set(),
    { offline: true },
  );
  const [a, b, c] = result.day.stops;
  assert.equal(a.leg, undefined);
  assert.equal(b.id, 'dup_2');
  assert.equal(b.t0, '10:25');
  assert.equal(b.t1, '11:25');
  assert.equal(c.start, '14:00');
  assert.equal(b.name, b.n);
  assert.equal(b.leg.m, 'car');
  assert.deepEqual(result.routes[b.leg.key].geom, [
    [99, 18],
    [99, 18.1],
  ]);
  assert.equal(fare('red', 2, 5), 20);
  assert.equal(fare('car', 10, 5), 80);
  assert.equal(fare('transit', 10, 5), 65);
  assert.equal(fare('own', 10, 5, { parking: 5, tolls: 5 }), 18);
  const approximate = await schedule({ stops: [{ id: 'x', name: 'ไม่พบ' }] }, 0, setup, context(), [], new Set(), {
    offline: true,
  });
  assert.deepEqual(approximate.day.stops[0].ll, [0.0001, 0.0001]);
  assert.equal(approximate.day.stops[0].place.source, 'model');
});
test('router rejects unusable geometry, decodes Valhalla and shares the road profile while timing modes separately', async (t) => {
  const responses = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    responses.push(String(url));
    return String(url).includes('valhalla')
      ? Response.json({
          trip: {
            legs: [
              {
                shape: {
                  coordinates: [
                    [100.77777, 15.2],
                    [100.88888, 15.3],
                  ],
                },
              },
            ],
            summary: { time: 600, length: 10 },
          },
        })
      : Response.json({
          routes: [{ geometry: { coordinates: [[100.77777, 15.2]] }, duration: 600, distance: 10000 }],
        });
  });
  const from = [15.2, 100.77777],
    to = [15.3, 100.88888];
  const a = await route(from, to, 'car', context().signal),
    b = await route(from, to, 'transit', context().signal);
  assert.equal(a.via, 'Valhalla');
  assert.equal(a.min, 17);
  assert.equal(b.min, 32);
  assert.equal(b.key, a.key);
  assert.equal(b.via, 'cache');
  assert.equal(responses.length, 2);
});
test('confirmed removal reports a conflict, subsequent edits still apply and insertion validates target day', () => {
  const original = {
    days: [{ stops: [stop('one', { res: { done: true } }), stop('two')] }, { stops: [stop('three')] }],
  };
  const update = applyEdits(original, [
    { op: 'remove', id: 'one' },
    { op: 'insert', day: 1, after: 'two', stop: { id: 'other', n: 'ข้ามวัน' } },
    { op: 'insert', day: 1, stop: { id: 'two', name: 'เริ่มวัน' } },
    { op: 'replace', id: 'three', stop: { name: 'แก้ชื่อ' } },
  ]);
  assert.equal(update.errors.length, 2);
  assert.equal(update.plan.days[0].stops.length, 1);
  assert.deepEqual(
    update.plan.days[1].stops.map((s) => s.id),
    ['two_2', 'three'],
  );
  assert.equal(update.plan.days[1].stops[1].n, 'แก้ชื่อ');
  assert.equal(original.days[0].stops.length, 2);
});
test('forecasts use ending timestamps and a single date range per coordinate, ignore wet boundary hours and handle midnight', async (t) => {
  let query;
  const mock = t.mock.method(globalThis, 'fetch', async (url) => {
    query = new URL(url).searchParams;
    return Response.json({
      hourly: {
        time: ['2026-12-01T14:00', '2026-12-01T15:00', '2026-12-03T00:00'],
        precipitation: [5, 0, 2.58],
        precipitation_probability: [80, 0, 49],
      },
    });
  });
  const place = { k: 'nature', ll: [19.876, 99.123], n: 'น้ำตก' };
  const plan = {
    days: [
      { stops: [stop('dry', { ...place, t0: '14:00', t1: '15:00' })] },
      { stops: [stop('late', { ...place, t0: '23:30', t1: '23:59' })] },
      { date: '2027-01-01', stops: [stop('far', place)] },
    ],
  };
  const result = await weather(plan, context().signal, '2026-11-30', { startDate: '2026-12-01' });
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(query.get('start_date'), '2026-12-01');
  assert.equal(query.get('end_date'), '2026-12-03');
  assert.equal(result.reason, 'partial_horizon');
  assert.equal(result.checked, 2);
  assert.equal(result.alerts.length, 1);
  assert.deepEqual(
    [result.alerts[0].stopId, result.alerts[0].from, result.alerts[0].to, result.alerts[0].mm],
    ['late', '23:00', '24:00', 2.6],
  );
  await weather(plan, context().signal, '2026-11-30', { startDate: '2026-12-01' });
  assert.equal(mock.mock.callCount(), 1);
});
test('forecast refresh supersedes prior results, skips the sample and only notifies once for the highest-ranked rain', async () => {
  const plan = { days: [{ date: '2026-12-01', stops: [stop('a'), stop('b')] }] };
  const state = { plan, setup: {}, demo: false },
    pending = [],
    sent = [];
  const model = createForecast({
    getState: () => state,
    onChange() {},
    canNotify: () => true,
    notify: async (a) => sent.push(a.stopId),
    request: (_data, signal) => new Promise((resolve) => pending.push({ resolve, signal })),
  });
  const a = {
    n: 'ตลาด',
    stopId: 'a',
    date: '2026-12-01',
    day: 0,
    level: 'likely',
    from: '11:00',
    to: '12:00',
    prob: 90,
    mm: 0.6,
  };
  const b = { ...a, n: 'น้ำตกบัวตอง', stopId: 'b', level: 'heavy', prob: 80, mm: 4 };
  assert.deepEqual(rankAlerts([a, b]), [b, a]);
  assert.match(rainCommand(b), /11:00–12:00 วันที่ 1 ที่น้ำตกบัวตอง \(โอกาส 80% ~4 มม.\/ชม.\)/);
  const first = model.refresh(),
    second = model.refresh();
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ alerts: [a] });
  await first;
  pending[1].resolve({ alerts: [a, b] });
  await second;
  assert.deepEqual(sent, ['b']);
  const repeat = model.refresh();
  pending[2].resolve({ alerts: [a, b] });
  await repeat;
  assert.deepEqual(sent, ['b']);
  state.demo = true;
  await model.refresh({ manual: true });
  assert.equal(pending.length, 3);
});

test('shared weather lookups detach an aborted caller and replace abandoned requests immediately', async (t) => {
  const requests = [];
  t.mock.method(
    globalThis,
    'fetch',
    (_url, { signal }) =>
      new Promise((resolve, reject) => {
        requests.push({
          signal,
          finish: () =>
            resolve(
              Response.json({
                hourly: { time: ['2026-12-01T15:00'], precipitation: [4], precipitation_probability: [80] },
              }),
            ),
        });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  function lookup(point, controller) {
    return weather(
      {
        days: [
          { date: '2026-12-01', stops: [stop('rain', { k: 'nature', t0: '14:00', t1: '15:00', ll: point })] },
        ],
      },
      controller.signal,
      '2026-11-30',
    );
  }

  const a = new AbortController(),
    b = new AbortController();
  const results = Promise.allSettled([lookup([14, 104], a), lookup([14, 104], b)]);
  a.abort();
  requests[0].finish();
  const [cancelled, kept] = await results;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, false);
  assert.equal(cancelled.reason.name, 'AbortError');
  assert.equal(kept.value.alerts[0].level, 'heavy');

  const abandoned = new AbortController();
  const cancellation = assert.rejects(lookup([15, 105], abandoned), { name: 'AbortError' });
  abandoned.abort();
  assert.equal(requests[1].signal.aborted, true);
  const replacement = lookup([15, 105], new AbortController());
  assert.equal(requests.length, 3);
  await cancellation;
  const follower = lookup([15, 105], new AbortController());
  assert.equal(requests.length, 3);
  requests[2].finish();
  for (const result of await Promise.all([replacement, follower])) assert.equal(result.checked, 1);
});

test('Thai venue descriptions are normalized before food checks and genuine long hikes retain their distance', async () => {
  const setup = normalize({
    startDate: '2026-11-20',
    days: 1,
    members: [{ id: 'a', name: 'แอน', avoid: 'กุ้ง', maxWalkKm: 6 }],
  });
  const stops = [
    {
      id: 'meal',
      name: 'ร้านริมแม่น้ำ',
      kind: 'คาเฟ่และร้านอาหารท้องถิ่น',
      ll: [18, 99],
      start: '12:00',
      end: '13:00',
      meal: 'lunch',
      walk: 0.25,
    },
    { id: 'trail', name: 'เส้นทางป่า', kind: 'เดินป่าธรรมชาติ', ll: [18, 99], start: '14:00', end: '17:00', walk: 10 },
  ];
  const { day } = await schedule({ stops }, 0, setup, context(), [], new Set(), { offline: true });
  assert.equal(day.stops[0].kind, 'food');
  assert.equal(day.stops[0].k, 'food');
  assert.equal(day.stops[1].k, 'nature');
  assert.equal(day.stops[1].walk, 10);
  const report = checks({ days: [day] }, setup);
  assert.equal(report.maxWalk, 10.3);
  assert.equal(report.list.find((r) => r.id === 'a/walk').ok, false);
  assert.match(report.list.find((r) => r.id === 'a/food').problems[0], /ร้านริมแม่น้ำ/);
});
