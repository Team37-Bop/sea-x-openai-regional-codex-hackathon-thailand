import assert from 'node:assert/strict';
import test from 'node:test';

process.env.BOP_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'fixture-key';
delete process.env.BOP_FAKE_LLM;
process.env.BOP_SEARCH_PLAN = '0';
const { normalize } = await import('../server/domain.mjs');
const { planTrip, replan, transport } = await import('../server/plan.mjs');
const ctx = () => ({ signal: new AbortController().signal, emit() {}, step() {}, usage: {} });
const d = { startDate: '2026-11-21', days: 1, city: 'ดานัง', members: [{ name: 'มิน' }] };
function mockProvider(t, replies, requests) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(String(url), /api\.openai\.com/);
    const body = JSON.parse(init.body);
    const op = body.text.format.name;
    requests.push({ op, body });
    const value = replies[op];
    assert.ok(value, 'unexpected model operation ' + op);
    const event = {
      type: 'response.completed',
      response: {
        status: 'completed',
        usage: { input_tokens: 10, output_tokens: 4 },
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }],
          },
        ],
      },
    };
    return new Response('event: response.completed\ndata: ' + JSON.stringify(event) + '\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
}
const point = [16.0544, 108.2022];
const stop = (id, n, start, end, extra = {}) => ({
  id,
  n,
  k: 'sight',
  ll: point,
  t0: start,
  t1: end,
  ...extra,
});
test('single design caps searches at zero, uses exact picks, drops extra days and preserves independently verified fields', async (t) => {
  const requests = [];
  const lunch = stop('same', 'ตลาด', '12:00', '12:30', {
    k: 'food',
    meal: 'lunch',
    src: { checked: 'web', url: 'https://invented.example/x', title: 'เว็บ' },
  });
  const dinner = stop('same', 'ตลาดเย็น', '18:00', '18:30', { k: 'food', meal: 'dinner' });
  mockProvider(
    t,
    {
      bop_design: {
        days: [
          { title: 'ดานัง', stops: [lunch, dinner] },
          { title: 'เกิน', stops: [] },
        ],
      },
    },
    requests,
  );
  const result = await planTrip(normalize({ ...d, picks: { must: [{ name: 'ตลาด', ll: point }] } }), ctx());
  assert.deepEqual(
    requests.map((r) => r.op),
    ['bop_design'],
  );
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(result.plan.days.length, 1);
  assert.equal(result.plan.days[0].stops[1].id, 'same_2');
  assert.equal(result.plan.days[0].stops[0].place.source, 'pick');
  assert.equal(result.plan.days[0].stops[0].src.checked, 'estimate');
  assert.equal(result.plan.days[0].stops[1].src, undefined);
  assert.equal(result.usage.provider, 'openai');
  assert.equal(result.plan.report.pass, result.plan.checks.length);
});
test('short plans recover omitted days with a daily design and stream pins, routes and completed days once', async (t) => {
  const requests = [], events = [];
  const day = (suffix) => ({ title: suffix, stops: [
    stop('lunch' + suffix, 'Lunch ' + suffix, '12:00', '12:40', { k: 'food', meal: 'lunch' }),
    stop('dinner' + suffix, 'Dinner ' + suffix, '18:00', '18:40', { k: 'food', meal: 'dinner' }),
  ] });
  mockProvider(t, { bop_design: { days: [day('one')] }, bop_daily: { days: [day('two')] } }, requests);
  const picks = ['one', 'two'].flatMap(s => ['Lunch ', 'Dinner '].map(n => ({ name: n + s, ll: point })));
  const result = await planTrip(normalize({ ...d, days: 2, picks: { must: picks } }), {
    ...ctx(), emit: event => events.push(event),
  });
  assert.deepEqual(requests.map(r => r.op), ['bop_design', 'bop_daily']);
  assert.deepEqual(result.plan.days.map(day => day.title), ['one', 'two']);
  for (const i of [0, 1]) {
    const sequence = events.filter(e => e.index === i);
    assert.deepEqual(sequence.map(e => e.type), ['map', 'map', 'map', 'day']);
    assert.deepEqual(sequence.slice(0, 3).map(e => [e.day.stops.length, Object.keys(e.routes).length]), [[1,0],[2,0],[2,1]]);
    const routed = sequence[2], key = routed.day.stops[1].leg.key;
    assert.ok(routed.routes[key].approx);
    assert.equal(routed.day.date, result.plan.days[i].date);
  }
});
test('a missing day with an empty daily response rejects the shortened trip', async t => {
  const requests = [];
  mockProvider(t, { bop_design: { days: [{ stops: [] }] }, bop_daily: { days: [{ stops: [] }] } }, requests);
  await assert.rejects(planTrip(normalize(d), ctx()), /วันที่ 1/);
  assert.deepEqual(requests.map(r=>r.op), ['bop_design', 'bop_daily']);
});
test('the final plan keeps the earlier checks when a repair is worse, empty or an invalid edit', async (t) => {
  const lunch = stop('lunch', 'ตลาดกลางวัน', '12:00', '12:40', { k: 'food', meal: 'lunch', diet: false });
  const dinner = stop('dinner', 'ตลาดเย็น', '18:00', '18:40', { k: 'food', meal: 'dinner', diet: true });
  const input = normalize({
    ...d, members: [{ name: 'มิน', avoid: 'กุ้ง' }],
    picks: { must: [lunch, dinner].map((s) => ({ name: s.n, ll: point })) },
  });
  const repair = { edits: [] };
  mockProvider(t, { bop_design: { days: [{ stops: [lunch, dinner] }] }, bop_repair: repair }, []);
  for (const [edits, reason] of [
    [[{ op: 'remove', id: 'dinner' }], 'worse'],
    [[], 'unchanged'],
    [[{ op: 'remove', id: 'missing-stop' }], 'unchanged'],
  ]) {
    repair.edits = edits;
    const { plan, repaired } = await planTrip(input, ctx());
    assert.equal(repaired, false);
    assert.equal(plan.repairOutcome.status, 'kept');
    assert.equal(plan.repairOutcome.reason, reason);
    assert.deepEqual(plan.repairOutcome.changes, []);
    assert.deepEqual(plan.repairOutcome.after, plan.repairOutcome.before);
    assert.ok(plan.repairOutcome.after.failures.some((rule) => rule.label.includes('กุ้ง')));
    assert.equal(plan.days[0].stops.length, 2);
  }
});
test('a repair belongs only to its own proposed option and a stale outcome stays with the original trip', async (t) => {
  const setup = normalize(d);
  const original = {
    city: setup.city, setup, flags: {}, repairOutcome: { status: 'earlier' },
    days: [{ date: setup.startDate, stops: [
      stop('lunch', 'ข้าวเที่ยง', '12:00', '12:40', { k: 'food', meal: 'lunch', place: { source: 'pick' } }),
      stop('dinner', 'ข้าวเย็น', '18:00', '18:40', { k: 'food', meal: 'dinner', place: { source: 'pick' } }),
    ] }],
  };
  const replies = {
    bop_replan: { needs_vote: true, options: [
      { title: 'ปรับมื้อเที่ยง', edits: [{ op: 'replace', id: 'lunch', stop: { meal: 'breakfast' } }] },
      { title: 'คงมื้อเที่ยง', edits: [] },
    ] },
    bop_repair: { edits: [{ op: 'replace', id: 'lunch', stop: { meal: 'lunch' } }] },
  };
  mockProvider(t, replies, []);
  const result = await replan({ plan: original, command: 'ช่วยดูมื้อเที่ยง' }, ctx());
  assert.equal(result.repaired, true);
  const [changed, untouched] = result.options;
  assert.equal(changed.plan.repairOutcome.status, 'applied');
  assert.equal(changed.plan.repairOutcome.after.passed, changed.plan.repairOutcome.before.passed + 1);
  assert.deepEqual(changed.plan.repairOutcome.changes, ['วันที่ 1 · ปรับมื้ออาหารที่ ข้าวเที่ยง']);
  assert.equal(untouched.plan.repairOutcome, undefined);
  assert.equal(original.repairOutcome.status, 'earlier');
  replies.bop_repair.edits = [];
  const kept = await replan({ plan: original, command: 'ช่วยดูมื้อเที่ยง' }, ctx());
  assert.equal(kept.repaired, false);
  assert.equal(kept.options[0].plan.repairOutcome.status, 'kept');
  assert.equal(kept.options[1].plan.repairOutcome, undefined);
});
test('replan obeys model vote decision with independent candidate plans, even for equal costs', async (t) => {
  const setup = normalize(d),
    requests = [];
  const base = {
    city: setup.city,
    setup,
    flags: {},
    days: [
      {
        date: setup.startDate,
        stops: [
          stop('a', 'อาหารกลางวัน', '12:00', '12:40', { k: 'food', meal: 'lunch' }),
          stop('b', 'อาหารเย็น', '18:00', '18:40', { k: 'food', meal: 'dinner' }),
        ],
      },
    ],
  };
  const answer = {
    needs_vote: true,
    day: 10,
    vote_reason: 'เลือกว่าจะเลื่อนเวลาไหม',
    options: [
      {
        title: 'เลื่อนมื้อเย็นช้าลง',
        edits: [{ op: 'replace', id: 'b', stop: { t0: '19:00', t1: '19:40' } }],
      },
      { title: 'เลื่อนมื้อกลางวัน', edits: [{ op: 'replace', id: 'a', stop: { t0: '13:00', t1: '13:40' } }] },
    ],
  };
  for (const s of base.days[0].stops) s.place = { source: 'model' };
  mockProvider(t, { bop_replan: answer }, requests);
  const result = await replan({ plan: base, setup, command: 'ช่วยเปลี่ยนเวลา', day: 12 }, ctx());
  assert.equal(result.needs_vote, true);
  assert.deepEqual(
    result.options.map((o) => o.key),
    ['A', 'B'],
  );
  assert.equal(result.day, 0);
  assert.equal(result.options[0].plan.days[0].stops[0].start, '12:00');
  assert.equal(result.options[1].plan.days[0].stops[1].start, '18:00');
  assert.equal(result.setup, undefined);
  assert.equal(result.vote_reason, answer.vote_reason);
  answer.vote_reason = ' ';
  const undecided = await replan({ plan: base, setup, command: 'เลือกมื้อที่จะเลื่อน' }, ctx());
  for (const option of undecided.options) {
    assert.ok(undecided.vote_reason.includes(option.title));
    assert.equal(option.vote_reason, undecided.vote_reason);
  }
  assert.match(undecided.summary, /ให้กลุ่มตัดสินใจ/);
  answer.needs_vote = false;
  answer.options[0].edits = [{ op: 'replace', id: 'a', stop: { cost: 1000 } }];
  const second = await replan({ plan: base, setup, command: 'เลือกแผนเดียว' }, ctx());
  assert.equal(second.needs_vote, false);
  assert.equal(second.options.length, 1);
  assert.equal(second.vote_reason, undefined);
  assert.equal(second.options[0].vote_reason, undefined);
  assert.equal(second.summary, second.options[0].title);
});
test('a booked choice bypasses search, new transport uses the fitting estimated price and retimes the endpoints', async (t) => {
  const requests = [];
  const options = [
    { by: 'flight', carrier: 'Night', dep: '15:00', arr: '18:30', price: 500, recommended: true },
    { by: 'train', carrier: 'Train', dep: '07:00', arr: '09:30', price: 360 },
    { by: 'flight', carrier: 'Air', dep: '08:30', arr: '10:30', price: 990 },
  ];
  const depChoice = { id: 'back-kept', by: 'train', carrier: 'Rail', dep: '20:00', arr: '22:30', price: 260 };
  const stops = [
    stop('terminal', 'สถานี', '10:00', '10:15', { k: 'transit' }),
    stop('lunch', 'กลางวัน', '12:00', '12:45', { k: 'food', meal: 'lunch' }),
    stop('dinner', 'เย็น', '18:00', '18:30', { k: 'food', meal: 'dinner' }),
    stop('dep', 'สถานีขากลับ', '19:20', '19:20', { k: 'transit' }),
  ];
  mockProvider(t, { bop_transport: { options }, bop_design: { days: [{ stops }] } }, requests);
  const setup = normalize({
    ...d,
    arrive: { by: 'undecided', auto: true, from: 'BKK' },
    depart: { by: 'train', to: 'BKK', choice: depChoice },
    picks: { must: [{ name: 'สถานี', ll: point }] },
  });
  const result = await planTrip(setup, ctx());
  const { flags } = result.plan;
  assert.equal(flags.transport.go.chosen, 'go-2');
  assert.equal(flags.transport.go.requestedBy, 'undecided');
  assert.equal(flags.transport.back.chosen, 'back-kept');
  assert.equal(flags.transport.back.requestedBy, undefined);
  assert.equal(flags.transport.back.options.length, 1);
  assert.equal(flags.arrivalSuggested.by, 'train');
  assert.equal(result.plan.days[0].stops[0].t0, '09:30');
  assert.equal(result.plan.days[0].stops.at(-1).t0, '19:20');
  assert.equal(requests.filter((q) => q.op === 'bop_transport').length, 1);
  assert.equal(requests.find((q) => q.op === 'bop_transport').body.max_tool_calls, 4);
  const only = await transport(setup, 'back', ctx());
  assert.equal(only[0].id, 'back-kept');
});

