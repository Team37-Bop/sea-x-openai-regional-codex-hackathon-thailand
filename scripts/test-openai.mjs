import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createApi } from '../server/api.mjs';
import { createOpenAI, OPENAI_FAST_MODELS, OPENAI_MODEL } from '../server/openai.mjs';

assert.equal(OPENAI_MODEL, 'gpt-6.2-astra');
assert.deepEqual(OPENAI_FAST_MODELS.slice(-2), ['gpt-6.2-sol', 'gpt-6-luna']);
console.log('ok   OpenAI tiers map Astra, Sol, and Luna to deep and fast work');

async function health(options) {
  const api = createApi({ ...options, log: { info() {}, warn() {} } });
  const request = Readable.from([]);
  request.url = '/api/health';
  request.method = 'GET';
  request.headers = {};
  let status;
  let text = '';
  const response = {
    writableEnded: false,
    writeHead(code) { status = code; },
    write(chunk) { text += chunk; },
    end(chunk = '') { text += chunk; this.writableEnded = true; },
    on() {},
  };
  await api(request, response, () => {});
  return { status, body: JSON.parse(text) };
}

const selected = await health({ provider: 'openai', openaiKey: 'service-account-test-key' });
assert.equal(selected.status, 200);
assert.equal(selected.body.provider, 'openai');
assert.equal(selected.body.model, 'gpt-6.2-astra');
assert.equal(selected.body.ai, true);
console.log('ok   BOP_PROVIDER=openai selects the service-account provider');

let requestBody;
const fetchImpl = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  requestBody = JSON.parse(await request.clone().text());
  const completed = {
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"options":[]}', annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 1 } },
  };
  const events = [
    { type: 'response.output_text.delta', delta: '{"options":[]}', item_id: 'msg_test', output_index: 0, content_index: 0, sequence_number: 1, logprobs: [] },
    { type: 'response.completed', response: completed, sequence_number: 2 },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

const llm = createOpenAI({ apiKey: 'service-account-test-key', fetch: fetchImpl, log: { info() {}, warn() {} } });
const result = await llm.transport({ prompt: 'test', loc: { cc: 'TH', name: 'Bangkok' }, usage: {}, onStep() {} });
assert.deepEqual(result.json.options, []);
assert.equal(requestBody.model, 'gpt-6.2-sol');
assert.equal(requestBody.store, false);
assert.equal(requestBody.stream, true);
assert.equal(requestBody.tools[0].type, 'web_search');
assert.equal(requestBody.text.format.type, 'json_schema');
console.log('ok   Responses API uses streaming, structured output, web search, and store=false');

console.log('all passed');
