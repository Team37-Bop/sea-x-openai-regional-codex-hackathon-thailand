/* Client for the Bop agent endpoints (see API.md). All agent calls stream NDJSON. */

const ERR_TH = {
  no_key: 'Bop ยังไม่ได้ตั้งค่า API key',
  auth: 'API key ของ Bop ใช้ไม่ได้ ตรวจสอบ key อีกครั้ง',
  rate_limit: 'Bop ใช้งานหนาแน่นอยู่ รอสักครู่แล้วลองใหม่',
  upstream: 'Bop ตอบไม่สำเร็จ ลองใหม่อีกครั้ง',
  bad_request: 'ข้อมูลที่ส่งไปไม่ครบหรือไม่ถูกต้อง',
  refusal: 'Bop ทำคำสั่งนี้ไม่ได้ ลองพิมพ์ใหม่ให้ชัดขึ้น',
  offline: 'ยังไม่มีเซิร์ฟเวอร์ agent ที่หน้านี้ (ทำงานแบบออฟไลน์)',
  network: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  cut: 'การเชื่อมต่อขาดก่อน Bop ตอบเสร็จ',
  aborted: 'ยกเลิกแล้ว',
};
/* the product is "Bop": never surface the model's name in any server text */
const SKIP = new Set(['url', 'page', 'href', 'model', 'id']);
export const brand = t => String(t ?? '').replace(/Claude(\s*(Code|AI|Opus|Sonnet|Haiku)?)?/gi, 'Bop').replace(/Anthropic/gi, 'Bop');
export function scrub(v, k) {
  if (typeof v === 'string') return SKIP.has(k) ? v : brand(v);
  if (Array.isArray(v)) return v.map(x => scrub(x, k));
  if (v && typeof v === 'object') { const o = {}; for (const [kk, vv] of Object.entries(v)) o[kk] = scrub(vv, kk); return o; }
  return v;
}
export const errText = e => brand((e && e.message) || ERR_TH[e && e.code] || ERR_TH.upstream);
const mkErr = (code, message) => ({ type: 'error', code, message: message || ERR_TH[code] });

/** GET /api/health. Never throws: unreachable or non-JSON → { claude:false, reachable:false }. */
export async function health() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('/api/health', { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return { claude: false, reachable: false };
    const j = await r.json();
    return { claude: !!j.claude, model: j.model || '', search: !!j.search, provider: j.provider || null, flights: j.flights || null, reachable: true };
  } catch (_) {
    return { claude: false, reachable: false };
  } finally { clearTimeout(t); }
}

/**
 * POST JSON, read the NDJSON stream line by line (tolerating partial lines across chunks),
 * call onEvent for every event, resolve with the single terminal event ({type:'done'} or {type:'error'}).
 * Never rejects: transport failures come back as {type:'error'} with a Thai message.
 */
export async function stream(url, body, { onEvent = () => {}, signal } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return e && e.name === 'AbortError' ? mkErr('aborted') : mkErr('network');
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.body || (!ct.includes('ndjson') && !ct.includes('json'))) {
    return mkErr(res.status === 404 || ct.includes('html') ? 'offline' : 'upstream');
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', terminal = null;
  const handle = line => {
    line = line.trim();
    if (!line) return;
    let ev;
    try { ev = JSON.parse(line); } catch (_) { return; }
    if (!ev || typeof ev !== 'object') return;
    ev = scrub(ev);
    if (ev.type === 'done' || ev.type === 'error') { if (!terminal) terminal = ev; }
    try { onEvent(ev); } catch (err) { console.error(err); }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    }
    buf += dec.decode();
    handle(buf);
  } catch (e) {
    if (e && e.name === 'AbortError') return mkErr('aborted');
    if (!terminal) return mkErr('cut');
  }
  if (!terminal) return res.ok ? mkErr('cut') : mkErr(res.status === 404 ? 'offline' : 'upstream');
  if (terminal.type === 'error' && !terminal.message) terminal.message = ERR_TH[terminal.code] || ERR_TH.upstream;
  return terminal;
}

export async function json(url, { method = 'GET', body, tripToken, signal } = {}) {
  try {
    const response = await fetch(url, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(tripToken ? { 'X-Bop-Trip-Token': tripToken } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return mkErr(data.error || (response.status === 401 ? 'auth' : 'upstream'), data.message);
    return { type: 'done', ...data };
  } catch (error) {
    return error?.name === 'AbortError' ? mkErr('aborted') : mkErr('network');
  }
}

export const api = {
  plan: (setup, o) => stream('/api/plan', { setup }, o),
  replan: (setup, plan, command, day, o) => stream('/api/replan', { setup, plan, command, day }, o),
  candidates: (setup, o) => stream('/api/plan/candidates', { setup }, o),
  transport: (setup, dir, o) => stream('/api/transport-options', { setup, dir }, o),
  placeInfo: (city, stop, o) => stream('/api/place-info', { city, stop }, o),
  weather: (setup, plan, o) => stream('/api/weather-check', { setup, plan }, o),
  flightOffer: (offerId, o) => stream('/api/flights/offer', { offerId }, o),
  flightOrder: (body, o) => stream('/api/flights/order', body, o),
  flightCancel: (body, o) => stream('/api/flights/cancel', body, o),
  config: o => json('/api/config', o),
  tripCreate: (body, o) => json('/api/trips', { ...o, method:'POST', body }),
  tripRead: (tripId, tripToken, o) => json(`/api/trips/${encodeURIComponent(tripId)}`, { ...o, tripToken }),
  tripDelete: (tripId, tripToken, o) => json(`/api/trips/${encodeURIComponent(tripId)}`, { ...o, method:'DELETE', tripToken }),
  linePlan: (tripId, tripToken, summary, o) => json(`/api/trips/${encodeURIComponent(tripId)}/plan`, { ...o, method:'POST', tripToken, body:{ summary } }),
  linePost: (tripId, tripToken, text, o) => json(`/api/trips/${encodeURIComponent(tripId)}/post`, { ...o, method:'POST', tripToken, body:{ text } }),
  lineVoteStart: (tripId, tripToken, body, o) => json(`/api/trips/${encodeURIComponent(tripId)}/vote`, { ...o, method:'POST', tripToken, body }),
  lineVoteRead: (tripId, tripToken, o) => json(`/api/trips/${encodeURIComponent(tripId)}/vote`, { ...o, tripToken }),
  lineVoteClose: (tripId, tripToken, option, o) => json(`/api/trips/${encodeURIComponent(tripId)}/vote/close`, { ...o, method:'POST', tripToken, body:{ option } }),
  lineIdentity: (tripId, body, o) => json(`/api/trips/${encodeURIComponent(tripId)}/identity`, { ...o, method:'POST', body }),
  lineBallot: (tripId, body, o) => json(`/api/trips/${encodeURIComponent(tripId)}/vote/ballot`, { ...o, method:'POST', body }),
};