test('a live extension designs only the added day and schedules its stops on the correct date', async (t) => {
  const requests = [];
  const setup = normalize({ ...d, picks: { must: [{ name: 'ตลาดใหม่', ll: point }] } });
  const original = {
    setup, city: setup.city, flags: {},
    days: [{ date: setup.startDate, stops: [stop('old', 'ตลาดเดิม', '10:00', '11:00', { place: { source: 'pick' } })] }],
  };
  mockProvider(t, { bop_daily: { days: [{ title: 'ตลาดใหม่', stops: [
    stop('new', 'ตลาดใหม่', '11:20', '12:10', { k: 'food', meal: 'lunch' }),
  ] }] } }, requests);
  const result = await replan({ plan: original, command: 'เพิ่มอีกหนึ่งวัน' }, ctx());
  const updated = result.options[0].plan;
  assert.deepEqual(requests.map((r) => r.op), ['bop_daily']);
  assert.equal(updated.setup.endDate, '2026-11-22');
  assert.equal(updated.days[1].date, updated.setup.endDate);
  assert.equal(updated.days[1].stops[0].name, 'ตลาดใหม่');
  assert.equal(updated.days[0].stops[0].id, 'old');
  assert.equal(original.days.length, 1);
});

test('a Bangkok trip arranges local arrival independently of its intercity return', async (t) => {
  const requests = [];
  mockProvider(t, {
    bop_transport: { options: [{ by: 'train', carrier: 'Rail', dep: '20:30', arr: '22:00' }] },
    bop_repair: { edits: [] },
    bop_design: {
      days: [{ stops: [stop('station', 'สถานี', '19:30', '19:40', { k: 'transit' })] }],
      arrivalSuggested: { by: 'local', why: 'ต่อรถไฟฟ้าไปยังจุดนัดพบ' },
    },
  }, requests);
  const setup = normalize({
    ...d, city: 'กรุงเทพฯ',
    arrive: { by: 'undecided', from: '', auto: true },
    depart: { by: 'undecided', to: 'เชียงใหม่', auto: true },
    picks: { must: [{ name: 'สถานี', ll: point }] },
  });
  const { plan } = await planTrip(setup, ctx());
  assert.equal(requests.filter(({ op }) => op === 'bop_transport').length, 1);
  assert.equal(plan.setup.arrive.from, 'กรุงเทพฯ');
  assert.equal(plan.flags.transport.go, undefined);
  assert.deepEqual(plan.flags.arrivalSuggested, { by: 'local', why: 'ต่อรถไฟฟ้าไปยังจุดนัดพบ' });
  assert.equal(plan.flags.departureSuggested.by, 'train');
  assert.equal(plan.flags.transport.back.requestedBy, 'undecided');
  assert.equal(plan.setup.depart.time, '20:30');
});

