// Claude layer: every model call goes through here. Model claude-opus-5-5, thinking always on (adaptive),
// depth via output_config.effort, JSON via structured outputs, refusal fallbacks via the beta namespace.
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, PLAN_SCHEMA, REPLAN_SCHEMA, REPAIR_SCHEMA, PLACE_SYSTEM, PLACE_SCHEMA, TRANSPORT_SYSTEM, TRANSPORT_SCHEMA, CANDIDATES_SYSTEM, CANDIDATES_SCHEMA, SKELETON_SCHEMA, DAY_SCHEMA, PAGES_SYSTEM, PAGES_SCHEMA } from './prompts.mjs';

export const MODEL = 'claude-opus-5-5';
// Fast model for place info, transport options, photo-page lookups and other small extraction steps (speed over depth).
// Tried in order; a model the account/CLI rejects is skipped for the rest of the process. Opus is the last resort.
// Measured on place-info (same restaurant, subscription CLI): Sonnet 5.5 22.2 s, Haiku 5.5 25.3 s, Opus 5.5 30.4 s; Sonnet's prices were the most sensible.
export const FAST_MODELS = [...new Set([process.env.BOP_FAST_MODEL, 'claude-sonnet-5-5', 'claude-haiku-5-5'].filter(Boolean))];
export const fastState = { idx: 0 };
export const fastModel = () => FAST_MODELS[fastState.idx] || MODEL;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const EFFORT = {
  plan: process.env.BOP_EFFORT_PLAN || 'low',
  replan: process.env.BOP_EFFORT_REPLAN || 'medium',
  repair: process.env.BOP_EFFORT_REPAIR || 'low',
  place: process.env.BOP_EFFORT_PLACE || 'low',
};
// Web searches allowed per call (0 disables search for that call).
export const SEARCH = {
  plan: Number(process.env.BOP_SEARCH_PLAN ?? 5),
  replan: Number(process.env.BOP_SEARCH_REPLAN ?? 3),
};

/** Error carrying an API.md error code and a Thai message. */
export class AgentError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
}

export function toAgentError(e) {
  if (e instanceof AgentError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new AgentError('auth', 'คีย์ API ของ Bop ใช้ไม่ได้ หรือไม่มีสิทธิ์ใช้โมเดลนี้', e.status);
  if (e instanceof Anthropic.RateLimitError)
    return new AgentError('rate_limit', 'Bop ถูกเรียกถี่เกินไป ลองใหม่ในอีกสักครู่', e.status);
  if (e instanceof Anthropic.APIUserAbortError)
    return new AgentError('upstream', 'ยกเลิกคำขอแล้ว', 'aborted');
  if (e instanceof Anthropic.BadRequestError)
    return new AgentError('upstream', 'Bop ส่งคำขอไม่ถูกต้อง (400)', e.message);
  if (e instanceof Anthropic.APIConnectionError)
    return new AgentError('upstream', 'Bop เชื่อมต่อบริการ AI ไม่ได้', e.message);
  if (e instanceof Anthropic.APIError)
    return new AgentError('upstream', `บริการ AI ของ Bop ตอบผิดพลาด (${e.status ?? '?'})`, e.message);
  return new AgentError('upstream', 'เกิดข้อผิดพลาดในเอเจนต์', e && e.message);
}

/** Text of the final answer: text blocks after the last `fallback` switch point (if any). */
function finalText(msg) {
  let start = 0;
  msg.content.forEach((b, i) => { if (b.type === 'fallback') start = i + 1; });
  return msg.content.slice(start).filter(b => b.type === 'text').map(b => b.text).join('');
}

function checkStop(msg) {
  switch (msg.stop_reason) {
    case 'refusal':
      throw new AgentError('refusal', 'Bop ปฏิเสธคำขอนี้', msg.stop_details && msg.stop_details.category);
    case 'max_tokens':
      throw new AgentError('upstream', 'คำตอบยาวเกินขีดจำกัด', 'max_tokens');
    case 'model_context_window_exceeded':
      throw new AgentError('upstream', 'ข้อมูลทริปยาวเกินกว่าที่ Bop รับได้', 'context');
    default: return;
  }
}

/** Lenient JSON parse: whole text, else the outermost {...}. */
export function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

function addUsage(acc, u) {
  if (!u) return acc;
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'])
    acc[k] = (acc[k] || 0) + (u[k] || 0);
  const st = u.server_tool_use;
  if (st && st.web_search_requests) acc.web_search_requests = (acc.web_search_requests || 0) + st.web_search_requests;
  return acc;
}

const sysBlocks = text => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];

