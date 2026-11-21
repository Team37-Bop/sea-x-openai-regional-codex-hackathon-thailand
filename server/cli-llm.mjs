// Subscription provider: runs the local Claude Code CLI headless (`claude -p`), so calls are billed to the
// owner's Claude subscription exactly as Claude Code is. We never read or reuse Claude Code's credentials;
// the CLI handles its own auth. Same interface as claude.mjs (design / replan / repair / research).
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { SYSTEM, PLAN_SCHEMA, REPLAN_SCHEMA, REPAIR_SCHEMA, PLACE_SYSTEM, PLACE_SCHEMA, TRANSPORT_SYSTEM, TRANSPORT_SCHEMA, CANDIDATES_SYSTEM, CANDIDATES_SCHEMA, SKELETON_SCHEMA, DAY_SCHEMA, PAGES_SYSTEM, PAGES_SCHEMA } from './prompts.mjs';
import { AgentError, MODEL, FAST_MODELS, fastState } from './claude.mjs';

const EFFORT = {
  plan: process.env.BOP_EFFORT_PLAN || 'low',
  replan: process.env.BOP_EFFORT_REPLAN || 'medium',
  repair: process.env.BOP_EFFORT_REPAIR || 'low',
  place: process.env.BOP_EFFORT_PLACE || 'low',
};
const TIMEOUT = { plan: 180_000, replan: 120_000, repair: 90_000, place: 90_000, transport: 90_000, candidates: 120_000, skeleton: 90_000, day: 150_000, pages: 60_000 };

/** Locate the `claude` binary: BOP_CLAUDE_BIN, ~/.local/bin/claude, then PATH. */
export function findClaudeBin(env = process.env) {
  const cands = [env.BOP_CLAUDE_BIN, path.join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
    ...String(env.PATH || '').split(path.delimiter).map(d => d && path.join(d, 'claude'))].filter(Boolean);
  return cands.find(p => existsSync(p)) || null;
}

let authCache = { at: 0, ok: false };
/** `claude auth status --json` -> loggedIn (cached 60 s). Reads only the boolean. */
export function cliLoggedIn(bin) {
  if (Date.now() - authCache.at < 60_000) return Promise.resolve(authCache.ok);
  return new Promise(resolve => {
    execFile(bin, ['auth', 'status', '--json'], { timeout: 10_000, env: childEnv() }, (err, out) => {
      let ok = false;
      try { ok = JSON.parse(out).loggedIn === true; } catch { ok = false; }
      authCache = { at: Date.now(), ok };
      resolve(ok);
    });
  });
}

// Child env: drop any API key so the CLI uses the subscription login, and keep the run quiet.
function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.CLAUDECODE;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
}

function errorFromResult(r, stderr) {
  const st = r && r.api_error_status;
  const text = (r && (r.result || (r.errors || []).join(' '))) || stderr || '';
  if (st === 401 || st === 403 || /log ?in|not logged|authenticat|credential/i.test(text))
    return new AgentError('auth', 'บัญชี AI ของ Bop ยังไม่ได้ล็อกอิน หรือหมดอายุ (ผู้ดูแลต้องล็อกอินใหม่)', text.slice(0, 200));
  if (st === 429 || /rate limit|usage limit|limit reached/i.test(text))
    return new AgentError('rate_limit', 'Bop ใช้โควตาของวันนี้หมดแล้ว ลองใหม่ภายหลัง', text.slice(0, 200));
  if (r && r.subtype === 'error_max_structured_output_retries')
    return new AgentError('upstream', 'Bop ส่งข้อมูลไม่ตรงรูปแบบ', r.subtype);
  return new AgentError('upstream', 'Bop ทำงานไม่สำเร็จ ลองใหม่อีกครั้ง', `${r ? r.subtype : 'no result'} ${text.slice(0, 200)}`);
}

