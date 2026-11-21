// OpenAI Responses API provider. It implements the same planner interface as claude.mjs.
import OpenAI from 'openai';
import {
  CANDIDATES_SCHEMA,
  CANDIDATES_SYSTEM,
  DAY_SCHEMA,
  PAGES_SCHEMA,
  PAGES_SYSTEM,
  PLACE_SCHEMA,
  PLACE_SYSTEM,
  PLAN_SCHEMA,
  REPAIR_SCHEMA,
  REPLAN_SCHEMA,
  SKELETON_SCHEMA,
  SYSTEM,
  TRANSPORT_SCHEMA,
  TRANSPORT_SYSTEM,
} from './prompts.mjs';
import { AgentError, parseJson } from './claude.mjs';

// Model-tier mapping: Claude Opus -> Astra, Sonnet -> Sol, Haiku -> Luna.
export const OPENAI_MODEL = process.env.BOP_OPENAI_MODEL || 'gpt-6.2-astra';
export const OPENAI_FAST_MODELS = [...new Set([
  process.env.BOP_OPENAI_FAST_MODEL,
  'gpt-6.2-sol',
  'gpt-6-luna',
].filter(Boolean))];
const fastState = { idx: 0 };
export const openaiFastModel = () => OPENAI_FAST_MODELS[fastState.idx] || OPENAI_MODEL;

const EFFORT = {
  plan: process.env.BOP_EFFORT_PLAN || 'low',
  replan: process.env.BOP_EFFORT_REPLAN || 'medium',
  repair: process.env.BOP_EFFORT_REPAIR || 'low',
  place: process.env.BOP_EFFORT_PLACE || 'low',
};
export const OPENAI_SEARCH = {
  plan: Number(process.env.BOP_SEARCH_PLAN ?? 5),
  replan: Number(process.env.BOP_SEARCH_REPLAN ?? 3),
};

function agentError(error) {
  if (error instanceof AgentError) return error;
  if (error?.name === 'AbortError') return new AgentError('upstream', 'ยกเลิกคำขอแล้ว', 'aborted');
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 401 || status === 403) return new AgentError('auth', 'คีย์ API ของ Bop ใช้ไม่ได้ หรือไม่มีสิทธิ์ใช้โมเดลนี้', status);
  if (status === 429) return new AgentError('rate_limit', 'Bop ถูกเรียกถี่เกินไป ลองใหม่ในอีกสักครู่', status);
  if (status === 400) return new AgentError('upstream', 'Bop ส่งคำขอไม่ถูกต้อง (400)', error?.message);
  return new AgentError('upstream', `บริการ AI ของ Bop ตอบผิดพลาด${status ? ` (${status})` : ''}`, error?.message);
}

function schemaFormat(schema, tag) {
  if (!schema) return undefined;
  return {
    type: 'json_schema',
    name: `bop_${String(tag || 'response').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 55)}`,
    strict: false,
    schema,
  };
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.filter(item => item?.type === 'text' || item?.type === 'output_text')
    .map(item => item.text || '').join('');
}

function normalizeMessages(messages) {
  return (messages || []).map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: messageText(message.content),
  }));
}

function addUsage(target, response) {
  const usage = response?.usage;
  if (!target || !usage) return;
  target.input_tokens = (target.input_tokens || 0) + (usage.input_tokens || 0);
  target.output_tokens = (target.output_tokens || 0) + (usage.output_tokens || 0);
  target.cache_read_input_tokens = (target.cache_read_input_tokens || 0) + (usage.input_tokens_details?.cached_tokens || 0);
  target.cache_creation_input_tokens = (target.cache_creation_input_tokens || 0) + (usage.input_tokens_details?.cache_write_tokens || 0);
  const searches = (response.output || []).filter(item => item.type === 'web_search_call').length;
  if (searches) target.web_search_requests = (target.web_search_requests || 0) + searches;
  target.provider = 'openai';
}

