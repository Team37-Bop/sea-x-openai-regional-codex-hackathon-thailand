// Agent pipelines: model output -> geocode -> OSRM -> schedule -> checks -> one repair round.
// The model layer (`llm`) is injected so everything below runs without an API key (see fake-llm.mjs).
import { searchFlights } from './duffel.mjs';
import { dayLabel, toM, fmtT, haversine, clone, checks, explain, schedule, buildPlan, applyEdits, priceLegs, planBrief, sbaht, allLegs, legKey, bookedStays, dayStays, stayLine, findStop } from '../src/plan.js';
import { resolveSpecs, routePlans, geomOnly, cityInfo, pool } from './geo.mjs';
import { wikiPhotos, photosFor, ogImage, httpsUrl, normalizeHttpsUrl, variants, commonsNear } from './photos.mjs';

const CAND = new Map(); // candidate option id -> option (so picks.avoid ids can be resolved to names)
const validLL = ll => Array.isArray(ll) && ll.length >= 2 && Number.isFinite(+ll[0]) && Number.isFinite(+ll[1]) && Math.abs(+ll[0]) <= 90 && Math.abs(+ll[1]) <= 180 && !(+ll[0] === 0 && +ll[1] === 0);

const SEARCH_PLAN = Number(process.env.BOP_SEARCH_PLAN ?? 5);
import { AgentError } from './claude.mjs';

const MAX_STR = 400;
export const cleanModelText = value => String(value || '')
  .replace(/!\[([^\]]*)\]\(\s*<?https?:\/\/[^)]+\)/gi, '$1')
  .replace(/\[([^\]]+)\]\(\s*<?https?:\/\/[^)]+\)/gi, '$1')
  .replace(/^```(?:markdown|md|text)?\s*|\s*```$/gi, '')
  .trim();
const s = (v, n = MAX_STR) => (typeof v === 'string' ? cleanModelText(v).slice(0, n) : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Validate + trim a TripSetup from the browser. Throws AgentError('bad_request'). */
export function normalizeSetup(raw) {
  if (!raw || typeof raw !== 'object') throw new AgentError('bad_request', 'ไม่มีข้อมูลทริป (setup)');
  const members = Array.isArray(raw.members) ? raw.members.slice(0, 12) : [];
  if (!members.length) throw new AgentError('bad_request', 'ต้องมีสมาชิกอย่างน้อย 1 คน');
  const ids = new Set();
  const out = {
    title: s(raw.title, 120) || 'ทริปของเรา',
    city: s(raw.city, 60) || 'เชียงใหม่',
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate || '') ? raw.startDate : null,
    days: Math.max(1, Math.min(7, Math.round(num(raw.days) || 3))),
    members: members.map((m, i) => {
      let id = String(m && m.id || `m${i + 1}`).replace(/[^\w-]/g, '').slice(0, 24) || `m${i + 1}`;
      while (ids.has(id)) id += '_';
      ids.add(id);
      const o = { id, name: s(m.name, 40) || `เพื่อน ${i + 1}` };
      if (m.role === 'organizer') o.role = 'organizer';
      if (s(m.note)) o.note = s(m.note);
      const av = s(m.avoid, 120) || (m.veg === true ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : '');
      if (av) o.avoid = av;
      if (num(m.maxWalkKm) > 0) o.maxWalkKm = num(m.maxWalkKm);
      if (num(m.budget) > 0) o.budget = Math.round(num(m.budget));
      const wants = Array.isArray(m.wants) ? m.wants.map(w => s(w, 120)).filter(Boolean).slice(0, 5) : [];
      if (wants.length) o.wants = wants;
      return o;
    }),
  };
  if (!out.startDate) throw new AgentError('bad_request', 'วันที่เริ่มทริปไม่ถูกต้อง (YYYY-MM-DD)');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.endDate || '')) {
    const n = Math.round((Date.parse(raw.endDate) - Date.parse(out.startDate)) / 864e5) + 1;
    if (n >= 1) { out.endDate = raw.endDate; out.days = Math.min(7, n); }
  }
  const hm = t => /^\d{1,2}:\d{2}$/.test(t || '');
  const BY = ['flight', 'drive', 'bus', 'train', 'undecided'];
  const way = (x, place) => {
    if (!x || typeof x !== 'object') return null;
    const o = { by: BY.includes(x.by) ? x.by : (hm(x.time) ? 'flight' : 'undecided') };
    o[place] = s(x[place], 80);
    if (hm(x.time)) o.time = x.time.padStart(5, '0');
    if (x.auto === true) o.auto = true;
    const c = x.choice;
    if (c && typeof c === 'object' && hm(c.dep) && hm(c.arr) && s(c.carrier)) {
      o.choice = { id: s(c.id, 20) || 'pick', by: ['flight', 'bus', 'train'].includes(c.by) ? c.by : (o.by === 'undecided' ? 'flight' : o.by),
        carrier: s(c.carrier, 60), from: s(c.from, 40), to: s(c.to, 40), dep: c.dep.padStart(5, '0'), arr: c.arr.padStart(5, '0'),
        price: num(c.price) != null ? Math.round(c.price) : null, src: { url: /^https?:\/\//.test(c.src && c.src.url || '') ? c.src.url : '', title: s(c.src && c.src.title, 160) },
        checked: c.checked === 'web' ? 'web' : 'estimate' };
      if (s(c.code)) o.choice.code = s(c.code, 20);
      if (s(c.bag)) o.choice.bag = s(c.bag, 80);
      if (c.checked === 'live' && /^off_[A-Za-z0-9]+$/.test(c.offerId || '')) Object.assign(o.choice, { checked: 'live', bookable: c.bookable === true, offerId: c.offerId, expiresAt: s(c.expiresAt, 40), test: c.test === true });
    }
    return o;
  };
  if (way(raw.arrive, 'from')) out.arrive = way(raw.arrive, 'from');
  if (way(raw.depart, 'to')) out.depart = way(raw.depart, 'to');
  if (raw.hasCar === true || (raw.hasCar !== false && ((out.arrive && out.arrive.by === 'drive') || (out.depart && out.depart.by === 'drive')))) out.hasCar = true;
  if (s(raw.country, 60)) out.country = s(raw.country, 60);
  out.autonomy = raw.autonomy === 'ask' ? 'ask' : 'auto';
  // Booked stays by night (old { mode:'booked', name } = one stay for every night). Coordinates are found server-side.
  const stays = bookedStays(raw.stay, out.days).map(x => ({ name: x.name, nights: x.nights }));
  out.stay = stays.length ? { mode: 'booked', stays } : { mode: 'auto' };
  if (raw.picks && typeof raw.picks === 'object') {
    const must = (Array.isArray(raw.picks.must) ? raw.picks.must : []).filter(o => o && s(o.name)).slice(0, 15).map(o => {
      const c = CAND.get(o.id) || {};
      const x = { id: s(o.id, 60), name: s(o.name, 120), query: s(o.query || c.query, 120), kind: ['food', 'sight', 'stay'].includes(o.kind || c.kind) ? (o.kind || c.kind) : 'sight' };
      const ll = validLL(o.ll) ? o.ll : c.ll;
      if (validLL(ll)) x.ll = [+ll[0], +ll[1]];
      return x;
    });
    const avoid = (Array.isArray(raw.picks.avoid) ? raw.picks.avoid : []).slice(0, 30).map(a => {
      const id = typeof a === 'string' ? a : a && a.id; const c = CAND.get(id);
      return { id: s(id, 60), name: c ? c.name : s(typeof a === 'string' ? a : a && a.name, 120), query: c ? c.query : '' };
    }).filter(a => a.name);
    if (must.length || avoid.length) out.picks = { must, avoid };
  }
  if (/^[A-Z]{3}$/.test(raw.currency || '')) out.currency = raw.currency;
  if (/^[A-Z]{3}$/.test(raw.cityAirport || '')) out.cityAirport = raw.cityAirport;
  if (['chill', 'normal', 'packed'].includes(raw.pace)) out.pace = raw.pace;
  if (s(raw.hotelArea, 80)) out.hotelArea = s(raw.hotelArea, 80);
  if (s(raw.extra, 1000)) out.extra = s(raw.extra, 1000);
  return out;
}

function validPlan(p) {
  return p && Array.isArray(p.days) && p.days.length && p.days.every(d => d && Array.isArray(d.stops) &&
    d.stops.every(x => x && typeof x.id === 'string' && Array.isArray(x.ll) && /^\d{1,2}:\d{2}$/.test(x.t0) && /^\d{1,2}:\d{2}$/.test(x.t1)));
}

const specsOfEdits = edits => edits.filter(e => (e.op === 'insert' || e.op === 'replace') && e.stop &&
  (e.stop.catalog || e.stop.lat || e.stop.lng)).map(e => e.stop);
const cleanEdits = edits => (Array.isArray(edits) ? edits : []).filter(e => e && typeof e.op === 'string');

/** Route + schedule + price a set of plans in one OSRM batch. */
async function finalize(plans, setup, { signal, emit }) {
  const r = await routePlans(plans, { signal });
  const bits = [r.via && r.via.osrm && `OSRM ${r.via.osrm}`, r.via && r.via.valhalla && `Valhalla ${r.via.valhalla}`, r.cached && `แคช ${r.cached}`, r.failed && `เส้นตรงประมาณ ${r.failed}`].filter(Boolean);
  emit && emit(`คำนวณเส้นทางจริง ${r.total} ช่วง${bits.length ? ` · ${bits.join(' · ')}` : ''}`);
  for (const p of plans) { schedule(p, r.routes); priceLegs(p, setup.members.length); }
  return r.routes;
}

