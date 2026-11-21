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
  answer.needs_vote = false;
  answer.options[0].edits = [{ op: 'replace', id: 'a', stop: { cost: 1000 } }];
  const second = await replan({ plan: base, setup, command: 'เลือกแผนเดียว' }, ctx());
  assert.equal(second.needs_vote, false);
  assert.equal(second.options.length, 1);
  assert.equal(second.vote_reason, undefined);
  assert.equal(second.options[0].vote_reason, undefined);
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

test('a return recommendation leaves a blank outbound location unresolved', async (t) => {
  const requests = [];
  mockProvider(t, {
    bop_transport: { options: [{ by: 'train', carrier: 'Rail', dep: '20:30', arr: '22:00' }] },
    bop_repair: { edits: [] },
    bop_design: {
      days: [{ stops: [stop('station', 'สถานี', '19:30', '19:40', { k: 'transit' })] }],
      arrivalSuggested: { by: 'flight', why: 'outbound suggestion' },
    },
  }, requests);
  const setup = normalize({
    ...d,
    arrive: { by: 'undecided', from: '', auto: true },
    depart: { by: 'undecided', to: 'กรุงเทพฯ', auto: true },
    picks: { must: [{ name: 'สถานี', ll: point }] },
  });
  const { plan } = await planTrip(setup, ctx());
  assert.equal(requests.filter(({ op }) => op === 'bop_transport').length, 1);
  assert.equal(plan.setup.arrive.from, '');
  assert.equal(plan.flags.transport.go, undefined);
  assert.equal(plan.flags.arrivalSuggested, undefined);
  assert.equal(plan.flags.departureSuggested.by, 'train');
  assert.equal(plan.flags.transport.back.requestedBy, 'undecided');
  assert.equal(plan.setup.depart.time, '20:30');
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