function collectSources(response) {
  const results = new Map();
  const cited = new Map();
  for (const item of response?.output || []) {
    if (item.type === 'web_search_call') {
      for (const source of item.action?.sources || []) {
        if (source?.url) results.set(source.url, source.url);
      }
      if (item.action?.url) results.set(item.action.url, item.action.url);
    }
    if (item.type === 'message') {
      for (const part of item.content || []) {
        for (const annotation of part.annotations || []) {
          const url = annotation.url || annotation.url_citation?.url;
          const title = annotation.title || annotation.url_citation?.title || url;
          if (url) { results.set(url, title); cited.set(url, title); }
        }
      }
    }
  }
  return { results, cited };
}

function checkResponse(response) {
  if (!response) throw new AgentError('upstream', 'Bop ไม่ได้รับคำตอบจากบริการ AI');
  if (response.status === 'failed') throw new AgentError('upstream', 'บริการ AI ของ Bop ตอบไม่สำเร็จ', response.error?.message);
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason || 'incomplete';
    if (reason === 'max_output_tokens') throw new AgentError('upstream', 'คำตอบยาวเกินขีดจำกัด', reason);
    if (reason === 'content_filter') throw new AgentError('refusal', 'Bop ปฏิเสธคำขอนี้', reason);
    throw new AgentError('upstream', 'บริการ AI ของ Bop ตอบไม่ครบ', reason);
  }
  const refusal = (response.output || []).flatMap(item => item.content || []).find(part => part.type === 'refusal');
  if (refusal) throw new AgentError('refusal', 'Bop ปฏิเสธคำขอนี้', refusal.refusal);
}

function webTool(maxUses, loc) {
  if (!maxUses) return undefined;
  const userLocation = loc?.cc ? {
    type: 'approximate',
    country: loc.cc,
    ...(loc.name ? { city: String(loc.name).slice(0, 60) } : {}),
  } : { type: 'approximate', country: 'TH', city: 'Chiang Mai', region: 'Chiang Mai', timezone: 'Asia/Bangkok' };
  return [{ type: 'web_search', search_context_size: 'medium', user_location: userLocation }];
}