const normUrl = u => String(u || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
/** Keep stop.src.checked === 'web' only when its URL is one the search actually returned. Returns counts. */
function verifySrc(plans, seenUrls, onlyIds) {
  const seen = new Set([...(seenUrls || new Map()).keys()].map(normUrl));
  let web = 0, est = 0;
  for (const p of plans) for (const d of p.days) for (const st of d.stops) {
    if (onlyIds && !onlyIds.has(st.id)) continue;
    if (!st.src) continue;
    if (st.src.checked === 'web' && !seen.has(normUrl(st.src.url))) st.src = { url: '', title: '', checked: 'estimate' };
    st.src.checked === 'web' ? web++ : est++;
  }
  return { web, est };
}

const ckLine = ck => `ผ่าน ${ck.pass}/${ck.list.length}`;
function report(plan, setup, extra = [], onlyDays = null) {
  const fails = explain(plan, setup);
  let brief = planBrief(plan, setup);
  if (onlyDays && onlyDays.size) {
    brief = brief.split(/\n(?=วันที่ \d+ \()/).filter(b => onlyDays.has(+(/^วันที่ (\d+)/.exec(b) || [])[1] - 1)).join('\n');
    extra = [...extra, `แก้เฉพาะวันที่ ${[...onlyDays].map(i => i + 1).join(', ')} (วันอื่นผ่านแล้ว ห้ามแตะ)`];
  }
  return [
    ...extra,
    fails.length ? 'เงื่อนไขที่ไม่ผ่าน:\n' + fails.map(f => `- ${f.rule}${f.who ? ` (${f.who}, id ${f.member})` : ''}: ${f.why.join('; ')}`).join('\n') : 'เงื่อนไขผ่านทั้งหมด',
    'แผนหลังจัดเวลาตามเส้นทางจริง:\n' + brief,
  ].join('\n\n');
}
/** Days the repair should touch: those named in failure reasons / problem lines (stop ids map to their day). Null = whole trip. */
function failingDays(plan, setup, lines = []) {
  const days = new Set(), idDay = new Map();
  plan.days.forEach((d, i) => d.stops.forEach(st => idDay.set(st.id, i)));
  const texts = [...explain(plan, setup).flatMap(f => f.why.length ? f.why : ['ALL']), ...lines];
  for (const t of texts) {
    let hit = false;
    for (const m of t.matchAll(/วันที่ (\d+)/g)) { days.add(+m[1] - 1); hit = true; }
    for (const m of t.matchAll(/\b(d\d+_[\w]+)/g)) if (idDay.has(m[1])) { days.add(idDay.get(m[1])); hit = true; }
    if (!hit) return null; // e.g. the budget: needs the whole trip
  }
  return days.size ? days : null;
}

function geoLine(by, n) {
  const parts = [];
  if (by.geocoded) parts.push(`OSM ${by.geocoded}`);
  if (by.catalog) parts.push(`คลังข้อมูล ${by.catalog}`);
  if (by.pick) parts.push(`ที่กลุ่มเลือก ${by.pick}`);
  if (by.model) parts.push(`พิกัดประมาณ ${by.model}`);
  return `หาพิกัดสถานที่ ${n} แห่ง · ${parts.join(' · ')}`;
}

const foldName = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const nameToks = x => foldName(x).split(/[^a-z0-9\u0E00-\u0E7F]+/).filter(w => w.length > 2);
function sameName(a, b) {
  const A = foldName(a).replace(/\s+/g, ''), B = foldName(b).replace(/\s+/g, '');
  if (A && B && (A.includes(B) || B.includes(A))) return true;
  const ta = new Set(nameToks(a)), tb = nameToks(b);
  const hit = tb.filter(w => ta.has(w)).length;
  return hit >= 2 || (hit === 1 && Math.min(ta.size, tb.length) === 1);
}
const matchesPick = (stop, pk) => sameName(stop.n, pk.name) || (pk.query && sameName((stop.place && stop.place.query) || stop.query || '', pk.query)) ||
  (pk.ll && validLL(stop.ll) && haversine(stop.ll, pk.ll) <= 0.25);
/** Missing must-picks and present avoided places, as Thai problem lines. */
function pickIssues(plan, picks) {
  if (!picks) return { lines: [], placed: 0 };
  const stops = plan.days.flatMap(d => d.stops);
  const missing = picks.must.filter(pk => !stops.some(st => matchesPick(st, pk)));
  const bad = picks.avoid.filter(pk => stops.some(st => sameName(st.n, pk.name) || (pk.query && sameName((st.place && st.place.query) || '', pk.query))));
  return { placed: picks.must.length - missing.length,
    lines: [...missing.map(pk => `ต้องใส่ "${pk.name}"${pk.ll ? ` (@${pk.ll[0]},${pk.ll[1]})` : ''} ที่กลุ่มเลือกไว้ ยังไม่อยู่ในแผน`),
      ...bad.map(pk => `ต้องเอา "${pk.name}" ออก (กลุ่มไม่เอา)`)] };
}
/** Never ship a stop without real coordinates: fall back to the previous stop, then the city centre. */
function fixCoords(plan, center, log) {
  let fixed = 0;
  for (const d of plan.days) d.stops.forEach((st, i) => {
    if (validLL(st.ll)) { st.ll = [+st.ll[0], +st.ll[1]]; return; }
    const prev = i ? d.stops[i - 1].ll : null;
    st.ll = validLL(prev) ? [...prev] : validLL(center) ? [...center] : [0.0001, 0.0001];
    st.place = { ...(st.place || {}), source: 'model' }; fixed++;
  });
  if (fixed) log && log.warn(`[bop] ${fixed} stop(s) had no valid coordinates; used neighbour/city centre`);
  return fixed;
}

/* ---------------- transport (flights / trains / buses, web search only) ---------------- */
const KIND_TH = { flight: 'เที่ยวบิน', train: 'รถไฟ', bus: 'รถทัวร์', undecided: 'วิธีเดินทาง' };
const hhmm = t => (/^\d{1,2}:\d{2}$/.test(String(t || '').trim()) ? String(t).trim().padStart(5, '0') : null);

function transportAsk(setup, dir) {
  const go = dir === 'go', leg = go ? setup.arrive : setup.depart;
  const dayIdx = go ? 0 : setup.days - 1;
  const lab = dayLabel(setup.startDate, dayIdx);
  const from = go ? (leg.from || 'กรุงเทพฯ') : setup.city, to = go ? setup.city : (leg.to || 'กรุงเทพฯ');
  const by = leg.by === 'undecided' ? 'เครื่องบิน รถไฟ หรือรถทัวร์ (เทียบแล้วเลือกที่ดีที่สุด)' : KIND_TH[leg.by];
  const prompt = `ทริป: ${setup.title} · ${setup.members.length} คน\nเที่ยว${go ? 'ขาไป' : 'ขากลับ'}: จาก ${from} ไป ${to}${setup.country ? ` (${setup.country})` : ''}\n` +
    `วันที่ ${lab.date} (${lab.label}, ${lab.short})\nวิธีเดินทาง: ${by}\n` +
    (go ? 'อยากถึงปลายทางไม่เกินช่วงสาย ๆ ของวันแรก' : 'อยากออกหลังมื้อเย็นของวันสุดท้าย แต่ไม่ดึกเกินไป');
  const short = x => String(x).length > 14 ? String(x).slice(0, 14) + '…' : x;
  return { prompt, step: `ค้น${KIND_TH[leg.by] || 'การเดินทาง'} ${short(from)} → ${short(to)} ${lab.label}` };
}

function normalizeTransport(json, seenUrls, dir) {
  const seen = new Set([...(seenUrls || new Map()).keys()].map(normUrl));
  const opts = (json.options || []).filter(o => o && s(o.carrier) && hhmm(o.dep) && hhmm(o.arr)).slice(0, 5).map((o, i) => {
    const sourceUrl = normalizeHttpsUrl(o.srcUrl || '');
    const web = o.checked === 'web' && sourceUrl && seen.has(normUrl(sourceUrl));
    const x = { id: `${dir}-${i + 1}`, by: ['flight', 'bus', 'train'].includes(o.by) ? o.by : 'flight', carrier: s(o.carrier, 60),
      from: s(o.from, 40), to: s(o.to, 40), dep: hhmm(o.dep), arr: hhmm(o.arr),
      price: num(o.price) != null && o.price > 0 ? Math.round(o.price) : null,
      src: web ? { url: sourceUrl, title: s(o.srcTitle, 160) || sourceUrl } : { url: '', title: '' }, checked: web ? 'web' : 'estimate' };
    if (s(o.code)) x.code = s(o.code, 20);
    if (s(o.bag)) x.bag = s(o.bag, 80);
    if (o.recommended === true) x.recommended = true;
    if (s(o.why)) x.why = s(o.why, 200);
    return x;
  });
  const rec = opts.find(o => o.recommended) || opts[0];
  opts.forEach(o => { if (o !== rec) { delete o.recommended; } });
  if (rec) { rec.recommended = true; if (!rec.why) rec.why = 'ราคาเป็นค่าประมาณจากเว็บ'; }
  return opts;
}

async function searchTransport({ setup, dir, llm, emit, signal, usage, loc }) {
  const leg = dir === 'go' ? setup.arrive : setup.depart;
  // Flights: live, bookable Duffel offers first (DUFFEL_ACCESS_TOKEN). Empty when off/failed/no offers -> web search as before.
  const live = await searchFlights({ setup, dir, signal, emit });
  if (live.length && leg && leg.by === 'flight') { emit(`พบ ${live.length} เที่ยวบินราคาสด`); return live; }
  const { prompt, step } = transportAsk(setup, dir);
  emit(step);
  const { json, seenUrls } = await llm.transport({ prompt, loc, signal, usage, onStep: emit });
  const web = normalizeTransport(json, seenUrls, dir);
  if (!live.length) return web;
  // undecided: live flights replace the web-searched flights; buses/trains stay from the web
  const merged = [...live, ...web.filter(o => o.by !== 'flight')].slice(0, 6);
  merged.forEach(o => { if (o !== live[0]) delete o.recommended; });
  return merged;
}

function transportBrief(p) {
  const T = p.flags && p.flags.transport; if (!T) return '';
  return '\n\nเที่ยวเดินทางที่มีให้เลือก (* = ที่ใช้อยู่):\n' + ['go', 'back'].filter(d => T[d]).map(d => `${d === 'go' ? 'ขาไป' : 'ขากลับ'}: ` +
    T[d].options.map(o => `${o.id === T[d].chosen ? '*' : ''}${o.carrier} ${o.code || ''} ${o.from} ${o.dep}→${o.to} ${o.arr}${o.price ? ' ฿' + o.price : ''}`).join(' | ')).join('\n');
}
const codeKey = x => String(x || '').replace(/\s+/g, '').toUpperCase();
/** First stop of day 1 = arrival time; last stop of the last day = 90 min (flight) / 40 min before departure. */
function retimeEnd(plan, dir, m) {
  const days = plan.days;
  if (dir === 'go') { const f = days[0] && days[0].stops[0]; if (f && f.k === 'transit') { f.t0 = f.t1 = m.arr; } }
  else {
    const ls = days[days.length - 1].stops, l = ls[ls.length - 1];
    if (l && l.k === 'transit') { const t = Math.max(0, toM(m.dep) - (m.by === 'flight' ? 90 : 40)); l.t0 = l.t1 = fmtT(t); }
  }
}
/** Point plan.flags.transport[dir].chosen at the option the user asked for (adding it if unknown) and re-time the end stop. */
function applyTransportChange(plan, tc) {
  plan.flags = plan.flags || {};
  const T = plan.flags.transport = plan.flags.transport || {};
  const e = T[tc.dir] = T[tc.dir] || { chosen: '', options: [] };
  const dep = hhmm(tc.dep), arr = hhmm(tc.arr);
  let m = e.options.find(o => tc.code && o.code && codeKey(o.code) === codeKey(tc.code))
    || e.options.find(o => s(tc.carrier) && o.carrier.toLowerCase() === s(tc.carrier).toLowerCase() && (!dep || o.dep === dep));
  if (!m) {
    m = { id: `${tc.dir}-${e.options.length + 1}`, by: ['flight', 'bus', 'train'].includes(tc.by) ? tc.by : 'flight', carrier: s(tc.carrier, 60) || 'ไม่ระบุ',
      from: s(tc.from, 40), to: s(tc.to, 40), dep: dep || '00:00', arr: arr || '00:00', price: null, src: { url: '', title: '' }, checked: 'estimate', why: 'ผู้ใช้ระบุเอง' };
    if (s(tc.code)) m.code = s(tc.code, 20);
    e.options.push(m);
  } else { if (dep) m.dep = dep; if (arr) m.arr = arr; }
  e.chosen = m.id;
  retimeEnd(plan, tc.dir, m);
}

/* ---------------- /api/transport-options ---------------- */
export async function runTransport({ setup: raw, dir, llm, emit, signal, log = console }) {
  const T = Date.now(), usage = {};
  const setup = normalizeSetup(raw);
  if (dir !== 'go' && dir !== 'back') throw new AgentError('bad_request', 'dir ต้องเป็น go หรือ back');
  const leg = dir === 'go' ? setup.arrive : setup.depart;
  if (!leg || leg.by === 'drive') throw new AgentError('bad_request', dir === 'go' ? 'ไม่มีข้อมูลขาไป (arrive) หรือขับรถไปเอง' : 'ไม่มีข้อมูลขากลับ (depart) หรือขับรถกลับเอง');
  const city = await cityInfo(setup.country ? `${setup.city}, ${setup.country}` : setup.city, signal);
  const options = await searchTransport({ setup, dir, llm, emit, signal, usage, loc: city ? { cc: city.cc, name: city.name } : null });
  const rec = options.find(o => o.recommended);
  emit(options.length ? `พบ ${options.length} ตัวเลือก · แนะนำ ${rec.carrier}${rec.code ? ' ' + rec.code : ''} ${rec.dep}–${rec.arr}` : 'ไม่พบตัวเลือกที่เชื่อถือได้');
  const ms = Date.now() - T;
  log.info(`[bop] transport ${dir} ${(ms / 1000).toFixed(1)}s ${options.length} options usage=${JSON.stringify(usage)}`);
  return { type: 'done', options, ms, usage };
}

/* ---------------- /api/plan/candidates (ask-before-acting) ---------------- */
let candSeq = 0;
export async function runCandidates({ setup: raw, llm, emit, signal, log = console }) {
  const T = Date.now(), usage = {};
  const setup = normalizeSetup(raw);
  const city = await cityInfo(setup.country ? `${setup.city}, ${setup.country}` : setup.city, signal);
  const loc = city ? { cc: city.cc, name: city.name } : null;
  const avoid = setup.members.filter(m => m.avoid).map(m => `${m.name}: ${m.avoid}`);
  emit(`ค้นร้านอาหารและที่เที่ยวที่น่าสนใจใน${setup.city}`);
  const prompt = `ทริป (TripSetup):\n${JSON.stringify({ ...setup, picks: undefined }, null, 1)}\n\n` +
    `หาตัวเลือกให้กลุ่มเลือกก่อนวางแผน: ร้านอาหารเด่น ที่เที่ยวห้ามพลาด และย่าน/ที่พัก${avoid.length ? `\nมีคนแพ้/ไม่ทาน (${avoid.join('; ')}): ระบุทุกร้านว่ามีเมนูที่เขาทานได้ไหม` : ''}`;
  const { json, seenUrls } = await llm.candidates({ prompt, loc, signal, usage, onStep: emit });
  const seen = new Set([...(seenUrls || new Map()).keys()].map(normUrl));
  const run = ++candSeq;
  const slugify = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'x';
  const ids = new Set();
  const questions = (json.questions || []).slice(0, 3).map((q, qi) => {
    const qid = `q${run}_${slugify(q.id || q.kind || qi)}`;
    const kind = ['food', 'sight', 'stay'].includes(q.kind) ? q.kind : 'sight';
    const options = (q.options || []).filter(o => o && s(o.name)).slice(0, 6).map(o => {
      let id = `c${run}_${slugify(o.id || o.query || o.name)}`; while (ids.has(id)) id += '_'; ids.add(id);
      const x = { id, name: s(o.name, 120), why: s(o.why, 200), tags: (Array.isArray(o.tags) ? o.tags : []).map(t => s(t, 24)).filter(Boolean).slice(0, 4),
        _query: s(o.query, 120), _kind: kind, _aliases: (Array.isArray(o.aliases) ? o.aliases : []).map(a => s(a, 80)).filter(Boolean).slice(0, 6), _spec: { n: s(o.name, 120), query: s(o.query, 120) || s(o.name, 120), lat: num(o.lat) || 0, lng: num(o.lng) || 0 } };
      if (s(o.price)) x.price = s(o.price, 60);
      const sourceUrl = normalizeHttpsUrl(o.srcUrl || '');
      const photoPage = normalizeHttpsUrl(o.photoPage || '');
      if (o.checked === 'web' && sourceUrl && seen.has(normUrl(sourceUrl))) x.src = { url: sourceUrl, title: s(o.srcTitle, 160) || sourceUrl };
      x._page = x.src ? x.src.url : sourceUrl; // photo fallback only (public https, never shown as a source)
      x._photoPage = photoPage;
      return x;
    });
    return { id: qid, kind, title: s(q.title, 160) || 'อยากให้ใส่ที่ไหนในแผนบ้าง', multi: true, options };
  }).filter(q => q.options.length);
  const all = questions.flatMap(q => q.options.map(o => ({ o, kind: q.kind })));
  emit(`หาพิกัดและรูป ${all.length} แห่ง`);
  const t = Date.now();
  // Photos, in confidence order: Wikimedia exact match -> og:image of the place's own page (photoPage) -> og:image of the
  // source page -> (missing ones) one cheap search for the place's own pages, max 6 per request -> Commons files within 300 m.
  // Geocoding runs alongside. Pass 1 is capped at 15 s, pass 2 at 35 s.
  const geoP = resolveSpecs(all.map(x => x.o._spec), { center: city && city.ll, signal });
  const modelLL = o => validLL([o._spec.lat, o._spec.lng]) ? [o._spec.lat, o._spec.lng] : null;
  const setPhoto = (o, ph) => { const url = normalizeHttpsUrl(ph?.url || ''); if (url) o.photo = { url, credit: ph.credit, page: normalizeHttpsUrl(ph.page || '') || ph.page, match: ph.match }; return !!o.photo; };
  const capped = async (ms, fn) => {
    const b = new AbortController(); const tm = setTimeout(() => b.abort(), ms);
    const onA = () => b.abort(); signal?.addEventListener('abort', onA);
    try { await fn(b.signal); } finally { clearTimeout(tm); signal?.removeEventListener('abort', onA); }
  };
  await capped(15000, sig => pool(all, 4, async ({ o }) => {
    try {
      const kind = o._kind === 'stay' ? 'area' : o._kind, vars = variants(o.name, o._query, o._aliases);
      const w = await wikiPhotos({ name: o.name, query: o._query, aliases: o._aliases, ll: modelLL(o), kind, signal: sig, limit: 1 }).catch(() => []);
      if (setPhoto(o, w[0])) return;
      for (const pg of [o._photoPage, o._page].filter(Boolean)) if (setPhoto(o, await ogImage(pg, { signal: sig, vars }))) return;
    } catch { /* next pass */ }
  }));
  const missing = all.filter(x => !x.o.photo);
  if (missing.length) {
    emit(`หารูปเพิ่ม ${missing.length} แห่ง`);
    // 2a: Commons files near the place (cheap, all missing options)
    await capped(10000, sig => pool(missing, 4, async ({ o }) => {
      try { setPhoto(o, (await commonsNear({ name: o.name, query: o._query, aliases: o._aliases, ll: modelLL(o), signal: sig }).catch(() => []))[0]); } catch { /* none */ }
    }));
    // 2b: one cheap search (fast model) per option still missing a photo, 4 at a time. Stay areas search the area itself.
    const still = missing.filter(x => !x.o.photo);
    if (still.length && llm.findPages) await capped(60000, sig => pool(still, 6, async ({ o }) => {
      try {
        const vars = variants(o.name, o._query, o._aliases);
        const what = o._kind === 'stay' && /ย่าน|area|beach|หาด|district/i.test(`${o.name} ${o._query}`) ? `${o._query || o.name} (ย่าน/พื้นที่ ขอหน้าที่พูดถึงพื้นที่นี้)` : (o._query || o.name);
        const pages = await llm.findPages({ name: what, city: city ? city.name : setup.city, loc, signal: sig, usage }).catch(e => { log.warn(`[bop] pages ${o.name}: ${e.message}`); return []; });
        const found = await Promise.all(pages.slice(0, 5).map(pg => ogImage(pg, { signal: sig, vars })));
        setPhoto(o, found.find(Boolean));
        log.info(`[bop] photo search ${o.name}: ${pages.length} pages, ${found.filter(Boolean).length} images`);
      } catch { /* no photo */ }
    }));
  }
  await geoP;
  for (const { o, kind } of all) {
    if (validLL([o._spec.lat, o._spec.lng])) o.ll = [o._spec.lat, o._spec.lng];
    CAND.set(o.id, { name: o.name, query: o._query, ll: o.ll, kind }); delete o._spec; delete o._query; delete o._page; delete o._kind; delete o._aliases; delete o._photoPage;
  }
  const nPhoto = all.filter(x => x.o.photo).length;
  emit(`ได้ ${questions.length} คำถาม · ${all.length} ตัวเลือก · มีรูป ${nPhoto}`);
  const ms = Date.now() - T;
  log.info(`[bop] candidates ${(ms / 1000).toFixed(1)}s ${questions.length}q/${all.length}opt photos=${nPhoto} (${Date.now() - t}ms geo+photos) usage=${JSON.stringify(usage)}`);
  return { type: 'done', questions, ms, usage };
}

/* ---------------- /api/plan ---------------- */
const SPLIT_MIN_DAYS = Number(process.env.BOP_SPLIT_MIN_DAYS || 3); // measured: 3-day split 62 s vs single call 76-89 s
const DAY_CONCURRENCY = Number(process.env.BOP_DAY_CONCURRENCY || 3);
/** Booked hotels are authoritative: every hotel stop of day `di` (not the home stop of a drive) becomes the hotel the
 *  day starts or ends at (by name, else the day's first stop = start hotel, else the nearest). Without `di`, any stay. */
const pinStay = (specs, setup, di, { firstIsStart = true } = {}) => {
  const all = setup.stay && setup.stay.mode === 'booked' && Array.isArray(setup.stay.stays) ? setup.stay.stays.filter(b => validLL([b.lat, b.lng])) : [];
  if (!all.length) return;
  const ds = Number.isInteger(di) ? dayStays(setup)[di] : null;
  let cands = ds ? [...new Set([ds.start, ds.end])].filter(b => b && validLL([b.lat, b.lng])) : all;
  if (!cands.length) cands = all; // a day trip with a booked base
  const home = setup.arrive && setup.arrive.by === 'drive' ? setup.arrive.from : null;
  specs.forEach((sp, j) => {
    if (!sp || sp.k !== 'stay') return;
    if (home && (sameName(sp.query || sp.n, home) || /บ้าน/.test(sp.n))) return;
    const has = validLL([sp.lat, sp.lng]), dist = b => haversine([sp.lat, sp.lng], [b.lat, b.lng]);
    const named = cands.find(b => sameName(sp.n, b.name) || sameName(sp.query || '', b.name));
    let b = named;
    if (!b) {
      if (cands.length === 1) b = cands[0];
      else if (j === 0 && firstIsStart) b = cands[0];
      else if (has) b = cands.reduce((x, y) => (dist(y) < dist(x) ? y : x));
      else if (firstIsStart) b = cands[cands.length - 1];
      else return;
      if (has && dist(b) > 60) return;
    }
    Object.assign(sp, { n: b.name, query: b.name, lat: b.lat, lng: b.lng, catalog: '', pinned: true });
  });
};
/** Replan/repair edits that insert or replace a hotel stop: pin it to that day's booked hotel (by name or nearest). */
const pinEditStays = (edits, plan, setup) => {
  for (const e of edits) {
    if (!e.stop || e.stop.k !== 'stay' || (e.op !== 'insert' && e.op !== 'replace')) continue;
    const di = e.op === 'insert' ? Math.max(0, Math.min(plan.days.length - 1, e.day | 0)) : (findStop(plan, e.id) || {}).di;
    if (Number.isInteger(di)) pinStay([e.stop], setup, di, { firstIsStart: false });
  }
};
/** Make day `di` start at the hotel of the night before and end at the hotel of that night (booked stays only).
 *  Adds a hotel stop when the model left it out; on a move day the start stop carries the check-out note. */
const anchorStays = (specs, setup, di) => {
  const ds = dayStays(setup)[di];
  if (!ds || !specs.length) return specs;
  const ok = b => b && validLL([b.lat, b.lng]);
  const at = (sp, b) => sp && sp.k === 'stay' && ok(b) && sp.lat === b.lat && sp.lng === b.lng;
  const mode = setup.hasCar ? 'own' : 'car';
  const stop = (b, id, t, note, m) => ({ id, n: b.name, k: 'stay', t0: t, t1: t, query: b.name, aliases: [], catalog: '', lat: b.lat, lng: b.lng,
    cost: 0, walk: 0, open: '', meal: '', star: '', note, closedDays: [], onlyDays: [], closures: [], mode: m, legCost: -1, legWhy: '', pinned: true });
  const out = ds.move && ok(ds.end) ? `เช็กเอาต์ ขนกระเป๋าไป${ds.end.name}` : 'เช็กเอาต์ ขนกระเป๋าไปด้วย';
  const hm = t => /^\d{1,2}:\d{2}$/.test(t || '');
  if (ok(ds.start) && !at(specs[0], ds.start)) {
    const first = specs[0];
    if (!first.mode || first.mode === 'none') { first.mode = mode; first.legCost = -1; }
    const t = fmtT(Math.max(toM('06:00'), toM(hm(first.t0) ? first.t0 : '09:00') - 20));
    specs.unshift(stop(ds.start, `d${di + 1}_from_stay`, t, ds.move ? out : 'ออกจากที่พัก', 'none'));
  } else if (ds.move && at(specs[0], ds.start) && !/เช็กเอาต์|check.?out/i.test(specs[0].note || '')) {
    specs[0].note = [specs[0].note, out].filter(Boolean).join(' · ');
  }
  if (ok(ds.end) && !at(specs[specs.length - 1], ds.end)) {
    const last = specs[specs.length - 1];
    const t = fmtT(Math.min(toM('23:30'), toM(hm(last.t1) ? last.t1 : '20:00') + 30));
    specs.push(stop(ds.end, `d${di + 1}_to_stay`, t, ds.move ? `เช็กอิน ${ds.end.name}` : 'กลับที่พัก', mode));
  }
  return specs;
};
/** Find coordinates for each booked stay (in place). Known plan stops first, then the geocoder with shorter names
 *  ("Novotel Danang Premier Han River" vs "Novotel Danang"), then a wider radius for stays outside the city
 *  (a 2-town trip such as เชียงใหม่ + ปาย). Returns how each was found: 'given' | 'plan' | 'geocoded' | 'model'. */
async function geocodeStays(stays, { center, signal, known = [] }) {
  const how = [];
  for (const b of stays) {
    if (validLL([b.lat, b.lng])) { how.push('given'); continue; }
    const k = known.find(st => st && st.k === 'stay' && validLL(st.ll) && sameName(st.n, b.name));
    if (k) { b.lat = +k.ll[0]; b.lng = +k.ll[1]; how.push('plan'); continue; }
    const words = b.name.split(/\s+/);
    let hs = { source: 'model' };
    for (const q of [...new Set([b.name, words.slice(0, 3).join(' '), words.slice(0, 2).join(' ')])].filter(q => q.length >= 4)) {
      hs = { n: b.name, query: q, lat: 0, lng: 0 };
      await resolveSpecs([hs], { center, signal });
      if (hs.source === 'geocoded') break;
    }
    if (hs.source !== 'geocoded' && validLL(center)) {
      const wide = { n: b.name, query: b.name, lat: center[0], lng: center[1] };
      await resolveSpecs([wide], { center, signal, maxKm: 200 });
      if (wide.source === 'geocoded') hs = wide;
    }
    if (validLL([hs.lat, hs.lng])) { b.lat = hs.lat; b.lng = hs.lng; }
    how.push(hs.source === 'geocoded' ? 'geocoded' : 'model');
  }
  return how;
}
/** The per-day hotel lines the model reads (TripSetup.stayPlan); [] when the stay is not booked. */
const stayPlan = setup => (setup.stay && setup.stay.mode === 'booked'
  ? Array.from({ length: setup.days }, (_, i) => stayLine(setup, i)).map((l, i) => l && `วัน ${i + 1}: ${l.replace(/^ที่พัก: /, '')}`).filter(Boolean) : []);
const stayRole = (setup, i, n) => {
  const ds = dayStays(setup)[i] || {};
  if (i === 0 && n === 1) return 'วันเดียวของทริป: เริ่มที่จุดมาถึง จบที่จุดเดินทางกลับ';
  if (i === 0) return `วันแรก: เริ่มด้วยจุดมาถึงตาม arrive (ถ้าขับรถ เริ่มที่บ้าน) แล้วไปฝากกระเป๋า/เช็กอินที่${ds.end ? ` ${ds.end.name}` : 'พัก'} จบวันที่${ds.end ? ` ${ds.end.name}` : 'ที่พัก'}`;
  if (i === n - 1) return `วันสุดท้าย: เริ่มที่${ds.start ? ` ${ds.start.name}` : 'ที่พัก'} (เช็กเอาต์) จบด้วยจุดเดินทางกลับตาม depart (สนามบิน/สถานี หรือถึงบ้านถ้าขับรถ)`;
  if (ds.move) return `วันย้ายที่พัก: เริ่มวันที่ ${ds.start.name} (เช็กเอาต์ ใส่ note เรื่องขนกระเป๋า) เที่ยวระหว่างทาง แล้วเช็กอินและจบวันที่ ${ds.end.name}`;
  if (ds.end) return `เริ่มวันที่ ${ds.end.name} และจบวันที่ ${ds.end.name}`;
  return 'เริ่มวันที่ที่พัก และจบวันที่ที่พัก';
};
const pinPicks = (specs, setup) => {
  if (setup.picks) for (const sp of specs) { const pk = setup.picks.must.find(x => x.ll && matchesPick({ n: sp.n, query: sp.query, ll: [sp.lat, sp.lng] }, x)); if (pk) { sp.lat = pk.ll[0]; sp.lng = pk.ll[1]; sp.catalog = ''; sp.pinned = true; } }
};

/**
 * Long trips: one small skeleton call (themes, areas, hotel, wishes per day), then one call per day in parallel
 * (DAY_CONCURRENCY at a time, 2 searches each). Each finished day is geocoded, routed, scheduled and streamed as
 * { type:'day', index, day, routes }. Returns the same shape as llm.design().
 */
async function splitDesign({ llm, setup, loc, center, send, say, signal, usage, timing, log, startedAt = Date.now() }) {
  const n = setup.days;
  let t = Date.now();
  say(`วางโครงทริป ${n} วัน`);
  const auto = !setup.stay || setup.stay.mode !== 'booked';
  const skPrompt = `วางโครงทริปนี้ก่อน (ยังไม่ต้องลงรายละเอียดเวลา): ธีมและย่านของแต่ละวัน ${auto ? 'ที่พักหนึ่งแห่ง (ของจริง)' : 'ที่พักตามที่จองไว้ (TripSetup.stayPlan บอกว่าแต่ละวันเริ่มและจบที่ไหน ย่านของแต่ละวันควรอยู่ใกล้ที่พักของวันนั้น)'} ` +
    `วันที่ใช้ทำความต้องการของสมาชิกแต่ละคน (wishes = id สมาชิก) มื้อของแต่ละวันโดยย่อ และชื่อสถานที่หลัก 3-6 แห่งต่อวัน ห้ามซ้ำกันข้ามวัน ` +
    `days ต้องมี ${n} รายการ\n\nTripSetup:\n${JSON.stringify(setup, null, 1)}`;
  const { json: sk, seenUrls: skUrls } = await llm.skeleton({ prompt: skPrompt, searchCap: auto ? 1 : 0, loc, signal, usage, onStep: say });
  timing.skeleton = Date.now() - t;
  const skDays = (sk.days || []).slice(0, n);
  while (skDays.length < n) skDays.push({ theme: 'วันว่าง', area: setup.city, wishes: [], meals: '', places: [] });
  say(`โครงทริป: ${skDays.map((d, i) => `วัน ${i + 1} ${s(d.theme, 30)}`).join(' · ')}`);

  const minBudget = Math.min(...setup.members.map(m => m.budget || Infinity));
  const minWalk = Math.min(...setup.members.map(m => m.maxWalkKm || Infinity));
  const ex0 = sk.stay && Array.isArray(sk.stay.examples) && sk.stay.examples[0];
  const stays = auto ? [] : setup.stay.stays, b0 = stays[0];
  const hotel = b0 && validLL([b0.lat, b0.lng]) ? { name: b0.name, query: b0.name, lat: b0.lat, lng: b0.lng, costPerPerson: (sk.hotel && sk.hotel.costPerPerson) || 0 }
    : ex0 && validLL([ex0.lat, ex0.lng]) ? { name: ex0.name, query: ex0.query || ex0.name, lat: ex0.lat, lng: ex0.lng, costPerPerson: (sk.hotel && sk.hotel.costPerPerson) || 0 }
    : (sk.hotel || {});
  if (!auto) say(`ที่พัก: ${stays.map(b => `${b.name}${stays.length > 1 ? ` ${b.nights} คืน` : ''}`).join(' → ')} (จองไว้แล้ว)`);
  else if (sk.stay && sk.stay.area) say(`ที่พัก: ย่าน${s(sk.stay.area, 40)} · ${hotel.name || ''}`);
  // Booked: the hotels day i uses, and the day each is first checked into (its cost goes there).
  const ds = dayStays(setup);
  const firstIn = b => ds.findIndex(d => d.end === b);
  const hotelLines = i => {
    if (auto) return `ที่พัก (ใช้ชื่อและพิกัดนี้ทุกครั้ง, k "stay"): ${hotel.name || '-'} · query "${hotel.query || ''}" · ${hotel.lat},${hotel.lng}` +
      (i === 0 ? ` · cost ของการไปที่พักครั้งแรก = ${hotel.costPerPerson || 0} บาท/คน (ทั้งทริป)` : ' · cost 0');
    let hs = [...new Set([ds[i].start, ds[i].end])].filter(Boolean);
    if (!hs.length) hs = stays;
    return hs.map(b => `ที่พัก (ใช้ชื่อและพิกัดนี้ทุกครั้ง, k "stay"): ${b.name} · query "${b.name}" · ${b.lat ?? ''},${b.lng ?? ''}` +
      (firstIn(b) === i ? (stays.length === 1 ? ` · cost ของการไปที่พักครั้งแรก = ${hotel.costPerPerson || 0} บาท/คน (ทั้งทริป)` : ` · cost ของการไปที่พักนี้ครั้งแรก = ส่วนแบ่งต่อคนของ ${b.nights} คืน (ราคาต่อคืน × ${b.nights} ÷ 2 คนต่อห้อง)`) : ' · cost 0')).join('\n') +
      (stayLine(setup, i) ? `\n${stayLine(setup, i)}` : '');
  };
  const out = new Array(n), seenUrls = new Map(skUrls || []);
  let firstShown = 0;
  t = Date.now();
  await pool(skDays.map((d, i) => i), DAY_CONCURRENCY, async i => {
    const d = skDays[i];
    const others = skDays.flatMap((x, k) => k === i ? [] : (x.places || []).map(p => `${p} (วัน ${k + 1})`));
    const role = stayRole(setup, i, n);
    const prompt = `ออกแบบเฉพาะวันที่ ${i + 1} จาก ${n} (${dayLabel(setup.startDate, i).label}) ของทริปนี้ ตอบเป็น stops ของวันนี้วันเดียว\n` +
      `${role}\nธีม: ${d.theme} · ย่าน: ${d.area} · มื้อ: ${d.meals || 'กลางวันและเย็น'}\nสถานที่หลักที่วางไว้: ${(d.places || []).join(', ') || '-'}\n` +
      `ความต้องการที่ต้องทำวันนี้ (star = id สมาชิก): ${(d.wishes || []).join(', ') || '-'}\n` +
      hotelLines(i) + '\n' +
      (Number.isFinite(minBudget) ? `งบต่อวันโดยประมาณ ${Math.round((minBudget - (hotel.costPerPerson || 0)) / n)} บาท/คน (ไม่รวมที่พัก)\n` : '') +
      (Number.isFinite(minWalk) ? `เดินรวมวันนี้ไม่เกิน ${minWalk} กม.\n` : '') +
      `ห้ามใช้สถานที่ที่วันอื่นใช้แล้ว: ${others.join(', ') || '-'}\n` +
      `id ของจุดให้ขึ้นต้นด้วย "d${i + 1}_"\n\nTripSetup:\n${JSON.stringify(setup, null, 1)}`;
    const r = await llm.designDay({ prompt, searchCap: 2, loc, signal, usage, onStep: say, tag: `day${i + 1}` });
    for (const [u, ti] of r.seenUrls || []) seenUrls.set(u, ti);
    const stops = (r.json.stops || []).map(sp => ({ ...sp, id: String(sp.id || '').startsWith(`d${i + 1}_`) ? sp.id : `d${i + 1}_${sp.id || 'stop'}` }));
    out[i] = { stops };
    // Stream this day: geocode, route, schedule it alone.
    try {
      pinPicks(stops, setup); pinStay(stops, setup, i); anchorStays(stops, setup, i);
      await resolveSpecs(stops, { center, signal });
      const tmp = buildPlan(Array.from({ length: n }, (_, k) => (k === i ? out[i] : { stops: [] })), setup);
      fixCoords(tmp, center, log);
      verifySrc([tmp], seenUrls);
      const rr = await routePlans([tmp], { signal });
      schedule(tmp, rr.routes); priceLegs(tmp, setup.members.length);
      if (!firstShown) { firstShown = Date.now(); timing.firstDay = firstShown - startedAt; }
      send && send({ type: 'day', index: i, day: tmp.days[i], routes: geomOnly(rr.routes) });
      say(`วันที่ ${i + 1} พร้อมแล้ว (${tmp.days[i].stops.length} จุด)`);
    } catch (e) { if (signal?.aborted) throw e; log.warn(`[bop] stream day ${i + 1} failed:`, e.message); }
  });
  timing.days = Date.now() - t;
  // Dedupe across days: the same non-hotel place on two days is reported to the repair round.
  const dupes = [];
  const seenPlace = new Map();
  out.forEach((d, i) => d.stops.forEach(sp => {
    if (sp.k === 'stay' || sp.k === 'transit') return;
    const key = sp.catalog || compactName(sp.query || sp.n);
    if (!key) return;
    if (seenPlace.has(key) && seenPlace.get(key) !== i) dupes.push(`"${sp.n}" ซ้ำในวันที่ ${seenPlace.get(key) + 1} และ ${i + 1} (id ${sp.id})`);
    else seenPlace.set(key, i);
  }));
  const userMsg = `TripSetup:\n${JSON.stringify(setup, null, 1)}\n\nโครงทริป:\n${JSON.stringify(sk, null, 1)}`;
  return { json: { summary: sk.summary, arrival: sk.arrival, stay: sk.stay, days: out }, messages: [{ role: 'user', content: userMsg }], tools: undefined, seenUrls, dupes, split: true };
}
/** plan.flags.stay = { area, why, booked?, examples:[{ name, priceNight, src:{url,title}, checked, ll? }] }; web only when the URL came from search. */
function stayFlag(st, setup, seenUrls) {
  const seen = new Set([...(seenUrls || new Map()).keys()].map(normUrl));
  const booked = setup.stay && setup.stay.mode === 'booked';
  const examples = (st && Array.isArray(st.examples) ? st.examples : []).filter(e => e && s(e.name)).slice(0, 3).map(e => {
    const sourceUrl = normalizeHttpsUrl(e.srcUrl || '');
    const web = e.checked === 'web' && sourceUrl && seen.has(normUrl(sourceUrl));
    const x = { name: s(e.name, 120), priceNight: num(e.priceNight) > 0 ? Math.round(e.priceNight) : null, src: web ? { url: sourceUrl, title: s(e.srcTitle, 160) || sourceUrl } : { url: '', title: '' }, checked: web ? 'web' : 'estimate' };
    if (validLL([e.lat, e.lng])) x.ll = [+e.lat, +e.lng];
    return x;
  });
  if (booked) {
    // One entry per booked stay, in trip order, with its nights and check-in/check-out dates.
    let night = 0;
    const stays = setup.stay.stays.map((x, k) => {
      const ex = examples.find(e => sameName(e.name, x.name)) || (k === 0 && setup.stay.stays.length === 1 ? examples[0] : null);
      const b = { name: x.name, nights: x.nights, checkIn: dayLabel(setup.startDate, night).date, checkOut: dayLabel(setup.startDate, night + x.nights).date,
        priceNight: ex ? ex.priceNight : null, src: { url: '', title: '' }, checked: 'estimate' };
      if (validLL([x.lat, x.lng])) b.ll = [x.lat, x.lng];
      night += x.nights;
      return b;
    });
    return { area: s(st && st.area, 80), why: 'ที่พักที่จองไว้แล้ว', booked: true, name: stays[0].name, examples: stays.map(({ nights, checkIn, checkOut, ...b }) => b), stays };
  }
  return { area: s(st && st.area, 80), why: s(st && st.why, 300), examples };
}
const compactName = x => foldName(x).replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '');

export async function runPlan({ setup: raw, llm, emit, send, signal, log = console }) {
  const T = Date.now(), usage = {}, timing = {};
  const setup = normalizeSetup(raw);
  const m = setup.members;
  const tags = [m.filter(x => x.avoid).length && `แพ้/ไม่ทาน ${m.filter(x => x.avoid).length}`, m.filter(x => x.maxWalkKm).length && `จำกัดการเดิน ${m.filter(x => x.maxWalkKm).length}`,
    m.filter(x => x.budget).length && `มีงบ ${m.filter(x => x.budget).length}`, m.filter(x => x.wants).length && `มีที่อยากไป ${m.filter(x => x.wants).length}`].filter(Boolean);
  emit(`อ่านความต้องการของ ${m.length} คน${tags.length ? ` · ${tags.join(' · ')}` : ''}`);
  const cityP = cityInfo(setup.country ? `${setup.city}, ${setup.country}` : setup.city, signal);
  const centerP = cityP.then(c => c && c.ll);
  const city = await cityP;
  const loc = city ? { cc: city.cc, name: city.name } : null;
  const intl = !!(city && city.cc && city.cc !== 'TH');
  // Find flights/trains/buses when the user gave no time (both directions in parallel), then plan around the chosen ones.
  const transport = {};
  const wasUndecided = (setup.arrive && setup.arrive.by === 'undecided') || (setup.depart && setup.depart.by === 'undecided');
  // A row the user already picked wins; otherwise search when auto is set or no time was given.
  for (const [dir, key] of [['go', 'arrive'], ['back', 'depart']]) {
    const l = setup[key], c = l && l.choice;
    if (!c) continue;
    transport[dir] = { chosen: c.id, options: [c] };
    setup[key] = dir === 'go' ? { by: c.by, from: c.from || l.from, time: c.arr } : { by: c.by, to: c.to || l.to, time: c.dep };
    emit(`ใช้${dir === 'go' ? 'ขาไป' : 'ขากลับ'}ที่เลือกไว้: ${c.carrier}${c.code ? ' ' + c.code : ''} ${c.dep} → ${c.arr}`);
  }
  const needT = l => l && !l.choice && (l.auto || !l.time) && ['flight', 'bus', 'train', 'undecided'].includes(l.by);
  // Transport search runs in parallel with the design call (it took ~35 s before design, pushing plans past 2 min).
  // The design sees placeholder times; the chosen times are applied to the first/last stop afterwards.
  const searching = [['go', setup.arrive], ['back', setup.depart]].filter(([dir, l]) => !transport[dir] && needT(l));
  const designSetup = clone(setup);
  for (const [dir] of searching) {
    if (dir === 'go') designSetup.arrive = { ...designSetup.arrive, time: '10:00' }; else designSetup.depart = { ...designSetup.depart, time: '20:30' };
  }
  if (searching.length) designSetup.extra = `${designSetup.extra ? designSetup.extra + '\n' : ''}เวลาเดินทาง${searching.map(([d]) => d === 'go' ? 'ขาไป' : 'ขากลับ').join('/')}ยังค้นอยู่ ใช้เวลาประมาณที่ให้ไว้ เซิร์ฟเวอร์จะปรับจุดแรก/จุดสุดท้ายตามเที่ยวที่เลือก`;
  const transportP = Promise.all(searching.map(async ([dir, l]) => {
    try {
      const options = await searchTransport({ setup, dir, llm, emit, signal, usage, loc });
      // The plan was designed around arrive ~10:00 / leave ~20:30: prefer the recommended option if it fits that window,
      // else the best-fitting web-checked one, so the repair round is not left fixing a 19:00 flight.
      const fits = o => dir === 'go' ? toM(o.arr) >= toM('07:00') && toM(o.arr) <= toM('12:00') : toM(o.dep) >= toM('19:30') && toM(o.dep) <= toM('23:00');
      let chosen = options.find(o => o.recommended);
      if (chosen && !fits(chosen)) {
        const rank = o => o.checked === 'live' ? 2 : o.checked === 'web' ? 1 : 0;
        const alt = options.filter(fits).sort((x, y) => rank(y) - rank(x) || (x.price ?? 1e9) - (y.price ?? 1e9))[0];
        if (alt) { delete chosen.recommended; alt.recommended = true; alt.why = `${dir === 'go' ? 'ถึงก่อนเที่ยง' : 'ออกหลังมื้อเย็น'} เข้ากับแผน (${alt.checked === 'live' ? 'ราคาสด จองได้' : 'ราคาประมาณจากเว็บ'})`; chosen = alt; }
      }
      if (!chosen) { emit(`ไม่พบ${KIND_TH[l.by]}${dir === 'go' ? 'ขาไป' : 'ขากลับ'} Bop กำหนดเวลาเอง`); return; }
      transport[dir] = { chosen: chosen.id, options };
      emit(`เลือก${dir === 'go' ? 'ขาไป' : 'ขากลับ'}: ${chosen.carrier}${chosen.code ? ' ' + chosen.code : ''} ${chosen.from} ${chosen.dep} → ${chosen.to} ${chosen.arr}${chosen.price ? ` ~฿${chosen.price}/คน` : ''}`);
      if (dir === 'go') setup.arrive = { by: chosen.by, from: chosen.from || l.from, time: chosen.arr };
      else setup.depart = { by: chosen.by, to: chosen.to || l.to, time: chosen.dep };
    } catch (e) {
      if (e instanceof AgentError && (e.code === 'auth' || e.code === 'rate_limit')) throw e;
      log.warn(`[bop] transport ${dir} failed:`, e.message);
      emit(`หา${KIND_TH[l.by] || 'การเดินทาง'}${dir === 'go' ? 'ขาไป' : 'ขากลับ'}ไม่สำเร็จ ใช้เวลาประมาณ`);
    }
  }));
  transportP.catch(() => {}); // awaited below; avoid an unhandled rejection if design fails first
  const undecided = (designSetup.arrive && designSetup.arrive.by === 'undecided') || (designSetup.depart && designSetup.depart.by === 'undecided');
  const searchCap = SEARCH_PLAN <= 0 ? 0 : Math.min(8, SEARCH_PLAN + (intl ? 3 : 0) + (undecided ? 2 : 0));

  if (setup.stay && setup.stay.mode === 'booked') {
    const how = await geocodeStays(setup.stay.stays, { center: await centerP, signal });
    designSetup.stay = clone(setup.stay);
    designSetup.stayPlan = stayPlan(setup);
    const one = setup.stay.stays.length === 1;
    emit(`ที่พักที่จองไว้: ${setup.stay.stays.map((b, k) => `${b.name}${one ? '' : ` ${b.nights} คืน`}${how[k] === 'model' ? ' · ใช้พิกัดประมาณ' : one ? ' · พบบนแผนที่' : ''}`).join(' → ')}`);
  }
  emit(`Bop ออกแบบแผน ${setup.days} วันใน${setup.city}`);
  const T0 = Date.now();
  let t = Date.now();
  // Heartbeat: the design call can run 60-90 s with long silent stretches; keep the trace alive.
  let last = Date.now(); const say = x => { last = Date.now(); emit(x); };
  const beats = ['Bop กำลังเลือกสถานที่และจัดลำดับ', 'Bop กำลังจัดเวลาให้ทันเวลาเปิด–ปิด', 'Bop กำลังคุมงบและระยะเดิน', 'Bop กำลังเขียนแผนฉบับเต็ม'];
  let bi = 0; const hb = setInterval(() => {
    if (Date.now() - last <= 15000) return;
    say(bi < beats.length ? beats[bi++] : `Bop ยังเขียนแผน ${setup.days} วันอยู่ (${Math.round((Date.now() - T0) / 1000)} วินาที)`);
  }, 5000);
  let design;
  const split = setup.days >= SPLIT_MIN_DAYS && llm.skeleton && llm.designDay;
  try {
    design = split
      ? await splitDesign({ llm, setup: designSetup, loc, center: await centerP, send, say, signal, usage, timing, log, startedAt: T })
      : await llm.design({ setup: designSetup, loc, searchCap, signal, usage, onStep: say, onDay: n => n <= setup.days && say(`ร่างวันที่ ${n} จาก ${setup.days}`) });
  } finally { clearInterval(hb); }
  const { json, messages, tools, seenUrls = new Map() } = design;
  timing.design = Date.now() - t;
  const days = json.days.slice(0, setup.days);
  if (days.length < setup.days) log.warn(`[bop] plan: model returned ${days.length}/${setup.days} days`);

  t = Date.now();
  // Places the group picked keep the coordinates they were shown with; booked hotels pin each day's start/end.
  days.forEach((d, i) => { d.stops = d.stops || []; pinPicks(d.stops, setup); pinStay(d.stops, setup, i); anchorStays(d.stops, setup, i); });
  const specs = days.flatMap(d => d.stops);
  const uniq = new Set(specs.map(x => x.catalog || x.query || x.n)).size;
  const by = await resolveSpecs(specs, { center: await centerP, signal });
  emit(geoLine(by, uniq));
  timing.geocode = Date.now() - t;

  await transportP;
  timing.transportWait = Date.now() - T0 - timing.design;
  let plan = buildPlan(days, setup);
  if (transport.go || transport.back) {
    plan.flags.transport = transport;
    for (const dir of ['go', 'back']) if (transport[dir]) {
      const c = transport[dir].options.find(o => o.id === transport[dir].chosen);
      retimeEnd(plan, dir, c);
    }
  }
  if (wasUndecided && (transport.go || transport.back)) {
    const c = transport.go ? transport.go.options.find(o => o.id === transport.go.chosen) : transport.back.options.find(o => o.id === transport.back.chosen);
    plan.flags.arrivalSuggested = { by: c.by, why: c.why || '' };
  }
  if (undecided && !plan.flags.arrivalSuggested && json.arrival && json.arrival.by && json.arrival.by !== 'none') {
    plan.flags.arrivalSuggested = { by: json.arrival.by, why: s(json.arrival.why, 300) };
    emit(`เสนอวิธีเดินทาง: ${s(json.arrival.why, 120) || json.arrival.by}`);
  }
  plan.flags.stay = stayFlag(json.stay, setup, seenUrls);
  const center = await centerP;
  fixCoords(plan, center, log);
  const vs = verifySrc([plan], seenUrls);
  if (seenUrls.size || vs.web) emit(`ตรวจจากเว็บ ${vs.web} จุด · ประมาณการ ${vs.est} จุด`);
  t = Date.now();
  let routes = await finalize([plan], setup, { signal, emit });
  timing.route = Date.now() - t;
  let ck = checks(plan, setup);
  emit(`ตรวจเงื่อนไข: ${ckLine(ck)}`);
  let pi = pickIssues(plan, setup.picks);
  if (design.dupes && design.dupes.length) { pi = { ...pi, lines: [...pi.lines, ...design.dupes] }; emit(`พบสถานที่ซ้ำข้ามวัน ${design.dupes.length} แห่ง`); }
  if (setup.picks && setup.picks.must.length) emit(`ใส่ที่ที่กลุ่มเลือก ${pi.placed}/${setup.picks.must.length} แห่ง`);

  let repaired = false;
  if (ck.pass < ck.list.length || pi.lines.length) {
    const nd = (design.dupes || []).length, np = pi.lines.length - nd;
    const bad = [...ck.list.filter(x => !x.ok).map(x => x.who ? `${x.l} (${x.who})` : x.l), ...(np ? [`ที่ที่กลุ่มเลือก ${np} รายการ`] : []), ...(nd ? [`สถานที่ซ้ำ ${nd} แห่ง`] : [])];
    emit(`ซ่อม: ${bad.join(' · ')}`);
    t = Date.now();
    try {
      const { json: fix } = await llm.repair({ messages, tools, report: report(plan, setup, pi.lines, design.split ? failingDays(plan, setup, pi.lines) : null), signal, usage, onStep: emit, seenUrls });
      const edits = cleanEdits(fix.fixes.flatMap(f => f.edits || []));
      const nspecs = specsOfEdits(edits);
      if (nspecs.length) await resolveSpecs(nspecs, { center: await centerP, signal });
      const r = applyEdits(plan, edits, setup);
      if (r.errors.length) log.warn('[bop] plan repair edit errors:', r.errors);
      const cand = r.plan;
      fixCoords(cand, center, log);
      verifySrc([cand], seenUrls, new Set(edits.filter(e => e.stop).map(e => e.stop.id)));
      const routes2 = await finalize([cand], setup, { signal });
      const ck2 = checks(cand, setup), pi2 = pickIssues(cand, setup.picks);
      const score = (c, p) => c.pass * 10 - p.lines.length;
      if (score(ck2, pi2) >= score(ck, pi)) { plan = cand; routes = routes2; ck = ck2; pi = pi2; repaired = r.applied.length > 0; }
      emit(`ตรวจเงื่อนไขหลังซ่อม: ${ckLine(ck2)}${setup.picks && setup.picks.must.length ? ` · ที่ที่กลุ่มเลือก ${pi2.placed}/${setup.picks.must.length}` : ''}${score(ck2, pi2) < score(ck, pi) ? ' (แย่ลง ใช้แผนเดิม)' : ''}`);
    } catch (e) {
      if (e instanceof AgentError && (e.code === 'auth' || e.code === 'rate_limit')) throw e;
      log.warn('[bop] plan repair failed:', e.message);
      emit('ซ่อมไม่สำเร็จ ใช้แผนก่อนซ่อม');
    }
    timing.repair = Date.now() - t;
  }
  plan.flags = plan.flags || {};
  const ms = Date.now() - T;
  log.info(`[bop] plan ${(ms / 1000).toFixed(1)}s ${ckLine(ck)} timing=${JSON.stringify(timing)} usage=${JSON.stringify(usage)}`);
  return { type: 'done', plan, routes: geomOnly(routes), summary: s(json.summary, 600) || `แผน ${setup.days} วัน ${ckLine(ck)}`,
    ms, usage, repaired, timing };
}

/* ---------------- /api/replan ---------------- */
export async function runReplan({ setup: raw, plan: rawPlan, command, day, llm, emit, signal, log = console }) {
  const T = Date.now(), usage = {}, timing = {};
  const setup = normalizeSetup(raw);
  if (!validPlan(rawPlan)) throw new AgentError('bad_request', 'แผนที่ส่งมาไม่ถูกต้อง');
  const cmd = s(command, 1000).trim();
  if (!cmd) throw new AgentError('bad_request', 'ไม่มีคำสั่ง');
  const base = clone(rawPlan);
  const dayIdx = Math.max(0, Math.min(base.days.length - 1, Number.isInteger(day) ? day : 0));
  emit(`อ่านคำสั่ง: “${cmd.slice(0, 80)}”`);
  emit('Bop หาส่วนที่กระทบและเสนอการแก้แบบน้อยที่สุด');
  let t = Date.now();
  const city = await cityInfo(setup.country ? `${setup.city}, ${setup.country}` : setup.city, signal);
  const loc = city ? { cc: city.cc, name: city.name } : null;
  // Booked stays: coordinates from the plan's hotel stops (else the geocoder), and the per-day start/end hotel for the model.
  const booked = setup.stay && setup.stay.mode === 'booked';
  if (booked) await geocodeStays(setup.stay.stays, { center: city && city.ll, signal, known: base.days.flatMap(d => d.stops) });
  const askSetup = booked ? { ...setup, stayPlan: stayPlan(setup) } : setup;
  const { json, messages, tools, seenUrls = new Map() } = await llm.replan({ setup: askSetup, loc, brief: planBrief(base, setup) + transportBrief(base), command: cmd, day: dayIdx, signal, usage, onStep: emit });
  timing.replan = Date.now() - t;

  let opts = json.options.slice(0, 3).map((o, i) => ({ ...o, key: ['A', 'B', 'C'][i], edits: cleanEdits(o.edits) }));
  const needsVote = !!json.needs_vote && opts.length > 1;
  if (!needsVote) opts = opts.slice(0, 1);
  emit(needsVote ? `มี ${opts.length} ทางเลือกที่ต้องให้กลุ่มโหวต` : 'มีทางแก้เดียว ไม่ต้องโหวต');

  t = Date.now();
  const center = city && city.ll;
  if (booked) opts.forEach(o => pinEditStays(o.edits, base, setup));
  const nspecs = opts.flatMap(o => specsOfEdits(o.edits));
  if (nspecs.length) {
    const by = await resolveSpecs(nspecs, { center, signal });
    emit(geoLine(by, new Set(nspecs.map(x => x.catalog || x.query || x.n)).size).replace('หาพิกัดสถานที่', 'หาพิกัดสถานที่ใหม่'));
  }
  timing.geocode = Date.now() - t;

  const baseCk = checks(base, setup);
  const baseFail = new Set(baseCk.list.filter(x => !x.ok).map(x => x.l));
  const build = (o, edits, from) => { const r = applyEdits(from, edits, setup); o.plan = r.plan; o.editErrors = r.errors; };
  opts.forEach(o => build(o, o.edits, base));
  opts.forEach(o => fixCoords(o.plan, city && city.ll, log));
  // A changed flight/train/bus: update flags.transport + first/last stop, and use the new times for checks.
  const tc = json.transport && ['go', 'back'].includes(json.transport.dir) ? json.transport : null;
  let setupOut = null;
  if (tc) {
    for (const o of opts) applyTransportChange(o.plan, tc);
    const c = opts[0].plan.flags.transport[tc.dir], ch = c.options.find(x => x.id === c.chosen);
    if (tc.dir === 'go') setup.arrive = { ...(setup.arrive || {}), by: ch.by, from: ch.from || (setup.arrive && setup.arrive.from) || '', time: ch.arr };
    else setup.depart = { ...(setup.depart || {}), by: ch.by, to: ch.to || (setup.depart && setup.depart.to) || '', time: ch.dep };
    delete (tc.dir === 'go' ? setup.arrive : setup.depart).choice;
    setupOut = setup;
    emit(`เปลี่ยน${tc.dir === 'go' ? 'ขาไป' : 'ขากลับ'}เป็น ${ch.carrier}${ch.code ? ' ' + ch.code : ''} ${ch.dep} → ${ch.arr}`);
  }
  const newIds = () => new Set(opts.flatMap(o => o.plan.days.flatMap(d => d.stops.map(x => x.id))).filter(id => !base.days.some(d => d.stops.some(x => x.id === id))));
  verifySrc(opts.map(o => o.plan), seenUrls, newIds());
  t = Date.now();
  let routes = await finalize(opts.map(o => o.plan), setup, { signal, emit });
  timing.route = Date.now() - t;

  // Which failures need a repair: edit errors, new system-rule failures, and (without a vote) new member failures.
  const problems = o => {
    const ck = checks(o.plan, setup); o.ck = ck;
    const fresh = ck.list.filter(x => !x.ok && !baseFail.has(x.l));
    return [...o.editErrors.map(e => `edit ผิด: ${e}`), ...fresh.filter(x => !x.who || !needsVote).map(x => x.who ? `${x.l} (${x.who})` : x.l)];
  };
  const dcost = o => o.ck.total - baseCk.total;
  let todo = opts.map(o => ({ o, p: problems(o) })).filter(x => x.p.length);
  opts.forEach(o => emit(`ทางเลือก ${o.key}: ตรวจเงื่อนไข ${ckLine(o.ck)} · ${sbaht(dcost(o))}/คน`));

  let repaired = false;
  if (todo.length) {
    emit(`ซ่อม: ${todo.map(x => `${x.o.key} → ${x.p.join(' · ')}`).join(' | ')}`);
    t = Date.now();
    try {
      const rep = todo.map(x => `## ทางเลือก ${x.o.key}\nปัญหา: ${x.p.join('; ')}\n${report(x.o.plan, setup)}`).join('\n\n');
      const { json: fix } = await llm.repair({ messages, tools, report: rep, signal, usage, onStep: emit, seenUrls });
      const fixed = [];
      for (const f of fix.fixes || []) {
        const o = opts.find(x => x.key === f.key); if (!o) continue;
        const edits = cleanEdits(f.edits);
        if (booked) pinEditStays(edits, o.plan, setup);
        const sp = specsOfEdits(edits); if (sp.length) await resolveSpecs(sp, { center, signal });
        const before = { plan: o.plan, ck: o.ck, editErrors: o.editErrors };
        build(o, edits, o.plan);
        fixed.push({ o, before });
      }
      if (fixed.length) {
        verifySrc(fixed.map(x => x.o.plan), seenUrls, newIds());
        const r2 = await finalize(fixed.map(x => x.o.plan), setup, { signal });
        routes = { ...routes, ...r2 };
        for (const { o, before } of fixed) {
          const ck2 = checks(o.plan, setup);
          if (ck2.pass < before.ck.pass) Object.assign(o, before); else { o.ck = ck2; repaired = true; }
          emit(`ทางเลือก ${o.key} หลังซ่อม: ${ckLine(o.ck)} · ${sbaht(dcost(o))}/คน`);
        }
      }
    } catch (e) {
      if (e instanceof AgentError && (e.code === 'auth' || e.code === 'rate_limit')) throw e;
      log.warn('[bop] replan repair failed:', e.message);
      emit('ซ่อมไม่สำเร็จ ส่งทางเลือกก่อนซ่อม');
    }
    timing.repair = Date.now() - t;
  }

  const used = {};
  const legKeys = new Set();
  for (const o of opts) for (const l of allLegs(o.plan)) legKeys.add(legKey(l.a, l.b, l.m));
  for (const k of legKeys) if (routes[k]) used[k] = routes[k];
  const ms = Date.now() - T;
  log.info(`[bop] replan ${(ms / 1000).toFixed(1)}s options=${opts.map(o => o.key + ':' + ckLine(o.ck)).join(',')} timing=${JSON.stringify(timing)} usage=${JSON.stringify(usage)}`);
  return {
    type: 'done', summary: s(json.summary, 600), day: Math.max(0, Math.min(base.days.length - 1, json.day | 0)),
    needs_vote: needsVote, ...(needsVote ? { vote_reason: s(json.vote_reason, 400) } : {}),
    options: opts.map(o => ({ key: o.key, title: s(o.title, 120), head: s(o.head, 200), line: s(o.line, 800), plan: o.plan })),
    routes: geomOnly(used), ms, repaired, usage, timing, ...(setupOut ? { setup: setupOut } : {}),
  };
}

/* ---------------- /api/place-info ---------------- */
const PLACE_CACHE = new Map();
export async function runPlaceInfo({ city, stop, llm, emit, signal, log = console }) {
  const T = Date.now();
  if (!stop || typeof stop.id !== 'string' || !s(stop.n)) throw new AgentError('bad_request', 'ไม่มีข้อมูลสถานที่ (stop.id, stop.n)');
  const key = `${stop.id}|${stop.n}`;
  if (PLACE_CACHE.has(key)) {
    emit('ใช้ข้อมูลที่ค้นไว้แล้ว');
    return { type: 'done', info: await PLACE_CACHE.get(key), ms: Date.now() - T, cached: true };
  }
  const ll = validLL(stop.ll) ? stop.ll.slice(0, 2).map(Number) : null;
  const query = s(stop.query, 120) || s(stop.place && stop.place.query, 120) || '';
  const aliases = [...(Array.isArray(stop.aliases) ? stop.aliases : []), ...(stop.place && Array.isArray(stop.place.aliases) ? stop.place.aliases : [])].map(a => s(a, 80)).filter(Boolean).slice(0, 8);
  const st = { id: stop.id, n: s(stop.n, 120), k: s(stop.k, 20) || 'sight', ll, note: s(stop.note, 300), query };
  emit(`ค้นข้อมูล ${st.n}`);
  const usage = {};
  const p = (async () => {
    // Wikimedia photos run in parallel with the model's web research.
    const wikiP = wikiPhotos({ name: st.n, query, aliases, ll, kind: st.k, signal }).catch(() => []);
    const ci = await cityInfo(s(city, 60) || 'เชียงใหม่', signal);
    const { json, results, cited } = await llm.research({ city: s(city, 60) || 'เชียงใหม่', loc: ci ? { cc: ci.cc, name: ci.name } : null, stop: st, signal, usage, onStep: emit });
    const info = normalizeInfo(json, results, cited);
    const wiki = await wikiP;
    if (wiki.length) emit(`ได้รูปที่ตรงสถานที่จาก Wikimedia ${wiki.length} รูป`);
    info.photos = await photosFor({ name: st.n, query, aliases, ll, kind: st.k, photoPage: info._photoPage, pages: info.sources.map(x => x.url), signal, wiki, limit: 4 });
    delete info._photoPage;
    return info;
  })();
  PLACE_CACHE.set(key, p);
  try {
    const info = await p;
    emit(info.confidence === 'web' ? `ได้ข้อมูลจาก ${info.sources.length} แหล่ง${info.dishes.length ? ` · เมนู ${info.dishes.length} รายการ` : ''} · รูป ${info.photos.length} รูป` : `ไม่พบข้อมูลที่เชื่อถือได้ ใช้ข้อมูลประมาณ · รูป ${info.photos.length} รูป`);
    const ms = Date.now() - T;
    log.info(`[bop] place-info ${(ms / 1000).toFixed(1)}s ${st.n} conf=${info.confidence} usage=${JSON.stringify(usage)}`);
    return { type: 'done', info, ms, usage };
  } catch (e) { PLACE_CACHE.delete(key); throw e; }
}

export function normalizeInfo(j, results = new Map(), cited = new Map()) {
  j = j && typeof j === 'object' ? j : {};
  const known = new Map([...results, ...cited].map(([url, title]) => [normalizeHttpsUrl(url), title]).filter(([url]) => url));
  // Prices are THB. A local-currency price is converted with the model's stated rate (THB per unit); a "THB" price that is
  // really the local amount (e.g. 80000 for VND) is detected by matching priceLocal, or by size, and converted too.
  const rate = num(j.rate) > 0 ? j.rate : null;
  const toTHB = d => {
    const loc = num(d.priceLocal), cur = /^[A-Z]{3}$/.test(d.currency || '') ? d.currency : '';
    const p = num(d.price);
    if (p != null && p >= 0 && !(cur && cur !== 'THB' && rate && rate < 0.5 && (p === loc || p > 3000))) return Math.round(p);
    if (loc != null && loc >= 0) { if (!cur || cur === 'THB') return Math.round(loc); if (rate) return Math.round(loc * rate); }
    if (p != null && p > 3000 && rate && rate < 0.5) return Math.round(p * rate);
    return null; // cannot interpret
  };
  const dishes = (Array.isArray(j.dishes) ? j.dishes : []).filter(d => d && s(d.name)).slice(0, 6).map(d => {
    const o = { name: s(d.name, 80), price: toTHB(d) };
    if (num(d.priceLocal) != null && /^[A-Z]{3}$/.test(d.currency || '') && d.currency !== 'THB') o.priceLocal = { amount: d.priceLocal, currency: d.currency };
    if (typeof d.veg === 'boolean') o.veg = d.veg;
    if (s(d.why)) o.why = s(d.why, 160);
    return o;
  });
  const sources = [];
  const push = (value, title) => { const url = normalizeHttpsUrl(value); if (url && !sources.some(x => x.url === url) && sources.length < 6) sources.push({ title: s(title, 160) || url, url }); };
  for (const [url, title] of cited) push(url, title);
  for (const x of Array.isArray(j.sources) ? j.sources : []) {
    const url = normalizeHttpsUrl(x?.url || '');
    if (url && known.has(url)) push(url, x.title || known.get(url));
  }
  const d = j.details && typeof j.details === 'object' ? j.details : {};
  const details = { what: s(d.what, 400), highlights: (Array.isArray(d.highlights) ? d.highlights : []).map(x => s(x, 160)).filter(Boolean).slice(0, 5) };
  for (const k of ['price', 'hours', 'rating', 'booking', 'address']) if (s(d[k])) details[k] = s(d[k], 200);
  const info = { summary: s(j.summary, 300) || 'ยังไม่มีข้อมูล', details, dishes, sources, photos: [],
    confidence: j.confidence === 'web' && sources.length ? 'web' : 'estimate' };
  if (s(j.priceRange)) info.priceRange = s(j.priceRange, 60);
  const photoPage = normalizeHttpsUrl(j.photoPage || '');
  if (photoPage) info._photoPage = photoPage; // photo lookup only
  if (s(j.hours)) info.hours = s(j.hours, 80);
  if (s(j.phone)) info.phone = s(j.phone, 40);
  const tips = (Array.isArray(j.tips) ? j.tips : []).map(x => s(x, 200)).filter(Boolean).slice(0, 5);
  if (tips.length) info.tips = tips;
  return info;
}

export const stayInternals = { pinStay, anchorStays, stayPlan, stayRole, pinEditStays };