test('archived blank legs compare both Bangkok directions for London and retain the estimated status', async (t) => {
  const requests = [], steps = [];
  mockProvider(t, {
    bop_transport: { options: [{ by: 'flight', carrier: 'Example', dep: '20:30', arr: '09:00', price: 18000, checked: 'web' }] },
    bop_design: { days: [{ stops: [stop('visit', 'Museum', '12:00', '13:00')] }] },
    bop_repair: { edits: [] },
  }, requests);
  const setup = normalize({
    ...d, city: 'London', cityLL: point, country: 'GB', cityAirport: 'LHR',
    arrive: { by: 'flight', from: '', auto: true }, depart: { by: 'undecided', to: '', auto: true },
    picks: { must: [{ name: 'Museum', ll: point }] },
  });
  const { plan } = await planTrip(setup, { ...ctx(), step: (s) => steps.push(s) });
  const lookups = requests.filter(({ op }) => op === 'bop_transport')
    .map(({ body }) => JSON.parse(body.input.at(-1).content.split('ข้อมูล JSON:\n').at(-1)));
  assert.deepEqual(lookups.map((q) => q.dir).sort(), ['back', 'go']);
  for (const q of lookups) {
    assert.equal(q.setup.arrive.from, 'BKK');
    assert.equal(q.setup.depart.to, 'กรุงเทพฯ');
  }
  assert.equal(setup.arrive.from, '');
  assert.equal(plan.setup.arrive.endpointDefault, true);
  for (const direction of ['go', 'back']) {
    assert.equal(plan.flags.transport[direction].chosenOption.checked, 'estimate');
    assert.equal(plan.flags.transport[direction].chosenOption.bookable, undefined);
  }
  assert.ok(steps.every((s) => !s.includes('ข้ามการค้นหา')));
});