export function createClaude({ apiKey, log = console, fetch: fetchImpl }) {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  let fallbacksOk = true; // flips off if the account/endpoint rejects the fallbacks beta

  /**
   * One streamed request. Returns the final BetaMessage. `onEvent(snapshotText)` sees the text so far.
   * Opts into server-side refusal fallbacks; on a 400 retries once without them (logged).
   */
  async function call({ system, messages, schema, effort, maxTokens = 16000, tools, onText, onBlock, signal, usage, tag, model = MODEL }) {
    const body = {
      model, max_tokens: maxTokens,
      system: sysBlocks(system), messages,
      thinking: { type: 'adaptive' },
      output_config: schema ? { effort, format: { type: 'json_schema', schema } } : { effort },
      ...(tools ? { tools } : {}),
    };
    const run = async (withFallbacks) => {
      const params = withFallbacks ? { ...body, betas: [FALLBACK_BETA], fallbacks: 'default' } : body;
      const stream = client.beta.messages.stream(params, { signal });
      if (onText) stream.on('text', (_d, snap) => onText(snap));
      if (onBlock) stream.on('contentBlock', onBlock);
      return stream;
    };
    try {
      const msg = await (await run(fallbacksOk)).finalMessage();
      addUsage(usage, msg.usage);
      return msg;
    } catch (e) {
      if (fallbacksOk && e instanceof Anthropic.BadRequestError) {
        log.warn(`[bop] ${tag}: 400 with fallbacks ("${String(e.message).slice(0, 160)}"), retrying without fallbacks`);
        const msg = await (await run(false)).finalMessage();
        fallbacksOk = false; // the retry worked, so the 400 came from the fallbacks opt-in itself
        addUsage(usage, msg.usage);
        return msg;
      }
      throw e;
    }
  }

  // user_location follows the destination (geocoded city), so results are local.
  const searchTool = (maxUses, loc) => ({ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses,
    user_location: loc && loc.cc ? { type: 'approximate', country: loc.cc, ...(loc.name ? { city: String(loc.name).slice(0, 60) } : {}) }
      : { type: 'approximate', city: 'Chiang Mai', region: 'Chiang Mai', country: 'TH', timezone: 'Asia/Bangkok' } });

  /** Stream search activity as Thai steps and remember every URL the search returned. */
  const searchWatcher = (onStep, seenUrls) => b => {
    if (b.type === 'server_tool_use' && b.name === 'web_search' && b.input && b.input.query) onStep && onStep(`ค้นเว็บ: “${String(b.input.query).slice(0, 80)}”`);
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
      for (const r of b.content) if (r.type === 'web_search_result' && r.url) seenUrls.set(r.url, r.title || r.url);
  };

  /**
   * A JSON-producing turn that may use web search: handles pause_turn (re-sends the paused turn unchanged)
   * and, if the search tool + structured output combination is rejected (400), retries once without search.
   * Returns { msg, messages (with every assistant turn appended unchanged), tools }.
   */
  async function searchingCall({ system = SYSTEM, messages, schema, effort, maxTokens, maxUses, loc, signal, usage, tag, onText, onStep, seenUrls, model = MODEL }) {
    let tools = maxUses ? [searchTool(maxUses, loc)] : undefined;
    const onBlock = searchWatcher(onStep, seenUrls);
    let convo = [...messages];
    for (let turn = 0; turn < 4; turn++) {
      let msg;
      try {
        msg = await call({ system, messages: convo, schema, effort, maxTokens, tools, onText, onBlock, signal, usage, tag, model });
      } catch (e) {
        if (tools && e instanceof Anthropic.BadRequestError) {
          log.warn(`[bop] ${tag}: 400 with web_search + structured output ("${String(e.message).slice(0, 160)}"), retrying without search`);
          onStep && onStep('ค้นเว็บไม่ได้ ใช้ความรู้ของโมเดลแทน');
          tools = undefined; turn--; convo = [...messages]; continue;
        }
        throw e;
      }
      convo.push({ role: 'assistant', content: msg.content }); // unchanged, incl. thinking + search blocks
      if (msg.stop_reason === 'pause_turn') continue;
      return { msg, messages: convo, tools };
    }
    throw new AgentError('upstream', 'Bop ค้นเว็บนานเกินไป', 'pause_turn x4');
  }

  /** Design a full itinerary (with up to 5 web searches). onDay(n) fires when the model starts writing day n. */
  async function design({ setup, loc, searchCap = SEARCH.plan, signal, usage, onDay, onStep }) {
    const user = `ออกแบบทริปนี้ให้ครบ ${setup.days} วัน (days ต้องมี ${setup.days} รายการ ตามลำดับวัน)\n` +
      `ก่อนตอบ ค้นเว็บตรวจข้อเท็จจริงที่แผนพึ่งพามากที่สุด (ร้านอาหาร ตลาดที่เปิดเฉพาะบางวัน เวลาเปิด ราคา เมนูเจ) ${Math.min(3, searchCap)}–${searchCap} ครั้ง ห้ามเกิน ${searchCap} ครั้ง แล้วใส่ srcUrl/checked ของแต่ละจุด\n\nTripSetup:\n${JSON.stringify(setup, null, 1)}`;
    let seen = 0;
    const seenUrls = new Map();
    const r = await searchingCall({ messages: [{ role: 'user', content: user }], schema: PLAN_SCHEMA, effort: EFFORT.plan, maxTokens: 32000,
      maxUses: searchCap, loc, signal, usage, tag: 'plan', onStep, seenUrls,
      onText: snap => { const n = (snap.match(/"stops"\s*:/g) || []).length; if (n > seen) { seen = n; onDay && onDay(n); } } });
    checkStop(r.msg);
    const json = parseJson(finalText(r.msg));
    if (!json || !Array.isArray(json.days)) throw new AgentError('upstream', 'Bop ส่งแผนกลับมาในรูปแบบที่อ่านไม่ได้');
    return { json, messages: r.messages, tools: r.tools, seenUrls };
  }

  /** Propose minimal edits (with options) for a natural-language change; may search for new places. */
  async function replan({ setup, loc, brief, command, day, signal, usage, onStep }) {
    const user = `ทริป (TripSetup):\n${JSON.stringify(setup, null, 1)}\n\nแผนปัจจุบัน (id | เวลา | ชื่อ | ประเภท | ราคา/คน | ...):\n${brief}\n\n` +
      `วันที่ผู้ใช้กำลังดู: ${day + 1} (index ${day})\nคำสั่ง / เหตุการณ์:\n${command}\n\n` +
      `ตอบเป็น edits แบบน้อยที่สุดตามกติกา ถ้าเพิ่มสถานที่ใหม่ ค้นเว็บตรวจได้ไม่เกิน ${SEARCH.replan} ครั้ง`;
    const seenUrls = new Map();
    const r = await searchingCall({ messages: [{ role: 'user', content: user }], schema: REPLAN_SCHEMA, effort: EFFORT.replan, maxTokens: 16000,
      maxUses: SEARCH.replan, loc, signal, usage, tag: 'replan', onStep, seenUrls });
    checkStop(r.msg);
    const json = parseJson(finalText(r.msg));
    if (!json || !Array.isArray(json.options) || !json.options.length) throw new AgentError('upstream', 'Bop ส่งทางเลือกกลับมาในรูปแบบที่อ่านไม่ได้');
    return { json, messages: r.messages, tools: r.tools, seenUrls };
  }

  /** One repair round in the same conversation (same tools array, so replayed thinking blocks stay valid). */
  async function repair({ messages, tools, report, signal, usage, onStep, seenUrls = new Map() }) {
    const next = [...messages, { role: 'user', content:
      `เซิร์ฟเวอร์หาพิกัดจริง คำนวณเส้นทางจริง จัดเวลาใหม่ และตรวจเงื่อนไขแล้ว ผลคือ:\n\n${report}\n\n` +
      'แก้ให้ผ่านด้วย edits น้อยที่สุด อ้าง id ตามแผนล่าสุดข้างบน (ถ้าเป็นแผนใหม่ทั้งทริปให้ใช้ key "A") ไม่ต้องค้นเว็บเพิ่มถ้าไม่จำเป็น' }];
    const msg = await call({ system: SYSTEM, messages: next, schema: REPAIR_SCHEMA, effort: EFFORT.repair, maxTokens: 16000, tools,
      onBlock: searchWatcher(onStep, seenUrls), signal, usage, tag: 'repair' });
    checkStop(msg);
    const json = parseJson(finalText(msg));
    if (!json || !Array.isArray(json.fixes)) throw new AgentError('upstream', 'Bop ส่งการซ่อมกลับมาในรูปแบบที่อ่านไม่ได้');
    return { json, seenUrls };
  }

  /** Run fn(model) on the fast model; a model that is unavailable (404/400/403) is skipped for good, then Opus. */
  async function withFast(tag, fn) {
    for (let i = fastState.idx; i < FAST_MODELS.length; i++) {
      try { const out = await fn(FAST_MODELS[i]); fastState.idx = i; return out; }
      catch (e) {
        if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError || e instanceof Anthropic.PermissionDeniedError) {
          log.warn(`[bop] ${tag}: fast model ${FAST_MODELS[i]} unavailable (${e.status}), trying the next one`); fastState.idx = i + 1; continue;
        }
        throw e;
      }
    }
    return fn(MODEL);
  }

  /** Intercity transport options for one direction (web search only, fast model). */
  async function transport({ prompt, loc, signal, usage, onStep }) {
    const seenUrls = new Map();
    const r = await withFast('transport', model => searchingCall({ system: TRANSPORT_SYSTEM, messages: [{ role: 'user', content: prompt }], schema: TRANSPORT_SCHEMA,
      effort: 'low', maxTokens: 16000, maxUses: 4, loc, signal, usage, tag: 'transport', onStep, seenUrls, model }));
    checkStop(r.msg);
    const json = parseJson(finalText(r.msg));
    if (!json || !Array.isArray(json.options)) throw new AgentError('upstream', 'Bop ส่งตัวเลือกการเดินทางกลับมาในรูปแบบที่อ่านไม่ได้');
    return { json, seenUrls };
  }

  /** Long trips: a small skeleton first (no search, low effort). */
  async function skeleton({ prompt, searchCap = 0, loc, signal, usage, onStep }) {
    const seenUrls = new Map();
    const r = await searchingCall({ messages: [{ role: 'user', content: prompt }], schema: SKELETON_SCHEMA, effort: 'low', maxTokens: 16000,
      maxUses: searchCap, loc, signal, usage, tag: 'skeleton', onStep, seenUrls });
    checkStop(r.msg);
    const json = parseJson(finalText(r.msg));
    if (!json || !Array.isArray(json.days)) throw new AgentError('upstream', 'Bop ส่งโครงแผนกลับมาในรูปแบบที่อ่านไม่ได้');
    return { json, seenUrls };
  }
  /** One day of a long trip, with up to `searchCap` web searches. */
  async function designDay({ prompt, searchCap = 2, loc, signal, usage, onStep, tag = 'day' }) {
    const seenUrls = new Map();
    const r = await searchingCall({ messages: [{ role: 'user', content: prompt }], schema: DAY_SCHEMA, effort: EFFORT.plan, maxTokens: 16000,
      maxUses: searchCap, loc, signal, usage, tag, onStep, seenUrls });
    checkStop(r.msg);
    const json = parseJson(finalText(r.msg));
    if (!json || !Array.isArray(json.stops)) throw new AgentError('upstream', 'Bop ส่งแผนรายวันกลับมาในรูปแบบที่อ่านไม่ได้');
    return { json, seenUrls };
  }

  /** One cheap search for pages about a single place (used to find a photo). Returns URLs seen in search results. */
  async function findPages({ name, city, loc, signal, usage }) {
    const seenUrls = new Map();
    const r = await withFast('pages', model => searchingCall({ system: PAGES_SYSTEM, messages: [{ role: 'user', content: `สถานที่: ${name}\nเมือง: ${city}` }], schema: PAGES_SCHEMA,
      effort: 'low', maxTokens: 4000, maxUses: 1, loc, signal, usage, tag: 'pages', seenUrls, model }));
    checkStop(r.msg);
    const json = parseJson(finalText(r.msg)) || {};
    return (json.pages || []).filter(p => p && seenUrls.has(p.url)).map(p => p.url);
  }

  /** Pre-plan candidates (ask-before-acting mode), up to 5 searches. */
  async function candidates({ prompt, loc, signal, usage, onStep }) {
    const seenUrls = new Map();
    const r = await withFast('candidates', model => searchingCall({ system: CANDIDATES_SYSTEM, messages: [{ role: 'user', content: prompt }], schema: CANDIDATES_SCHEMA,
      effort: 'low', maxTokens: 16000, maxUses: 5, loc, signal, usage, tag: 'candidates', onStep, seenUrls, model }));
    checkStop(r.msg);
    const json = parseJson(finalText(r.msg));
    if (!json || !Array.isArray(json.questions)) throw new AgentError('upstream', 'Bop ส่งตัวเลือกกลับมาในรูปแบบที่อ่านไม่ได้');
    return { json, seenUrls };
  }

  /** Web research for one stop. onStep(text) streams search activity. */
  async function research({ city, loc, stop, signal, usage, onStep }) {
    const tools = [searchTool(3, loc)];
    const user = `ค้นข้อมูลสถานที่นี้ใน${city || 'เชียงใหม่'}:\nชื่อ: ${stop.n}\nประเภท: ${stop.k}\nพิกัด: ${stop.ll ? stop.ll.join(',') : '-'}\n${stop.note ? 'หมายเหตุ: ' + stop.note + '\n' : ''}`;
    let messages = [{ role: 'user', content: user }];
    const all = [];
    let msg;
    for (let turn = 0; turn < 4; turn++) {
      msg = await withFast('place', model => callResearch({ messages, tools, signal, usage, onStep, model }));
      all.push(...msg.content);
      if (msg.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: msg.content }]; continue; }
      break;
    }
    checkStop(msg);
    // sources: cited pages first, then other search results
    const results = new Map(), cited = new Map();
    for (const b of all) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
        for (const r of b.content) if (r.type === 'web_search_result') results.set(r.url, r.title || r.url);
      if (b.type === 'text' && Array.isArray(b.citations))
        for (const c of b.citations) if (c.url) cited.set(c.url, c.title || results.get(c.url) || c.url);
    }
    let json = parseJson(finalText(msg));
    if (!json) {
      // The final message was not JSON: convert it with structured outputs (no tools, cheap).
      const text = all.filter(b => b.type === 'text').map(b => b.text).join('\n').slice(0, 12000);
      const m2 = await call({ system: PLACE_SYSTEM, schema: PLACE_SCHEMA, effort: 'low', maxTokens: 8000, signal, usage, tag: 'place-format', model: fastModel(),
        messages: [{ role: 'user', content: `${user}\nผลการค้นที่ได้ (แปลงเป็น JSON ตาม schema):\n${text}` }] });
      checkStop(m2);
      json = parseJson(finalText(m2));
    }
    return { json: json || {}, results, cited };
  }

  async function callResearch({ messages, tools, signal, usage, onStep, model = MODEL }) {
    const onBlock = b => {
      if (b.type === 'server_tool_use' && b.name === 'web_search' && b.input && b.input.query) onStep && onStep(`ค้นเว็บ: “${String(b.input.query).slice(0, 80)}”`);
      if (b.type === 'web_search_tool_result') {
        const n = Array.isArray(b.content) ? b.content.length : 0;
        onStep && onStep(n ? `อ่านผลค้น ${n} หน้า` : 'ค้นไม่พบผลลัพธ์');
      }
    };
    const body = { model, max_tokens: 16000, system: sysBlocks(PLACE_SYSTEM), messages, tools,
      thinking: { type: 'adaptive' }, output_config: { effort: 'low' } };
    const go = async (withFallbacks) => {
      const s = client.beta.messages.stream(withFallbacks ? { ...body, betas: [FALLBACK_BETA], fallbacks: 'default' } : body, { signal });
      s.on('contentBlock', onBlock);
      const m = await s.finalMessage(); addUsage(usage, m.usage); return m;
    };
    if (!fallbacksOk) return go(false);
    try { return await go(true); }
    catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        log.warn(`[bop] place-info: 400 with fallbacks + web_search ("${String(e.message).slice(0, 160)}"), retrying without fallbacks`);
        return go(false);
      }
      throw e;
    }
  }

  return { design, replan, repair, research, transport, candidates, skeleton, designDay, findPages, client };
}
