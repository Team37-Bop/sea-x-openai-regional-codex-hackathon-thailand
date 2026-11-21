// /api/* handler shared by the Vite dev middleware (vite.config.js) and the production server (server/index.mjs).
// Connect-style: (req, res, next). Agent endpoints stream NDJSON: `step` events, then exactly one `done` or `error`.
import { createClaude, toAgentError, AgentError, MODEL, fastModel } from './claude.mjs';
import { createOpenAI, OPENAI_MODEL, openaiFastModel } from './openai.mjs';
import { runPlan, runReplan, runPlaceInfo, runTransport, runCandidates } from './agent.mjs';
import { createCliLlm, findClaudeBin, cliLoggedIn } from './cli-llm.mjs';
import { cityInfo } from './geo.mjs';
import { runWeatherCheck } from './weather.mjs';
import { runFlightOffer, runFlightOrder, runFlightCancel, duffelEnabled, duffelMode, bookingEnabled } from './duffel.mjs';
import {
  closeLineVote,
  createLineTrip,
  handleLineWebhook,
  lineConfig,
  lineIdentity,
  lineLiffBallot,
  postLineText,
  readLineTrip,
  readLineVote,
  removeLineTrip,
  startLineVote,
  updateLinePlan,
} from './line.mjs';

const MAX_BODY = 2 * 1024 * 1024;

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  return res.end(JSON.stringify(body));
}

function lineStatus(error) {
  if (error?.code === 'auth') return 401;
  if (error?.code === 'bad_request') return 400;
  if (error?.code === 'rate_limit') return 429;
  if (error?.code === 'no_key') return 503;
  return 502;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new AgentError('bad_request', 'ข้อมูลใหญ่เกินไป')); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readRaw(req);
  try {
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('object required');
    return body;
  } catch {
    throw new AgentError('bad_request', 'JSON ต้องเป็น object ที่ถูกต้อง');
  }
}

/**
 * Provider order: forced BOP_PROVIDER, then OpenAI service key, Anthropic key,
 * then the local Claude Code subscription for development.
 * @param {{ apiKey?: string, openaiKey?: string, fake?: boolean, provider?: string, claudeBin?: string, log?: Console }} opts
 *   provider: 'openai' | 'anthropic' | legacy 'api' | 'subscription'.
 */