test('default return follows the organizer’s origin, explicit endpoints or tickets take precedence, omitted legs stay absent', async () => {
  const { resolveTransportEndpoints, localTransport } = await import('../web/transport-endpoints.js');
  const travel = (arrive, depart) => resolveTransportEndpoints({ city: 'Bangkok', arrive, depart });
  const first = { by: 'flight', from: 'CNX', time: '08:45' };
  assert.equal(travel(first, { by: 'flight' }).depart.to, 'CNX');
  assert.deepEqual(travel(first, { by: 'train', to: 'อยุธยา', time: '17:40' }).depart, { by: 'train', to: 'อยุธยา', time: '17:40' });
  const booked = travel({ by: 'flight', choice: { from: 'HKT' } }, undefined);
  assert.equal(booked.arrive.from, 'HKT');
  assert.equal(booked.arrive.endpointDefault, undefined);
  assert.equal(booked.depart, undefined);
  assert.equal(localTransport(travel({ by: 'flight', from: 'DMK' }, {}), 'go'), true);
  assert.equal(localTransport(travel(first, {}), 'back'), false);
});

test('a local round trip with flight selected keeps local timing without a check-in or a flight search', async (t) => {
  const requests = [];
  mockProvider(t, {
    bop_design: { days: [{ stops: [stop('first', 'จุดนัดพบ', '07:30', '08:00'),
      stop('end', 'จุดต่อรถ', '18:00', '18:00', { k: 'transit' })] }] },
    bop_repair: { edits: [] },
  }, requests);
  const { plan } = await planTrip(normalize({
    ...d, city: 'กรุงเทพฯ', arrive: { by: 'flight', auto: true }, depart: { by: 'flight', auto: true },
    picks: { must: ['จุดนัดพบ', 'จุดต่อรถ'].map(name => ({ name, ll: point })) },
  }), ctx());
  assert.equal(requests.some(({ op }) => op === 'bop_transport'), false);
  assert.equal(plan.checks.some(({ id }) => id === 'departure'), false);
  assert.deepEqual(plan.days[0].stops.map(s => s.t0), ['10:00', '18:00']);
  assert.equal(plan.setup.depart.by, 'flight');
  assert.equal(plan.flags.departureSuggested.by, 'local');
});

