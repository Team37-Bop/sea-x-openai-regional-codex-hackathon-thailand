import assert from 'node:assert/strict';
import test from 'node:test';

process.env.OPENAI_API_KEY = 'test-service-key';
process.env.ANTHROPIC_API_KEY = 'test-alternative';
process.env.BOP_PROVIDER = 'auto';
delete process.env.BOP_FAKE_LLM;
const runtime = await import('../server/model.mjs');
function sse(events) {
  const text = events
    .map((event) => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n')
    .join('');
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
}
const output = (text) => ({ type: 'message', content: [{ type: 'output_text', text, annotations: [] }] });
const complete = (output, usage = {}) => ({
  type: 'response.completed',
  response: { status: 'completed', output, usage },
});
const setup = { city: 'ดานัง', country: 'VN', days: 2 };
function context(operation, extra = {}) {
  return { operation, usage: {}, signal: new AbortController().signal, step: () => {}, ...extra };
}
test('chooses the service key first, respects forced providers and fake override', async () => {
  assert.equal(runtime.selectProvider({ OPENAI_APIKEY: 'x', ANTHROPIC_API_KEY: 'y' }, true), 'openai');
  assert.equal(runtime.selectProvider({ BOP_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'y' }, true), null);
  assert.equal(
    runtime.selectProvider({ BOP_PROVIDER: 'api', OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }, true),
    'anthropic',
  );
  assert.equal(
    runtime.selectProvider({ BOP_PROVIDER: 'bogus', OPENAI_API_KEY: ' ', ANTHROPIC_API_KEY: 'y' }, true),
    'anthropic',
  );
  assert.equal(runtime.selectProvider({ BOP_PROVIDER: 'openai', BOP_FAKE_LLM: '1' }, false), 'fake');
  const health = await runtime.health();
  assert.equal(health.ai, true);
  assert.equal(health.provider, 'openai');
  assert.equal(health.model, 'gpt-6.2-astra');
  assert.ok(!JSON.stringify(health).includes('test-service-key'));
});
test('Responses streams search evidence, progress, structured output, and sticky eligible fast fallback', async (t) => {
  const requests = [],
    steps = [];
  const source = 'https://public.example/source',
    cited = 'https://public.example/cited';
  const search = {
    type: 'web_search_call',
    id: 's1',
    action: { type: 'search', query: 'Da Nang', sources: [{ url: source }] },
  };
  const message = output('{"summary":"ไทย","sources":[{"url":"https://invented.example/"}]}');
  message.content[0].annotations.push({ type: 'url_citation', url: cited, title: 'Cited' });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-service-key');
    if (requests.length === 1)
      return Response.json(
        { error: { code: 'model_not_found', message: 'Model not available' } },
        { status: 404 },
      );
    return sse([
      { type: 'response.output_item.done', item: search },
      complete([search, message], {
        input_tokens: 10,
        output_tokens: 2,
        input_tokens_details: { cached_tokens: 3 },
      }),
    ]);
  });
  const ctx = context('research', { searches: 3, step: (text) => steps.push(text) });
  const result = await runtime.model('research', setup, ctx);
  assert.deepEqual(
    requests.map((x) => x.model),
    ['gpt-6.2-sol', 'gpt-6-luna'],
  );
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].text.format.name, 'bop_research');
  assert.equal(requests[0].text.format.strict, false);
  assert.deepEqual(requests[0].tools[0].user_location, { type: 'approximate', city: 'ดานัง', country: 'VN' });
  assert.equal(requests[0].max_tool_calls, 3);
  assert.deepEqual([...result.verified].sort(), [source, cited].sort());
  assert.deepEqual([...result.cited], [cited]);
  assert.equal(ctx.usage.web_search_requests, 1);
  assert.equal(ctx.usage.input_tokens, 10);
  assert.equal(ctx.usage.cache_read_input_tokens, 3);
  assert.equal(ctx.usage.provider, 'openai');
  assert.ok(steps.some((s) => s.includes('Da Nang')));
  await runtime.model('research', setup, ctx);
  assert.equal(requests.at(-1).model, 'gpt-6-luna');
});
test('deep design streams day boundaries; repair carries history and disables all tools', async (t) => {
  const bodies = [],
    steps = [];
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.text.format.name === 'bop_repair') return sse([complete([output('{"edits":[]}')])]);
    return sse([
      { type: 'response.output_text.delta', delta: '{"days":[{"st' },
      { type: 'response.output_text.delta', delta: 'ops":[]},{"stops":[]}]}' },
      complete([output('{"days":[{"stops":[]},{"stops":[]}]}')]),
    ]);
  });
  const reply = await runtime.model(
    'design',
    setup,
    context('design', { searches: 5, step: (s) => steps.push(s) }),
  );
  assert.ok(steps.includes('ร่างวันที่ 2 จาก 2'));
  await runtime.model(
    'repair',
    { errors: ['too late'] },
    context('repair', { searches: 3, history: reply.messages }),
  );
  assert.equal(bodies[0].model, 'gpt-6.2-astra');
  assert.equal(bodies[0].max_output_tokens, 32000);
  assert.equal(bodies[1].max_output_tokens, 16000);
  assert.equal(bodies[1].tools, undefined);
  assert.deepEqual(
    bodies[1].input.map((m) => m.role),
    ['user', 'assistant', 'user'],
  );
});
test('content filters, incomplete required plans, interrupted streams, auth, and quota are terminal', async (t) => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => response());
  for (const [code, create] of [
    [
      'refusal',
      () =>
        sse([
          { type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } },
        ]),
    ],
    ['refusal', () => sse([complete([{ type: 'message', content: [{ type: 'refusal' }] }])])],
    ['upstream', () => sse([{ type: 'response.output_text.delta', delta: '{"days":[]}' }])],
    ['upstream', () => sse([complete([output('{"days":[{}]}')])])],
    ['auth', () => Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 })],
    [
      'rate_limit',
      () =>
        Response.json(
          { error: { code: 'insufficient_quota' } },
          { status: 429, headers: { 'x-should-retry': 'false' } },
        ),
    ],
  ]) {
    response = create;
    await assert.rejects(runtime.model('plan', setup, context('design')), { code });
  }
  response = () => sse([complete([output('invalid research')])]);
  assert.deepEqual((await runtime.model('research', setup, context('research'))).value, {});
});
function anthropicEvents(blocks, stop) {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 4 } } },
    ...blocks.flatMap((block, index) => [
      { type: 'content_block_start', index, content_block: block },
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ];
}
test('Anthropic retries unsupported fallbacks and continues pause_turn with the original assistant blocks', async (t) => {
  process.env.BOP_PROVIDER = 'anthropic';
  const other = await import('../server/model.mjs?test=anthropic');
  let index = 0;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (index++ === 0)
      return Response.json(
        { error: { type: 'invalid_request_error', message: 'Unsupported fallbacks' } },
        { status: 400 },
      );
    if (index === 2)
      return sse(
        anthropicEvents(
          [
            { type: 'server_tool_use', id: 'search1', name: 'web_search', input: { query: 'city' } },
            {
              type: 'web_search_tool_result',
              tool_use_id: 'search1',
              content: [{ type: 'web_search_result', url: 'https://public.example/result' }],
            },
          ],
          'pause_turn',
        ),
      );
    return sse(anthropicEvents([{ type: 'text', text: '{"summary":"yes"}' }], 'end_turn'));
  });
  const ctx = context('research', { searches: 3 });
  const result = await other.model('find', setup, ctx);
  assert.equal(requests[0].model, 'claude-sonnet-5-5');
  assert.equal(requests[0].fallbacks, 'default');
  assert.equal(requests[1].fallbacks, undefined);
  assert.equal(requests[2].fallbacks, undefined);
  assert.equal(requests[2].messages.at(-1).content.length, 2);
  assert.equal(requests[2].tools[0].max_uses, 2);
  assert.deepEqual([...result.verified], ['https://public.example/result']);
  assert.equal(ctx.usage.input_tokens, 8);
  assert.equal(result.value.summary, 'yes');
});

test('fake design honors must and avoid choices, and offers sample transport with no booking reference', async () => {
  process.env.BOP_FAKE_LLM = '1';
  const fixture = await import('../server/model.mjs?test=fixture');
  const setup = { city:'ดานัง', days:3, arrive:{by:'flight',from:'DMK'},
    picks:{must:[{name:'สะพานมังกร',ll:[16.0611,108.2276]}],avoid:[{name:'ตลาดฮัน',query:'Han Market'}]} };
  const result = await fixture.model('fixture',setup,context('design'));
  const stops = result.value.days.flatMap(day=>day.stops);
  assert.ok(stops.some(s=>s.name==='สะพานมังกร'));
  assert.ok(!stops.some(s=>s.name==='ตลาดฮัน'));
  assert.equal(result.value.days.length,3);
  const offers = (await fixture.model('fixture',{setup,dir:'go'},context('transport'))).value.options;
  assert.equal(offers.length,2);
  assert.equal(offers[0].from,'DMK');
  assert.ok(offers.every(o=>o.checked==='estimate' && !o.offerId));
});