export function createApi({ apiKey, openaiKey, fake = false, provider: forced, claudeBin, log = console } = {}) {
  const anthropicKey = (apiKey || '').trim();
  const serviceKey = (openaiKey || '').trim();
  const bin = claudeBin || findClaudeBin();
  const provider = fake ? 'fake'
    : forced === 'subscription' ? (bin ? 'subscription' : null)
    : forced === 'openai' ? (serviceKey ? 'openai' : null)
    : forced === 'anthropic' || forced === 'api' ? (anthropicKey ? 'api' : null)
    : serviceKey ? 'openai'
    : anthropicKey ? 'api'
    : bin ? 'subscription'
    : null;
  const model = provider === 'openai' ? OPENAI_MODEL : MODEL;
  const selectedFastModel = () => provider === 'openai' ? openaiFastModel() : fastModel();
  log.info(`[bop] api provider=${provider || 'none'}`);
  let llmP = null;
  const getLlm = () => (llmP ||= provider === 'fake' ? import('./fake-llm.mjs').then(m => m.createFakeLlm())
    : provider === 'subscription' ? Promise.resolve(createCliLlm({ bin, log }))
    : provider === 'openai' ? Promise.resolve(createOpenAI({ apiKey: serviceKey, log }))
    : Promise.resolve(createClaude({ apiKey: anthropicKey, log })));
  const ready = async () => provider === 'subscription' ? cliLoggedIn(bin) : !!provider;
  const noModel = () => provider === 'subscription'
    ? new AgentError('auth', 'Bop ยังไม่ได้เชื่อมบัญชี AI ของเซิร์ฟเวอร์ (ผู้ดูแลต้องล็อกอินก่อน)')
    : new AgentError('no_key', 'Bop ยังไม่ได้เชื่อมบัญชี AI ใช้แผนตัวอย่างแบบออฟไลน์แทน');

  const routes = {
    'POST /api/plan': (body, ctx) => runPlan({ setup: body.setup, ...ctx }),
    'POST /api/replan': (body, ctx) => runReplan({ setup: body.setup, plan: body.plan, command: body.command, day: body.day, ...ctx }),
    'POST /api/plan/candidates': (body, ctx) => runCandidates({ setup: body.setup, ...ctx }),
    'POST /api/transport-options': (body, ctx) => runTransport({ setup: body.setup, dir: body.dir, ...ctx }),
    'POST /api/place-info': (body, ctx) => runPlaceInfo({ city: body.city, stop: body.stop, ...ctx }),
    'POST /api/weather-check': (body, ctx) => runWeatherCheck({ setup: body.setup, plan: body.plan, ...ctx }),
    'POST /api/flights/offer': (body, ctx) => runFlightOffer({ offerId: body.offerId, ...ctx }),
    'POST /api/flights/order': (body, ctx) => runFlightOrder({ body, ...ctx }),
    'POST /api/flights/cancel': (body, ctx) => runFlightCancel({ body, ...ctx }),
  };
  const NO_MODEL = new Set(['POST /api/weather-check', 'POST /api/flights/offer', 'POST /api/flights/order', 'POST /api/flights/cancel']);

  return async function api(req, res, next) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return next ? next() : undefined;
    const route = `${req.method} ${url.pathname}`;

    if (route === 'POST /api/line/webhook') {
      try {
        const raw = await readRaw(req);
        const result = await handleLineWebhook(raw, req.headers['x-line-signature']);
        return sendJson(res, result.statusCode, result.body);
      } catch (error) {
        const err = toAgentError(error);
        return sendJson(res, lineStatus(err), { error: err.code, message: err.message });
      }
    }

    if (route === 'GET /api/config') return sendJson(res, 200, lineConfig());

    const tripMatch = /^\/api\/trips\/([0-9a-f-]{36})(?:\/(plan|post|vote|vote\/close|identity|vote\/ballot))?$/.exec(url.pathname);
    if (route === 'POST /api/trips' || tripMatch) {
      try {
        if (req.method !== 'GET' && req.method !== 'DELETE' && !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
          return sendJson(res, 415, { error: 'bad_request', message: 'ต้องส่ง Content-Type: application/json' });
        }
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
        const organizerToken = req.headers['x-bop-trip-token'] || '';
        let result;
        if (route === 'POST /api/trips') result = await createLineTrip(body);
        else {
          const [, tripId, action = ''] = tripMatch;
          if (req.method === 'GET' && !action) result = await readLineTrip(tripId, organizerToken);
          else if (req.method === 'DELETE' && !action) result = await removeLineTrip(tripId, organizerToken);
          else if (req.method === 'POST' && action === 'plan') result = await updateLinePlan(tripId, organizerToken, body.summary);
          else if (req.method === 'POST' && action === 'post') result = await postLineText(tripId, organizerToken, body.text);
          else if (req.method === 'POST' && action === 'vote') result = await startLineVote(tripId, organizerToken, body);
          else if (req.method === 'GET' && action === 'vote') result = { vote: await readLineVote(tripId, organizerToken) };
          else if (req.method === 'POST' && action === 'vote/close') result = await closeLineVote(tripId, organizerToken, body.option);
          else if (req.method === 'POST' && action === 'identity') result = await lineIdentity(tripId, body);
          else if (req.method === 'POST' && action === 'vote/ballot') result = await lineLiffBallot(tripId, body);
          else return sendJson(res, 404, { error: 'not_found' });
        }
        return sendJson(res, 200, result);
      } catch (error) {
        const err = toAgentError(error);
        log.warn(`[bop] ${route} error ${err.code}: ${err.message}`);
        return sendJson(res, lineStatus(err), { error: err.code, message: err.message });
      }
    }

    if (route === 'GET /api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      const ok = await ready();
      return res.end(JSON.stringify({ ai: ok, claude: ok, provider: ok ? provider : null, model, fastModel: selectedFastModel(), search: ok, flights: duffelEnabled() ? { mode: duffelMode(), booking: bookingEnabled() } : null }));
    }
    if (route === 'GET /api/city') {
      const q = (url.searchParams.get('q') || '').slice(0, 80);
      let info = null;
      try { info = q ? await cityInfo(q) : null; } catch (_) { info = null; }
      res.writeHead(info ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(info ? { name: info.name, cc: info.cc, ll: info.ll } : { error: 'not_found' }));
    }
    const handler = routes[route];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not_found' }));
    }
    if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
      res.writeHead(415, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ type: 'error', code: 'bad_request', message: 'ต้องส่ง Content-Type: application/json' }) + '\n');
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const ctl = new AbortController();
    let finished = false;
    res.on('close', () => { if (!finished) ctl.abort(); });
    const write = obj => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };
    const emit = text => write({ type: 'step', text });
    const end = obj => { finished = true; write(obj); res.end(); };

    try {
      const body = await readJson(req);
      let llm = null;
      if (!NO_MODEL.has(route)) {
        if (!(await ready())) throw noModel();
        llm = await getLlm();
      }
      const out = await handler(body, { llm, emit, send: write, signal: ctl.signal, log });
      end(out);
    } catch (e) {
      const err = toAgentError(e);
      if (!ctl.signal.aborted) log.warn(`[bop] ${route} error ${err.code}: ${err.message}${err.detail ? ` (${String(err.detail).slice(0, 200)})` : ''}`);
      end({ type: 'error', code: err.code, message: err.message, ...(e && e.extra ? e.extra : {}) });
    }
  };
}