export function createOpenAI({ apiKey, log = console, fetch: fetchImpl }) {
  const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 120_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });

  async function call({ system, messages, schema, effort, maxTokens = 16000, maxUses = 0, loc, onText, onStep, signal, usage, tag, model = OPENAI_MODEL }) {
    const tools = webTool(maxUses, loc);
    let text = '';
    let completed;
    try {
      const stream = await client.responses.create({
        model,
        instructions: system,
        input: normalizeMessages(messages),
        reasoning: { effort: effort || 'low' },
        max_output_tokens: maxTokens,
        max_tool_calls: tools ? maxUses : undefined,
        tools,
        text: schema ? { format: schemaFormat(schema, tag), verbosity: 'low' } : { verbosity: 'low' },
        include: tools ? ['web_search_call.action.sources'] : undefined,
        store: false,
        stream: true,
      }, { signal });

      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          text += event.delta || '';
          onText?.(text);
        } else if (event.type === 'response.output_item.done' && event.item?.type === 'web_search_call') {
          const queries = event.item.action?.queries || (event.item.action?.query ? [event.item.action.query] : []);
          for (const query of queries) onStep?.(`ค้นเว็บ: “${String(query).slice(0, 80)}”`);
        } else if (event.type === 'response.completed') completed = event.response;
        else if (event.type === 'response.failed') throw new Error(event.response?.error?.message || 'OpenAI response failed');
      }
    } catch (error) {
      throw agentError(error);
    }
    checkResponse(completed);
    addUsage(usage, completed);
    const outputText = completed.output_text || text;
    const sources = collectSources(completed);
    log.info?.(`[bop] openai ${tag} ${model} ok`);
    return { response: completed, text: outputText, ...sources };
  }

  async function withFast(tag, run) {
    for (let index = fastState.idx; index < OPENAI_FAST_MODELS.length; index++) {
      try {
        const result = await run(OPENAI_FAST_MODELS[index]);
        fastState.idx = index;
        return result;
      } catch (error) {
        if (error instanceof AgentError && (error.code === 'auth' || error.code === 'rate_limit' || error.detail === 'aborted')) throw error;
        if (error instanceof AgentError && /400|404|model|permission/i.test(String(error.detail || error.message))) {
          log.warn?.(`[bop] ${tag}: OpenAI fast model ${OPENAI_FAST_MODELS[index]} unavailable; trying next tier`);
          fastState.idx = index + 1;
          continue;
        }
        throw error;
      }
    }
    return run(OPENAI_MODEL);
  }

  const jsonResult = (result, label) => {
    const json = parseJson(result.text);
    if (!json) throw new AgentError('upstream', `Bop ส่ง${label}กลับมาในรูปแบบที่อ่านไม่ได้`);
    return json;
  };

  return {
    async design({ setup, loc, searchCap = OPENAI_SEARCH.plan, signal, usage, onDay, onStep }) {
      const user = `ออกแบบทริปนี้ให้ครบ ${setup.days} วัน (days ต้องมี ${setup.days} รายการ ตามลำดับวัน)\n` +
        `ก่อนตอบ ค้นเว็บตรวจข้อเท็จจริงที่แผนพึ่งพามากที่สุด (ร้านอาหาร ตลาดที่เปิดเฉพาะบางวัน เวลาเปิด ราคา เมนูเจ) ${Math.min(3, searchCap)}–${searchCap} ครั้ง ห้ามเกิน ${searchCap} ครั้ง แล้วใส่ srcUrl/checked ของแต่ละจุด\n\nTripSetup:\n${JSON.stringify(setup, null, 1)}`;
      let seen = 0;
      const result = await call({ system: SYSTEM, messages: [{ role: 'user', content: user }], schema: PLAN_SCHEMA, effort: EFFORT.plan,
        maxTokens: 32000, maxUses: searchCap, loc, signal, usage, tag: 'plan', onStep,
        onText: snapshot => { const count = (snapshot.match(/"stops"\s*:/g) || []).length; if (count > seen) { seen = count; onDay?.(count); } } });
      const json = jsonResult(result, 'แผน');
      if (!Array.isArray(json.days)) throw new AgentError('upstream', 'Bop ส่งแผนกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, messages: [{ role: 'user', content: user }, { role: 'assistant', content: result.text }], tools: undefined, seenUrls: result.results };
    },

    async replan({ setup, loc, brief, command, day, signal, usage, onStep }) {
      const user = `ทริป (TripSetup):\n${JSON.stringify(setup, null, 1)}\n\nแผนปัจจุบัน (id | เวลา | ชื่อ | ประเภท | ราคา/คน | ...):\n${brief}\n\nวันที่ผู้ใช้กำลังดู: ${day + 1} (index ${day})\nคำสั่ง / เหตุการณ์:\n${command}\n\nตอบเป็น edits แบบน้อยที่สุดตามกติกา ถ้าเพิ่มสถานที่ใหม่ ค้นเว็บตรวจได้ไม่เกิน ${OPENAI_SEARCH.replan} ครั้ง`;
      const result = await call({ system: SYSTEM, messages: [{ role: 'user', content: user }], schema: REPLAN_SCHEMA, effort: EFFORT.replan,
        maxTokens: 16000, maxUses: OPENAI_SEARCH.replan, loc, signal, usage, tag: 'replan', onStep });
      const json = jsonResult(result, 'ทางเลือก');
      if (!Array.isArray(json.options) || !json.options.length) throw new AgentError('upstream', 'Bop ส่งทางเลือกกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, messages: [{ role: 'user', content: user }, { role: 'assistant', content: result.text }], tools: undefined, seenUrls: result.results };
    },

    async repair({ messages, report, signal, usage, onStep }) {
      const next = [...messages, { role: 'user', content: `เซิร์ฟเวอร์หาพิกัดจริง คำนวณเส้นทางจริง จัดเวลาใหม่ และตรวจเงื่อนไขแล้ว ผลคือ:\n\n${report}\n\nแก้ให้ผ่านด้วย edits น้อยที่สุด อ้าง id ตามแผนล่าสุดข้างบน (ถ้าเป็นแผนใหม่ทั้งทริปให้ใช้ key "A") ไม่ต้องค้นเว็บเพิ่มถ้าไม่จำเป็น` }];
      const result = await call({ system: SYSTEM, messages: next, schema: REPAIR_SCHEMA, effort: EFFORT.repair, maxTokens: 16000,
        maxUses: 0, signal, usage, tag: 'repair', onStep });
      const json = jsonResult(result, 'การซ่อม');
      if (!Array.isArray(json.fixes)) throw new AgentError('upstream', 'Bop ส่งการซ่อมกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: result.results };
    },

    async transport({ prompt, loc, signal, usage, onStep }) {
      const result = await withFast('transport', model => call({ system: TRANSPORT_SYSTEM, messages: [{ role: 'user', content: prompt }],
        schema: TRANSPORT_SCHEMA, effort: 'low', maxTokens: 16000, maxUses: 4, loc, signal, usage, tag: 'transport', onStep, model }));
      const json = jsonResult(result, 'ตัวเลือกการเดินทาง');
      if (!Array.isArray(json.options)) throw new AgentError('upstream', 'Bop ส่งตัวเลือกการเดินทางกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: result.results };
    },

    async skeleton({ prompt, searchCap = 0, loc, signal, usage, onStep }) {
      const result = await call({ system: SYSTEM, messages: [{ role: 'user', content: prompt }], schema: SKELETON_SCHEMA, effort: 'low',
        maxTokens: 16000, maxUses: searchCap, loc, signal, usage, tag: 'skeleton', onStep });
      const json = jsonResult(result, 'โครงแผน');
      if (!Array.isArray(json.days)) throw new AgentError('upstream', 'Bop ส่งโครงแผนกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: result.results };
    },

    async designDay({ prompt, searchCap = 2, loc, signal, usage, onStep, tag = 'day' }) {
      const result = await call({ system: SYSTEM, messages: [{ role: 'user', content: prompt }], schema: DAY_SCHEMA, effort: EFFORT.plan,
        maxTokens: 16000, maxUses: searchCap, loc, signal, usage, tag, onStep });
      const json = jsonResult(result, 'แผนรายวัน');
      if (!Array.isArray(json.stops)) throw new AgentError('upstream', 'Bop ส่งแผนรายวันกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: result.results };
    },

    async findPages({ name, city, loc, signal, usage }) {
      const result = await withFast('pages', model => call({ system: PAGES_SYSTEM,
        messages: [{ role: 'user', content: `สถานที่: ${name}\nเมือง: ${city}` }], schema: PAGES_SCHEMA, effort: 'low', maxTokens: 4000,
        maxUses: 1, loc, signal, usage, tag: 'pages', model }));
      const json = parseJson(result.text) || {};
      return (json.pages || []).filter(page => page?.url && result.results.has(page.url)).map(page => page.url);
    },

    async candidates({ prompt, loc, signal, usage, onStep }) {
      const result = await withFast('candidates', model => call({ system: CANDIDATES_SYSTEM, messages: [{ role: 'user', content: prompt }],
        schema: CANDIDATES_SCHEMA, effort: 'low', maxTokens: 16000, maxUses: 5, loc, signal, usage, tag: 'candidates', onStep, model }));
      const json = jsonResult(result, 'ตัวเลือก');
      if (!Array.isArray(json.questions)) throw new AgentError('upstream', 'Bop ส่งตัวเลือกกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: result.results };
    },

    async research({ city, loc, stop, signal, usage, onStep }) {
      const user = `ค้นข้อมูลสถานที่นี้ใน${city || 'เชียงใหม่'}:\nชื่อ: ${stop.n}\nประเภท: ${stop.k}\nพิกัด: ${stop.ll ? stop.ll.join(',') : '-'}\n${stop.note ? `หมายเหตุ: ${stop.note}\n` : ''}`;
      const result = await withFast('place', model => call({ system: PLACE_SYSTEM, messages: [{ role: 'user', content: user }],
        schema: PLACE_SCHEMA, effort: EFFORT.place, maxTokens: 16000, maxUses: 3, loc, signal, usage, tag: 'place', onStep, model }));
      return { json: parseJson(result.text) || {}, results: result.results, cited: result.cited };
    },

    client,
  };
}