/**
 * Run one headless CLI turn. Prompt on stdin, temp cwd, no user settings / MCP / session files.
 * Returns { structured, text, result, toolResults: string[] }.
 */
function runCli(bin, { system, prompt, schema, effort, tools = '', allowedTools, signal, timeoutMs, usage, onEvent, tag, log, model = MODEL }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', model, '--effort', effort, '--system-prompt', system,
    '--tools', tools, '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config',
    '--permission-mode', 'dontAsk'];
  if (allowedTools) args.push('--allowedTools', allowedTools);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  const cwd = mkdtempSync(path.join(tmpdir(), 'bop-cli-'));
  const T = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let done = false, buf = '', stderr = '', result = null, lastRate = null;
    const toolResults = [];
    const finish = (err, val) => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (child.exitCode === null) { child.kill('SIGTERM'); setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref(); }
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
      log && log.info(`[bop] cli ${tag} ${model} ${((Date.now() - T) / 1000).toFixed(1)}s ${err ? 'error ' + err.code : 'ok'}${lastRate ? ` rate=${lastRate.status}/${lastRate.type}:${lastRate.utilization}` : ''}`);
      err ? reject(err) : resolve(val);
    };
    const onAbort = () => finish(new AgentError('upstream', 'ยกเลิกคำขอแล้ว', 'aborted'));
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) return onAbort();
    const timer = setTimeout(() => finish(new AgentError('upstream', `Bop ใช้เวลานานเกิน ${Math.round(timeoutMs / 1000)} วินาที`, 'timeout')), timeoutMs);

    const handle = ev => {
      if (ev.type === 'result') { result = ev; return; }
      if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
        const ri = ev.rate_limit_info; lastRate = { status: ri.status, type: ri.rateLimitType, utilization: ri.unifiedWindows && ri.unifiedWindows[ri.rateLimitType] && ri.unifiedWindows[ri.rateLimitType].utilization };
        if (ri.status !== 'allowed') log && log.warn(`[bop] cli ${tag} rate limit: ${JSON.stringify(lastRate)}`);
      }
      if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content))
        for (const b of ev.message.content) if (b.type === 'tool_result') toolResults.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
      onEvent && onEvent(ev);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try { handle(JSON.parse(line)); } catch { /* non-JSON noise */ }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    child.on('error', e => finish(new AgentError('upstream', 'Bop เริ่มทำงานไม่ได้', e.message)));
    child.on('close', code => {
      if (buf.trim()) { try { handle(JSON.parse(buf)); } catch { /* ignore */ } }
      if (!result) return finish(errorFromResult(null, stderr || `exit ${code}`));
      addUsage(usage, result);
      if (result.is_error || result.subtype !== 'success') return finish(errorFromResult(result, stderr));
      finish(null, { structured: result.structured_output ?? null, text: result.result || '', result, toolResults });
    });
    child.stdin.on('error', () => { /* child exited early; close handler reports */ });
    child.stdin.end(prompt);
  });
}

function addUsage(acc, r) {
  if (!acc || !r || !r.usage) return;
  const u = r.usage;
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) acc[k] = (acc[k] || 0) + (u[k] || 0);
  if (u.server_tool_use && u.server_tool_use.web_search_requests) acc.web_search_requests = (acc.web_search_requests || 0) + u.server_tool_use.web_search_requests;
  acc.provider = 'subscription';
}

/** Count `"stops"` keys in the streamed StructuredOutput input to report day progress. */
function dayCounter(onDay) {
  let json = '', seen = 0;
  return ev => {
    if (ev.type !== 'stream_event' || !ev.event) return;
    const d = ev.event.delta;
    if (d && d.type === 'input_json_delta') {
      json += d.partial_json || '';
      const n = (json.match(/"stops"\s*:/g) || []).length;
      if (n > seen) { seen = n; onDay && onDay(n); }
    }
  };
}

