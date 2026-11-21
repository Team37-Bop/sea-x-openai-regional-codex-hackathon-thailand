import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { normalize } from '../server/domain.mjs';
import { weather } from '../server/geo.mjs';

process.env.BOP_FAKE_LLM = '1';
const { server } = await import('../server/index.mjs');
let base;
const setup = {
  city: 'ดานัง',
  startDate: '2026-11-20',
  endDate: '2026-11-23',
  members: [
    { id: 'same', name: 'มิน' },
    { id: 'same', name: 'ฟ้า', budget: 5000 },
  ],
  stay: {
    mode: 'booked',
    stays: [
      { name: 'Hotel A', nights: 2 },
      { name: 'Hotel B', nights: 1 },
    ],
  },
  arrive: { by: 'flight', from: 'DMK', time: '09:15' },
};
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
async function stream(path, payload) {
  const reply = await fetch(
    base + path,
    payload === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
  );
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get('content-type'), /ndjson/);
  const events = (await reply.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => ['done', 'error'].includes(event.type)).length, 1);
  return { events, last: events.at(-1) };
}
test('normalizes historical setup and stays by night', () => {
  const result = normalize({
    ...setup,
    days: 7,
    arrive: { from: 'DMK', time: '09:15' },
    stay: { mode: 'booked', name: 'Old Hotel' },
  });
  assert.equal(result.days, 4);
  assert.equal(result.title, 'ทริปของเรา');
  assert.equal(normalize({ ...setup, title: 'x'.repeat(201) }).title.length, 200);
  assert.equal(result.arrive.by, 'flight');
  assert.deepEqual(result.stay.stays, [{ name: 'Old Hotel', nights: 3 }]);
  assert.deepEqual(
    result.members.map((person) => person.id),
    ['same', 'same_'],
  );
  assert.throws(() => normalize({ ...setup, startDate: '2026-02-30' }), { code: 'bad_request' });
});
test('plans from candidate picks, streams days, and anchors both booked stays', async () => {
  const candidates = (await stream('/api/plan/candidates', { setup })).last;
  assert.ok(candidates.questions[0].options[0].id.startsWith('c'));
  const pick = candidates.questions[0].options[0];
  const { events, last } = await stream('/api/plan', {
    setup: { ...setup, title: '  วันหยุดกับเพื่อน  ', picks: { must: [pick], avoid: [] } },
  });
  assert.equal(last.type, 'done');
  assert.equal(last.plan.setup.title, 'วันหยุดกับเพื่อน');
  assert.equal(events.filter((event) => event.type === 'day').length, 4);
  for (const index of [0, 1, 2, 3]) {
    const updates = events.filter(event => event.index === index && ['map', 'day'].includes(event.type));
    assert.equal(updates[0].type, 'map');
    assert.deepEqual(updates[0].routes, {});
    assert.equal(updates.at(-1).type, 'day');
    assert.equal(updates.filter(event => event.type === 'day').length, 1);
  }
  assert.equal(last.plan.days[0].stops[0].start, '09:15');
  assert.deepEqual(last.plan.days[0].stops[0].ll, pick.ll);
  assert.equal(last.plan.days[0].stops[0].place.source, 'pick');
  assert.equal(last.plan.days[2].stops[0].name, 'Hotel A');
  assert.equal(last.plan.days[2].stops.at(-1).name, 'Hotel B');
  assert.equal(last.plan.days[3].stops[0].name, 'Hotel B');
  for (const stop of last.plan.days.flatMap((day) => day.stops)) {
    assert.ok(stop.ll.every(Number.isFinite));
    if (stop.leg) assert.ok(last.routes[stop.leg.key].geom.length >= 2);
  }
});
test('removes an offline stop without altering unrelated days and rejects empty commands', async () => {
  const { last: demo } = await stream('/api/demo');
  assert.equal(demo.plan.city, 'เชียงใหม่');
  assert.equal(demo.plan.setup.title, 'ทริปของเรา');
  assert.equal(demo.plan.setup.members.length, 4);
  const { events, last: result } = await stream('/api/replan', {
    plan: demo.plan, command: 'ตัดน้ำตกบัวตองออก', day: 1, demo: true,
  });
  const steps = events.filter((event) => event.type === 'step').map((event) => event.text);
  assert.match(steps[0], /แผนเดิม/);
  assert.match(steps[1], /ตรวจเวลา.*1 ทางเลือก/);
  assert.match(steps.at(-1), /ทางเลือก A.*฿/);
  assert.equal(result.type, 'done');
  assert.equal(result.needs_vote, false);
  const revised = result.options[0].plan;
  assert.equal(
    revised.days[1].stops.some((stop) => stop.name === 'น้ำตกบัวตอง'),
    false,
  );
  assert.equal(revised.days[0].stops[0].name, demo.plan.days[0].stops[0].name);
  assert.equal((await stream('/api/replan', { plan: demo.plan, command: '' })).last.code, 'bad_request');
});
test('replanning an existing trip preserves its title when an older caller omits it', async () => {
  const { last: demo } = await stream('/api/demo');
  const plan = demo.plan;
  const oldSetup = { ...plan.setup };
  delete oldSetup.title;
  plan.setup.title = 'วันหยุดกับเพื่อน';
  for (const [draft, expected] of [
    [oldSetup, 'วันหยุดกับเพื่อน'],
    [{ ...oldSetup, title: '  เที่ยวกับครอบครัว  ' }, 'เที่ยวกับครอบครัว'],
  ]) {
    const { last: result } = await stream('/api/replan', {
      plan,
      setup: draft,
      command: 'ตัดน้ำตกบัวตองออก',
      demo: true,
    });
    assert.equal(result.type, 'done');
    assert.equal(result.options[0].plan.setup.title, expected);
  }
});
test('validates API inputs and serves the Thai interface', async () => {
  assert.equal((await stream('/api/plan', { setup: { ...setup, members: [] } })).last.code, 'bad_request');
  assert.equal((await stream('/api/place-info', { city: 'ดานัง' })).last.code, 'bad_request');
  assert.equal((await stream('/api/transport-options', { setup, dir: 'out' })).last.code, 'bad_request');
  assert.equal((await fetch(base + '/api/unknown')).status, 404);
  assert.match(await (await fetch(base)).text(), /<html lang="th">/);
});
test('weather ignores indoor stops, batches coordinates and reports heavy rain', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      hourly: {
        time: ['2026-11-25T14:00', '2026-11-25T15:00'],
        precipitation: [0.4, 2.5],
        precipitation_probability: [90, 20],
      },
    }),
  );
  const stop = { id: 'a', name: 'น้ำตก', ll: [19, 99], kind: 'nature', start: '14:00', end: '15:30' };
  const result = await weather(
    {
      days: [
        { date: '2026-11-25', stops: [stop, { ...stop, id: 'b' }, { ...stop, id: 'c', kind: 'museum' }] },
      ],
    },
    new AbortController().signal,
    '2026-11-21',
  );
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(result.alerts.length, 2);
  assert.equal(result.alerts[0].level, 'heavy');
  assert.equal(result.alerts[0].to, '15:00');
  assert.equal(result.alerts[0].trend, true);
});
