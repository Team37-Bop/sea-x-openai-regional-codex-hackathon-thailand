import { httpsUrl } from './place-text.mjs';

const publicMessages = {
  upstream: 'Bop ติดต่อบริการจัดทริปไม่ได้ ลองใหม่อีกครั้ง',
  auth: 'Bop เชื่อมต่อบัญชีไม่ได้',
  no_key: 'Bop ยังไม่ได้เชื่อมต่อบริการจัดทริป',
  refusal: 'Bop ตอบคำขอนี้ไม่ได้',
  rate_limit: 'Bop ใช้โควตาหมดแล้ว ลองใหม่ภายหลัง',
};
export const failure = (code, metadata = {}) =>
  Object.assign(new Error(publicMessages[code]), { code, ...metadata });

function remoteError(status, value) {
  const remote = value?.error ?? value ?? {};
  const reason = [remote.code, remote.type, remote.message].filter(Boolean).join(' ');
  const code =
    [401, 403].includes(status) || /authentication_error|invalid_api_key|permission_error/.test(reason)
      ? 'auth'
      : status === 429 || /rate_limit|insufficient_quota/.test(reason)
        ? 'rate_limit'
        : /content_filter|refusal/.test(remote.code ?? '')
          ? 'refusal'
          : 'upstream';
  const unavailable =
    code === 'upstream' &&
    (status === 404 ||
      ([400, 422].includes(status) &&
        /model[_ ]not[_ ]found|unknown model|model.{0,90}(not (available|found|supported)|does not exist|do not have access|unavailable)/i.test(
          reason,
        )));
  return failure(code, { status, unavailable });
}

const clients = new Map();
async function* stream(name, body, ctx) {
  let pending = clients.get(name);
  if (!pending) {
    const options = {
      apiKey: ctx.key,
      maxRetries: 2,
      timeout: 120_000,
      fetch: (...args) => globalThis.fetch(...args),
    };
    pending =
      name === 'openai'
        ? import('openai').then(
            ({ default: OpenAI }) => new OpenAI({ ...options, baseURL: 'https://api.openai.com/v1' }),
          )
        : import('@anthropic-ai/sdk').then(
            ({ default: Anthropic }) => new Anthropic({ ...options, baseURL: 'https://api.anthropic.com' }),
          );
    clients.set(name, pending);
  }
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(120_000)]);
  try {
    const client = await pending;
    const events =
      name === 'openai'
        ? await client.responses.create(body, { signal })
        : await client.beta.messages.create(
            { ...body, ...(body.fallbacks ? { betas: ['server-side-fallback-2026-07-01'] } : {}) },
            { signal },
          );
    for await (const event of events) yield event;
    signal.throwIfAborted();
  } catch (error) {
    ctx.signal.throwIfAborted();
    throw remoteError(error.status, error.error ?? error);
  }
}

export function evidence() {
  return { verified: new Set(), cited: new Set(), titles: new Map() };
}
function add(info, item, cited = false) {
  const url = httpsUrl(item?.url);
  if (!url) return;
  info.verified.add(url);
  if (cited) info.cited.add(url);
  if (item.title) info.titles.set(url, item.title);
}
function count(usage, key, value) {
  if (Number.isFinite(value)) usage[key] = (usage[key] ?? 0) + value;
}
function record(usage, value = {}) {
  for (const key of [
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
  ])
    count(usage, key, value[key]);
  count(usage, 'cache_read_input_tokens', value.input_tokens_details?.cached_tokens);
  count(usage, 'web_search_requests', value.server_tool_use?.web_search_requests);
}
export async function openaiTurn(body, ctx) {
  const info = evidence();
  let completed;
  let text = '';
  const searched = new Set();
  function search(item, index) {
    const key = item.id || index;
    if (!searched.has(key)) {
      searched.add(key);
      count(ctx.usage, 'web_search_requests', 1);
      const query = item.action?.query ?? item.action?.queries?.join(', ');
      if (query) ctx.step('ค้นเว็บ: ' + query);
    }
    for (const result of item.action?.sources ?? []) add(info, result);
    if (item.action?.url) add(info, item.action);
  }
  for await (const event of stream('openai', body, ctx)) {
    if (event.type === 'response.output_text.delta') {
      text += event.delta;
      ctx.onText(event.delta);
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'web_search_call')
      search(event.item, event.output_index);
    if (event.type === 'response.output_text.annotation.added') add(info, event.annotation, true);
    if (event.type === 'response.completed') completed = event.response;
    if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done')
      throw failure('refusal');
    if (event.type === 'response.incomplete')
      throw failure(event.response?.incomplete_details?.reason === 'content_filter' ? 'refusal' : 'upstream');
    if (event.type === 'response.failed' || event.type === 'error')
      throw remoteError(0, event.response?.error ?? event);
  }
  if (completed?.incomplete_details?.reason === 'content_filter') throw failure('refusal');
  if (!completed || (completed.status && completed.status !== 'completed')) throw failure('upstream');
  let finalText = '';
  for (const [i, item] of (completed.output ?? []).entries()) {
    if (item.type === 'web_search_call') search(item, i);
    if (item.type === 'message')
      for (const part of item.content ?? []) {
        if (part.type === 'refusal') throw failure('refusal');
        if (part.type === 'output_text') finalText += part.text ?? '';
        for (const citation of part.annotations ?? []) add(info, citation, true);
      }
  }
  ctx.usage.provider = 'openai';
  record(ctx.usage, completed.usage);
  return { ...info, text: finalText || text };
}

export async function anthropicTurn(body, ctx) {
  const blocks = [];
  const inputs = new Map();
  const usage = {};
  const info = evidence();
  let stop,
    finished = false;
  for await (const event of stream('anthropic', body, ctx)) {
    if (event.type === 'error') throw remoteError(0, event);
    if (event.type === 'message_start') Object.assign(usage, event.message?.usage);
    if (event.type === 'content_block_start') blocks[event.index] = { ...event.content_block };
    const block = blocks[event.index];
    if (event.type === 'content_block_delta' && block) {
      const delta = event.delta;
      if (delta.type === 'text_delta') {
        block.text += delta.text;
        ctx.onText(delta.text);
      }
      if (delta.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + delta.thinking;
      if (delta.type === 'signature_delta') block.signature = (block.signature ?? '') + delta.signature;
      if (delta.type === 'input_json_delta')
        inputs.set(event.index, (inputs.get(event.index) ?? '') + delta.partial_json);
      if (delta.type === 'citations_delta') (block.citations ??= []).push(delta.citation);
    }
    if (event.type === 'content_block_stop' && block) {
      if (inputs.has(event.index)) block.input = JSON.parse(inputs.get(event.index));
      if (block.type === 'server_tool_use' && block.name === 'web_search' && block.input?.query)
        ctx.step('ค้นเว็บ: ' + block.input.query);
    }
    if (event.type === 'message_delta') {
      Object.assign(usage, event.usage);
      stop = event.delta?.stop_reason ?? stop;
    }
    if (event.type === 'message_stop') finished = true;
  }
  if (stop === 'refusal') throw failure('refusal');
  if (!finished || !['end_turn', 'stop_sequence', 'pause_turn'].includes(stop)) throw failure('upstream');
  ctx.usage.provider = 'anthropic';
  record(ctx.usage, usage);
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const row of block.content) if (row?.type === 'web_search_result') add(info, row);
    }
    for (const row of block.citations ?? []) add(info, row, true);
  }
  return {
    ...info,
    blocks,
    stop,
    text: blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n'),
  };
}