const SEARCH = { plan: Number(process.env.BOP_SEARCH_PLAN ?? 5), replan: Number(process.env.BOP_SEARCH_REPLAN ?? 3) };
const searchSteps = onStep => ev => {
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content))
    for (const b of ev.message.content) if (b.type === 'tool_use' && b.name === 'WebSearch' && b.input && b.input.query) onStep && onStep(`ค้นเว็บ: “${String(b.input.query).slice(0, 80)}”`);
};
/** URLs (with titles when present) that WebSearch actually returned. */
function urlsFrom(toolResults) {
  const results = new Map();
  for (const t of toolResults) {
    for (const m of t.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"(https?:[^"]+)"/g)) results.set(m[2], m[1]);
    for (const m of t.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) if (!results.has(m[0])) results.set(m[0], m[0]);
  }
  return results;
}
const both = (...fs) => ev => fs.forEach(f => f && f(ev));
const searchOpts = n => (n > 0 ? { tools: 'WebSearch', allowedTools: 'WebSearch' } : {});

const asConversation = messages => messages.map(m => (m.role === 'user' ? `<<ผู้ใช้>>\n${m.content}` : `<<คำตอบก่อนหน้าของคุณ (JSON)>>\n${m.content}`)).join('\n\n');

export function createCliLlm({ bin, log = console }) {
  const run = opts => runCli(bin, { log, ...opts });
  // Fast model first (place info, transport, photo pages); an unusable model is skipped for the rest of the process.
  const runFast = async opts => {
    for (let i = fastState.idx; i < FAST_MODELS.length; i++) {
      try { const r = await run({ ...opts, model: FAST_MODELS[i], effort: 'low' }); fastState.idx = i; return r; }
      catch (e) {
        if (signal(opts) || (e instanceof AgentError && (e.code === 'auth' || e.code === 'rate_limit' || e.detail === 'aborted'))) throw e;
        log.warn(`[bop] ${opts.tag}: fast model ${FAST_MODELS[i]} failed (${e.message}), trying the next one`); fastState.idx = i + 1;
      }
    }
    return run(opts);
  };
  const signal = o => o.signal && o.signal.aborted;
  const need = (r, what) => {
    const j = r.structured ?? (() => { try { return JSON.parse(r.text); } catch { return null; } })();
    if (!j) throw new AgentError('upstream', `Bop ส่ง${what}กลับมาในรูปแบบที่อ่านไม่ได้`);
    return j;
  };

  return {
    async design({ setup, loc, searchCap = SEARCH.plan, signal, usage, onDay, onStep }) {
      const user = `ออกแบบทริปนี้ให้ครบ ${setup.days} วัน (days ต้องมี ${setup.days} รายการ ตามลำดับวัน)\n` +
        (searchCap > 0 ? `ก่อนตอบ ใช้ WebSearch ตรวจข้อเท็จจริงที่แผนพึ่งพามากที่สุด (ร้านอาหาร ตลาดที่เปิดเฉพาะบางวัน เวลาเปิด ราคา เมนูเจ การเดินทางด้วยรถไฟ/รถไฟฟ้า) ${Math.min(3, searchCap)}–${searchCap} ครั้ง ห้ามเกิน ${searchCap} ครั้ง${loc && loc.cc && loc.cc !== 'TH' ? ` ค้นด้วยภาษาท้องถิ่นของ ${loc.name} ได้` : ''} แล้วตอบด้วย structured output พร้อม srcUrl/checked ของแต่ละจุด\n` : '') +
        `\nTripSetup:\n${JSON.stringify(setup, null, 1)}`;
      const r = await run({ system: SYSTEM, prompt: user, schema: PLAN_SCHEMA, effort: EFFORT.plan, signal, usage, timeoutMs: TIMEOUT.plan, tag: 'plan',
        ...searchOpts(searchCap), onEvent: both(dayCounter(onDay), searchSteps(onStep)) });
      const json = need(r, 'แผน');
      if (!Array.isArray(json.days)) throw new AgentError('upstream', 'Bop ส่งแผนกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, messages: [{ role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(json) }], seenUrls: urlsFrom(r.toolResults) };
    },
    async replan({ setup, brief, command, day, signal, usage, onStep }) {
      const user = `ทริป (TripSetup):\n${JSON.stringify(setup, null, 1)}\n\nแผนปัจจุบัน (id | เวลา | ชื่อ | ประเภท | ราคา/คน | ...):\n${brief}\n\n` +
        `วันที่ผู้ใช้กำลังดู: ${day + 1} (index ${day})\nคำสั่ง / เหตุการณ์:\n${command}\n\nตอบเป็น edits แบบน้อยที่สุดตามกติกา` +
        (SEARCH.replan > 0 ? `\nถ้าเพิ่มสถานที่ใหม่ ใช้ WebSearch ตรวจได้ไม่เกิน ${SEARCH.replan} ครั้ง (ห้ามเกิน) แล้วตอบด้วย structured output` : '');
      const r = await run({ system: SYSTEM, prompt: user, schema: REPLAN_SCHEMA, effort: EFFORT.replan, signal, usage, timeoutMs: TIMEOUT.replan, tag: 'replan',
        ...searchOpts(SEARCH.replan), onEvent: searchSteps(onStep) });
      const json = need(r, 'ทางเลือก');
      if (!Array.isArray(json.options) || !json.options.length) throw new AgentError('upstream', 'Bop ไม่ได้เสนอทางเลือก');
      return { json, messages: [{ role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(json) }], seenUrls: urlsFrom(r.toolResults) };
    },
    // No session persistence, so the earlier turn is replayed as text in one prompt.
    async repair({ messages, report, signal, usage }) {
      const prompt = `${asConversation(messages)}\n\n<<ผู้ใช้>>\nเซิร์ฟเวอร์หาพิกัดจริง คำนวณเส้นทางจริง จัดเวลาใหม่ และตรวจเงื่อนไขแล้ว ผลคือ:\n\n${report}\n\n` +
        'แก้ให้ผ่านด้วย edits น้อยที่สุด อ้าง id ตามแผนล่าสุดข้างบน (ถ้าเป็นแผนใหม่ทั้งทริปให้ใช้ key "A")';
      const r = await run({ system: SYSTEM, prompt, schema: REPAIR_SCHEMA, effort: EFFORT.repair, signal, usage, timeoutMs: TIMEOUT.repair, tag: 'repair' });
      const json = need(r, 'การซ่อม');
      if (!Array.isArray(json.fixes)) throw new AgentError('upstream', 'Bop ส่งการซ่อมกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json };
    },
    async transport({ prompt, signal, usage, onStep }) {
      const r = await runFast({ system: TRANSPORT_SYSTEM, prompt: prompt + '\nใช้ WebSearch ไม่เกิน 4 ครั้ง แล้วตอบด้วย structured output', schema: TRANSPORT_SCHEMA,
        effort: EFFORT.place, tools: 'WebSearch', allowedTools: 'WebSearch', signal, usage, timeoutMs: TIMEOUT.transport, tag: 'transport', onEvent: searchSteps(onStep) });
      const json = need(r, 'ตัวเลือกการเดินทาง');
      if (!Array.isArray(json.options)) throw new AgentError('upstream', 'Bop ส่งตัวเลือกการเดินทางกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: urlsFrom(r.toolResults) };
    },
    async skeleton({ prompt, searchCap = 0, signal, usage, onStep }) {
      const r = await run({ system: SYSTEM, prompt: prompt + (searchCap > 0 ? `\nใช้ WebSearch ได้ไม่เกิน ${searchCap} ครั้ง (หาโรงแรมตัวอย่าง) แล้วตอบด้วย structured output` : ''),
        schema: SKELETON_SCHEMA, effort: 'low', ...searchOpts(searchCap), signal, usage, timeoutMs: TIMEOUT.skeleton, tag: 'skeleton', onEvent: searchSteps(onStep) });
      const json = need(r, 'โครงแผน');
      if (!Array.isArray(json.days)) throw new AgentError('upstream', 'Bop ส่งโครงแผนกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: urlsFrom(r.toolResults) };
    },
    async designDay({ prompt, searchCap = 2, signal, usage, onStep, tag = 'day' }) {
      const r = await run({ system: SYSTEM, prompt: prompt + (searchCap > 0 ? `\nใช้ WebSearch ได้ไม่เกิน ${searchCap} ครั้ง (ห้ามเกิน) แล้วตอบด้วย structured output` : ''),
        schema: DAY_SCHEMA, effort: EFFORT.plan, ...searchOpts(searchCap), signal, usage, timeoutMs: TIMEOUT.day, tag, onEvent: searchSteps(onStep) });
      const json = need(r, 'แผนรายวัน');
      if (!Array.isArray(json.stops)) throw new AgentError('upstream', 'Bop ส่งแผนรายวันกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: urlsFrom(r.toolResults) };
    },
    async findPages({ name, city, signal, usage }) {
      const r = await runFast({ system: PAGES_SYSTEM, prompt: `สถานที่: ${name}\nเมือง: ${city}\nใช้ WebSearch 1 ครั้ง แล้วตอบด้วย structured output`, schema: PAGES_SCHEMA,
        effort: 'low', tools: 'WebSearch', allowedTools: 'WebSearch', signal, usage, timeoutMs: TIMEOUT.pages, tag: 'pages' });
      const json = need(r, 'ลิงก์');
      const seen = urlsFrom(r.toolResults);
      return (json.pages || []).filter(p => p && seen.has(p.url)).map(p => p.url);
    },
    async candidates({ prompt, signal, usage, onStep }) {
      const r = await runFast({ system: CANDIDATES_SYSTEM, prompt: prompt + '\nใช้ WebSearch ไม่เกิน 5 ครั้ง แล้วตอบด้วย structured output', schema: CANDIDATES_SCHEMA,
        effort: EFFORT.place, tools: 'WebSearch', allowedTools: 'WebSearch', signal, usage, timeoutMs: TIMEOUT.candidates, tag: 'candidates', onEvent: searchSteps(onStep) });
      const json = need(r, 'ตัวเลือก');
      if (!Array.isArray(json.questions)) throw new AgentError('upstream', 'Bop ส่งตัวเลือกกลับมาในรูปแบบที่อ่านไม่ได้');
      return { json, seenUrls: urlsFrom(r.toolResults) };
    },
    async research({ city, loc, stop, signal, usage, onStep }) {
      const user = `ค้นข้อมูลสถานที่นี้ใน${city || 'เชียงใหม่'}${loc && loc.cc ? ` (${loc.name}, ${loc.cc})` : ''}:\nชื่อ: ${stop.n}\nประเภท: ${stop.k}\nพิกัด: ${stop.ll ? stop.ll.join(',') : '-'}\n${stop.note ? 'หมายเหตุ: ' + stop.note + '\n' : ''}` +
        'ใช้ WebSearch ไม่เกิน 3 ครั้ง แล้วตอบด้วย structured output';
      const onEvent = searchSteps(onStep);
      const r = await runFast({ system: PLACE_SYSTEM, prompt: user, schema: PLACE_SCHEMA, effort: EFFORT.place, tools: 'WebSearch', allowedTools: 'WebSearch',
        signal, usage, timeoutMs: TIMEOUT.place, tag: 'place', onEvent });
      const results = urlsFrom(r.toolResults); // only pages WebSearch actually returned count as sources
      const json = r.structured ?? (() => { try { return JSON.parse(r.text); } catch { return {}; } })();
      return { json, results, cited: new Map() };
    },
  };
}