test('design, daily planning and edit schemas identify units and constrain categories for both providers', async () => {
  const { openaiShapes, claudeShapes } = await import('../server/model-shapes.mjs');
  const objectSchema = (s) => (s.properties ? s : s.anyOf.find((v) => v.properties));
  const stopFor = (shapes, op) => {
    const root = shapes[op].properties;
    if (root.days) return root.days.items.properties.stops.items.properties;
    const edit = (root.edits ?? root.options.items.properties.edits).items.properties;
    return objectSchema(edit.stop).properties;
  };
  for (const schemas of [openaiShapes, claudeShapes])
    for (const op of ['design', 'daily', 'repair', 'replan']) {
      const stop = stopFor(schemas, op);
      assert.match(stop.walk.description, /on-site walking distance in kilometres/i);
      assert.match(stop.walk.description, /never put minutes/i);
      assert.match(stop.walk.description, /between stops/i);
      assert.ok(
        ['food', 'sight', 'hotel', 'nature', 'view', 'transit', 'market'].every((k) => stop.kind.enum.includes(k)),
      );
      assert.match(stop.kind.description, /café/);
      assert.match(stop.diet.description, /every stated food restriction/);
      assert.ok(stop.meal.enum.includes('lunch'));
      assert.match(stop.legCost.description, /THB per person/);
      if (stop.legMin) assert.match(stop.legMin.description, /travel duration in minutes/);
    }
  assert.ok(stopFor(openaiShapes, 'repair').kind.enum.includes(null), 'optional edit kind must accept null');
});
