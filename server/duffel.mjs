// Duffel flights: live offers for the transport picker, offer refresh with bag services, orders and cancellations.
// Enabled only when DUFFEL_ACCESS_TOKEN is set server-side (duffel_test_… = test mode, Duffel Airways, no money).
// Live tokens can search but booking stays off until BOP_FLIGHT_BOOKING=1.
// Passenger details go straight to Duffel; Bop keeps no passenger data (server/.data/orders.json holds ids and totals only).
import { createHash } from 'node:crypto';
import { AgentError } from './claude.mjs';
import { fetchJson } from './geo.mjs';
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  createOrderRecord,
  markIdempotentOperationUncertain,
  releaseIdempotentOperation,
  updateOrderRecord,
} from './state.mjs';

const API = process.env.BOP_DUFFEL_API || 'https://api.duffel.com';
const token = () => process.env.DUFFEL_ACCESS_TOKEN || '';
export const duffelEnabled = () => /^duffel_(test|live)_/.test(token());
export const duffelMode = () => (token().startsWith('duffel_live_') ? 'live' : 'test');
export const bookingEnabled = () => duffelEnabled() && (duffelMode() === 'test' || process.env.BOP_FLIGHT_BOOKING === '1');

/* ---------- HTTP with breaker and a daily search cap ---------- */
let breakUntil = 0, fails = 0, day = '', searches = 0;
const DAILY = () => Number(process.env.BOP_DUFFEL_DAILY_SEARCHES) || 200;

async function duffel(method, path, { body, timeout = 20000, signal, search = false } = {}) {
  if (!duffelEnabled()) throw new AgentError('not_enabled', 'ยังไม่ได้เชื่อมระบบจองเที่ยวบิน');
  if (Date.now() < breakUntil) throw new AgentError('upstream', 'ระบบเที่ยวบินขัดข้องชั่วคราว ลองใหม่ในอีกสักครู่');
  if (search) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; searches = 0; }
    if (++searches > DAILY()) throw new AgentError('rate_limit', 'ค้นเที่ยวบินครบโควตาของวันนี้แล้ว');
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  let r, j = null;
  try {
    r = await fetch(API + path, {
      method, signal: ctl.signal,
      headers: { Authorization: `Bearer ${token()}`, 'Duffel-Version': 'v2', Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify({ data: body }) : undefined,
    });
    try { j = await r.json(); } catch { j = null; }
  } catch (e) {
    trip(e);
    throw new AgentError('upstream', signal?.aborted ? 'ยกเลิกแล้ว' : 'ติดต่อระบบเที่ยวบินไม่ได้', e?.message);
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
  if (!r.ok) {
    const err = (j && Array.isArray(j.errors) && j.errors[0]) || {};
    if (r.status === 429 || r.status >= 500) trip(new Error(`HTTP ${r.status}`));
    const code = err.code || '';
    if (r.status === 401 || r.status === 403) throw new AgentError('auth', 'token ของระบบเที่ยวบินใช้ไม่ได้', `HTTP ${r.status} ${code}`);
    if (/offer_no_longer_available|offer_expired|expired/.test(code)) throw new AgentError('offer_expired', 'ข้อเสนอนี้หมดอายุหรือที่นั่งเต็มแล้ว ค้นใหม่อีกครั้ง', code);
    if (/price_changed|total_amount/.test(code + ' ' + (err.message || ''))) throw new AgentError('price_changed', 'ราคาเปลี่ยนแล้ว ตรวจราคาใหม่ก่อนยืนยัน', code);
    throw new AgentError(r.status === 422 || r.status === 400 ? 'bad_request' : 'upstream', `ระบบเที่ยวบินตอบกลับว่า: ${err.message || err.title || 'HTTP ' + r.status}`, `HTTP ${r.status} ${code}`);
  }
  fails = 0;
  return j && j.data;
}
function trip(e) {
  if (++fails >= 2 || /HTTP 429/.test(e?.message)) { breakUntil = Date.now() + 10 * 60_000; fails = 0; console.warn(`[bop] duffel unavailable, skipping for 10 min (${e?.message})`); }
}

/* ---------- FX: THB is canonical. Frankfurter (ECB, keyless), else a fixed table. ---------- */
const FX_FALLBACK = { USD: 33, EUR: 36, GBP: 43, JPY: 0.22, SGD: 25, AUD: 22, CNY: 4.6, HKD: 4.2, KRW: 0.024, MYR: 7.4, VND: 0.0013, TWD: 1.0 };
const fx = { at: 0, rates: {} };
export async function thbPer(cur) {
  if (!cur || cur === 'THB') return 1;
  if (Date.now() - fx.at > 12 * 3600_000) {
    try {
      const j = await fetchJson('https://api.frankfurter.dev/v1/latest?base=THB', { timeout: 5000 });
      if (j && j.rates) { fx.rates = Object.fromEntries(Object.entries(j.rates).map(([k, v]) => [k, 1 / v])); fx.at = Date.now(); }
    } catch { fx.at = Date.now() - 11 * 3600_000; /* retry in 1 h */ }
  }
  return fx.rates[cur] || FX_FALLBACK[cur] || null;
}
const toTHB = async (amount, cur) => { const r = await thbPer(cur); return r ? Math.round(+amount * r) : null; };

/* ---------- airports ---------- */
const IATA = new Map();
export async function resolveIata(text, hint, signal) {
  const t = String(text || '').trim();
  if (/^[A-Z]{3}$/.test(t)) return t;
  const m = /\b([A-Z]{3})\b/.exec(t); if (m) return m[1];
  if (/^[A-Z]{3}$/.test(hint || '')) return hint;
  if (/กรุงเทพ|bangkok/i.test(t)) return 'BKK';
  if (!t) return null;
  if (IATA.has(t)) return IATA.get(t);
  try {
    const d = await duffel('GET', `/places/suggestions?query=${encodeURIComponent(t)}`, { timeout: 8000, signal });
    const p = (d || []).find(x => x.iata_code && (x.type === 'city' || x.type === 'airport'));
    const code = p ? p.iata_city_code || p.iata_code : null;
    IATA.set(t, code); return code;
  } catch { return null; }
}

/* ---------- offers -> TransportOption ---------- */
const clock = iso => String(iso || '').slice(11, 16);
const minutes = c => { const [h, m] = c.split(':').map(Number); return h * 60 + m; };
const isoDur = d => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d || ''); return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; };
function bagText(offer) {
  const bags = offer.slices?.[0]?.segments?.[0]?.passengers?.[0]?.baggages || [];
  const checked = bags.filter(b => b.type === 'checked').reduce((a, b) => a + (b.quantity || 0), 0);
  return checked ? `รวมกระเป๋าโหลด ${checked} ใบ` : 'ถือขึ้นเครื่องเท่านั้น';
}
function condText(c) {
  if (!c) return '';
  const r = c.refund_before_departure, ch = c.change_before_departure;
  return [r ? (r.allowed ? 'คืนเงินได้' : 'คืนเงินไม่ได้') : '', ch ? (ch.allowed ? 'เปลี่ยนไฟลต์ได้' : 'เปลี่ยนไฟลต์ไม่ได้') : ''].filter(Boolean).join(' · ');
}
export async function offerToOption(o, i, dir, pax) {
  const sl = o.slices[0], segs = sl.segments || [], a = segs[0], z = segs[segs.length - 1];
  const per = +o.total_amount / Math.max(1, pax);
  const x = {
    id: `${dir}-d${i + 1}`, by: 'flight', carrier: o.owner?.name || a?.marketing_carrier?.name || 'สายการบิน',
    code: `${a?.marketing_carrier?.iata_code || ''}${a?.marketing_carrier_flight_number || ''}`,
    from: a?.origin?.iata_code || sl.origin?.iata_code || '', to: z?.destination?.iata_code || sl.destination?.iata_code || '',
    dep: clock(a?.departing_at), arr: clock(z?.arriving_at),
    price: await toTHB(per, o.total_currency),
    src: { url: '', title: 'Duffel' }, checked: 'live', bookable: true, offerId: o.id, expiresAt: o.expires_at,
    bag: [segs.length > 1 ? `ต่อเครื่อง ${segs.length - 1} ครั้ง` : 'บินตรง', bagText(o)].join(' · '),
    cond: condText(o.conditions), stops: segs.length - 1, durMin: isoDur(sl.duration),
  };
  if (o.total_currency !== 'THB') x.priceLocal = { amount: Math.round(per * 100) / 100, currency: o.total_currency };
  if (duffelMode() === 'test') x.test = true;
  return x;
}
/* plan window: arrive by late morning on day 1; leave after dinner on the last day (same as the web-search prompt) */
function fitPenalty(x, dir) {
  if (!x.dep || !x.arr) return 999;
  if (dir === 'go') { const a = minutes(x.arr); return a <= 12 * 60 ? Math.max(0, 8 * 60 - a) / 6 : (a - 12 * 60) / 2; }
  const d = minutes(x.dep); return d >= 18 * 60 && d <= 22 * 60 ? 0 : d < 18 * 60 ? (18 * 60 - d) / 2 : (d - 22 * 60) / 3;
}

/**
 * Live flight options for one direction. Returns [] (never throws) when Duffel is off, fails, or has no offers,
 * so the caller can fall back to web search.
 */
export async function searchFlights({ setup, dir, signal, emit = () => {}, log = console }) {
  if (!duffelEnabled()) return [];
  const go = dir === 'go', leg = go ? setup.arrive : setup.depart;
  if (!leg || !['flight', 'undecided'].includes(leg.by)) return [];
  const date = (() => { const d = new Date((setup.startDate || '') + 'T00:00:00Z'); if (isNaN(d)) return null; if (!go) d.setUTCDate(d.getUTCDate() + (setup.days || 1) - 1); return d.toISOString().slice(0, 10); })();
  if (!date) return [];
  try {
    const home = await resolveIata(go ? leg.from : leg.to, null, signal);
    const dest = await resolveIata(setup.city, setup.cityAirport, signal);
    if (!home || !dest || home === dest) { log.warn?.(`[bop] duffel: no airport pair (${home} / ${dest})`); return []; }
    const [origin, destination] = go ? [home, dest] : [dest, home];
    const pax = Math.max(1, (setup.members || []).length);
    emit(`ค้นเที่ยวบินราคาสด ${origin} → ${destination} ${date}`);
    const d = await duffel('POST', '/air/offer_requests?return_offers=true&supplier_timeout=15000', {
      search: true, signal, timeout: 25000,
      body: { slices: [{ origin, destination, departure_date: date }], passengers: Array.from({ length: pax }, () => ({ type: 'adult' })), cabin_class: 'economy', max_connections: 1 },
    });
    const offers = (d && d.offers || []).filter(o => o.slices?.length === 1 && o.slices[0].segments?.length);
    if (!offers.length) { emit('ระบบเที่ยวบินไม่มีข้อเสนอสำหรับเส้นทางนี้'); return []; }
    const opts = await Promise.all(offers.slice(0, 60).map((o, i) => offerToOption(o, i, dir, pax)));
    // one per flight number (cheapest), then pick: best fit, cheapest, fastest, and fill to 5 by fit+price
    const by = new Map();
    for (const x of opts) { const k = `${x.code}|${x.dep}`; if (!by.has(k) || (x.price ?? 1e9) < (by.get(k).price ?? 1e9)) by.set(k, x); }
    const uniq = [...by.values()];
    const score = x => fitPenalty(x, dir) * 10 + (x.price ?? 1e6) / 50 + x.stops * 60;
    const pick = [];
    const add = x => { if (x && !pick.includes(x)) pick.push(x); };
    const sorted = [...uniq].sort((a, b) => score(a) - score(b));
    add(sorted[0]);
    add([...uniq].sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9))[0]);
    add([...uniq].sort((a, b) => (a.durMin ?? 1e9) - (b.durMin ?? 1e9))[0]);
    sorted.forEach(x => pick.length < 5 && add(x));
    pick.forEach((x, i) => { x.id = `${dir}-d${i + 1}`; });
    const rec = pick[0]; rec.recommended = true;
    rec.why = `ราคาสดจากระบบจอง${rec.test ? ' (โหมดทดสอบ)' : ''} · ${go ? 'ถึงทันเริ่มเที่ยววันแรก' : 'ออกหลังมื้อเย็นวันสุดท้าย'}`;
    return pick;
  } catch (e) {
    if (!signal?.aborted) { log.warn?.(`[bop] duffel search failed: ${e.code || ''} ${e.message} ${e.detail || ''}`); emit('ระบบเที่ยวบินไม่ตอบ ใช้การค้นเว็บแทน'); }
    return [];
  }
}

/* ---------- booking ---------- */
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const usesPersistentState = () => process.env.BOP_NO_STORE !== '1' && !!process.env.BOP_STATE_TABLE;
const money = async (amount, currency) => ({ amount: String(amount), currency, thb: await toTHB(amount, currency) });

/** POST /api/flights/offer — fresh price, expiry, passengers to fill, bag services, conditions. */
export async function runFlightOffer({ offerId, signal }) {
  if (!/^off_[A-Za-z0-9]+$/.test(offerId || '')) throw new AgentError('bad_request', 'ไม่มีรหัสข้อเสนอเที่ยวบิน');
  const o = await duffel('GET', `/air/offers/${offerId}?return_available_services=true`, { signal });
  const sl = o.slices?.[0] || {}, segs = sl.segments || [];
  const services = await Promise.all((o.available_services || []).filter(s => s.type === 'baggage').map(async s => ({
    id: s.id, kind: 'bag', label: `กระเป๋าโหลด${s.metadata?.maximum_weight_kg ? ` ${s.metadata.maximum_weight_kg} กก.` : ''}`,
    price: await money(s.total_amount, s.total_currency), maxQty: s.maximum_quantity || 1, passengerIds: s.passenger_ids || [],
  })));
  return {
    type: 'done', mode: duffelMode(), bookable: bookingEnabled(),
    offer: {
      id: o.id, expiresAt: o.expires_at, total: await money(o.total_amount, o.total_currency),
      carrier: o.owner?.name || '', code: `${segs[0]?.marketing_carrier?.iata_code || ''}${segs[0]?.marketing_carrier_flight_number || ''}`,
      from: segs[0]?.origin?.iata_code || '', to: segs[segs.length - 1]?.destination?.iata_code || '',
      departingAt: segs[0]?.departing_at || '', arrivingAt: segs[segs.length - 1]?.arriving_at || '',
      passengers: (o.passengers || []).map(p => ({ id: p.id, type: p.type || 'adult' })),
      idDocsRequired: !!o.passenger_identity_documents_required,
      instantOnly: o.payment_requirements ? !!o.payment_requirements.requires_instant_payment : true,
      payBy: o.payment_requirements?.payment_required_by || null,
      conditions: condText(o.conditions), bag: bagText(o),
    },
    services,
  };
}

const NAME = /^[A-Za-z][A-Za-z '\-]{0,39}$/;
function cleanPassenger(p, ids) {
  const x = {
    id: String(p.id || ''), title: String(p.title || '').toLowerCase(), given_name: String(p.given_name || '').trim(), family_name: String(p.family_name || '').trim(),
    born_on: String(p.born_on || ''), gender: String(p.gender || '').toLowerCase(), email: String(p.email || '').trim(), phone_number: String(p.phone_number || '').replace(/[\s-]/g, ''),
  };
  if (!ids.has(x.id)) return 'ข้อมูลผู้โดยสารไม่ตรงกับข้อเสนอ';
  if (!['mr', 'ms', 'mrs', 'miss'].includes(x.title)) return 'เลือกคำนำหน้า';
  if (!NAME.test(x.given_name) || !NAME.test(x.family_name)) return 'ใส่ชื่อและนามสกุลเป็นภาษาอังกฤษตามพาสปอร์ต';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.born_on)) return 'ใส่วันเกิด';
  if (!['m', 'f'].includes(x.gender)) return 'เลือกเพศ';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email)) return 'อีเมลไม่ถูกต้อง';
  if (!/^\+\d{8,15}$/.test(x.phone_number)) return 'เบอร์โทรต้องขึ้นต้นด้วย +66 เช่น +66812345678';
  return x;
}

async function claimOperation(idempotencyKey, payload) {
  if (!usesPersistentState()) return { acquired: true, persisted: false, key: null };
  if (!IDEMPOTENCY_KEY.test(idempotencyKey || '')) throw new AgentError('bad_request', 'คำขอนี้ไม่มี idempotency key ที่ถูกต้อง');
  const result = await beginIdempotentOperation({ key: idempotencyKey, requestHash: requestHash(payload) });
  if (result.response) return { replay: result.response };
  if (result.conflict) throw new AgentError('bad_request', 'idempotency key นี้ถูกใช้กับคำขออื่นแล้ว');
  if (result.pending) throw new AgentError('rate_limit', 'คำขอนี้กำลังดำเนินการหรือรอตรวจสอบผลอยู่');
  return { ...result, key: idempotencyKey };
}

async function releaseOrHoldClaim(claim, externalStarted, error, log) {
  if (!claim?.persisted || !claim.key) return;
  try {
    if (externalStarted) await markIdempotentOperationUncertain(claim.key, error?.code || error?.message);
    else await releaseIdempotentOperation(claim.key);
  } catch (stateError) {
    log.warn?.(`[bop] idempotency cleanup failed: ${stateError.name || 'error'}`);
  }
}

/**
 * POST /api/flights/order — re-checks the price, then creates ONE order. Never retried automatically.
 * body: { offerId, passengers:[…], services:[{id,quantity}], hold:boolean,
 *         approved:{ amount, currency }, idempotencyKey: UUID }
 */
export async function runFlightOrder({ body, emit = () => {}, signal, log = console }) {
  if (!bookingEnabled()) throw new AgentError('not_enabled', 'ยังเปิดจองเที่ยวบินจริงไม่ได้ (ต้องผ่านการยืนยันกับระบบจองก่อน)');
  const { offerId, passengers = [], services = [], hold = false, approved, idempotencyKey } = body || {};
  const claim = await claimOperation(idempotencyKey, body);
  if (claim.replay) return claim.replay;
  let externalStarted = false;

  try {
    emit('ตรวจราคาล่าสุด');
    const fresh = await runFlightOffer({ offerId, signal });
    const ids = new Set(fresh.offer.passengers.map(p => p.id));
    if (!Array.isArray(passengers) || passengers.length !== ids.size) throw new AgentError('bad_request', `ต้องใส่ข้อมูลผู้โดยสารครบ ${ids.size} คน`);
    const pax = [];
    for (const p of passengers) { const c = cleanPassenger(p, ids); if (typeof c === 'string') throw new AgentError('bad_request', c); pax.push(c); }
    if (fresh.offer.idDocsRequired) throw new AgentError('bad_request', 'เที่ยวบินนี้ต้องใช้ข้อมูลพาสปอร์ต ซึ่ง Bop ยังไม่รองรับ เลือกเที่ยวบินอื่น');
    const svcById = new Map(fresh.services.map(s => [s.id, s]));
    const svc = (Array.isArray(services) ? services : []).filter(s => svcById.has(s.id) && +s.quantity > 0)
      .map(s => ({ id: s.id, quantity: Math.min(+s.quantity, svcById.get(s.id).maxQty) }));
    const cur = fresh.offer.total.currency;
    const total = svc.reduce((a, s) => a + +svcById.get(s.id).price.amount * s.quantity, +fresh.offer.total.amount);
    const totalStr = total.toFixed(2);
    if (!approved || approved.currency !== cur || Math.abs(+approved.amount - total) > 0.005) {
      throw Object.assign(new AgentError('price_changed', `ราคารวมตอนนี้คือ ${cur} ${totalStr} ไม่ตรงกับที่อนุมัติไว้ ตรวจแล้วกดยืนยันอีกครั้ง`), { extra: { total: await money(totalStr, cur) } });
    }
    const useHold = !!hold && !fresh.offer.instantOnly;
    emit(useHold ? 'กันที่นั่งไว้ก่อน (ยังไม่ชำระเงิน)' : 'ยืนยันการจอง');
    const data = { type: useHold ? 'hold' : 'instant', selected_offers: [offerId], passengers: pax };
    if (svc.length && !useHold) data.services = svc;
    if (!useHold) data.payments = [{ type: 'balance', currency: cur, amount: totalStr }];
    externalStarted = true;
    const o = await duffel('POST', '/air/orders', { body: data, signal, timeout: 60000 });
    const rec = { orderId: o.id, bookingReference: o.booking_reference, offerId, mode: duffelMode(), type: data.type,
      total: o.total_amount, currency: o.total_currency, createdAt: new Date().toISOString(), payBy: o.payment_status?.payment_required_by || null };
    const response = { type: 'done', order: { ...rec, totalTHB: await toTHB(o.total_amount, o.total_currency) } };
    try {
      await createOrderRecord(rec);
      if (claim.persisted) await completeIdempotentOperation(claim.key, response);
    } catch (stateError) {
      log.warn?.(`[bop] order state write failed: ${stateError.name || 'error'}`);
      if (claim.persisted) await markIdempotentOperationUncertain(claim.key, 'state write failed').catch(() => {});
    }
    log.info?.(`[bop] duffel order ${o.id} ${o.booking_reference} ${data.type} ${o.total_currency} ${o.total_amount}`);
    return response;
  } catch (error) {
    await releaseOrHoldClaim(claim, externalStarted, error, log);
    throw error;
  }
}

/** POST /api/flights/cancel — step 1 returns a quote; confirmation requires an idempotency key. */
export async function runFlightCancel({ body, signal, log = console }) {
  if (!bookingEnabled()) throw new AgentError('not_enabled', 'ยังเปิดจัดการการจองเที่ยวบินไม่ได้');
  const { orderId, confirm, idempotencyKey } = body || {};
  if (!/^ord_[A-Za-z0-9]+$/.test(orderId || '')) throw new AgentError('bad_request', 'ไม่มีรหัสการจอง');
  if (!confirm) {
    const c = await duffel('POST', '/air/order_cancellations', { body: { order_id: orderId }, signal });
    return { type: 'done', quote: { cancellationId: c.id, refund: c.refund_amount != null ? await money(c.refund_amount, c.refund_currency) : null, refundTo: c.refund_to || '', expiresAt: c.expires_at } };
  }
  if (!/^ore_[A-Za-z0-9]+$/.test(confirm)) throw new AgentError('bad_request', 'รหัสการยกเลิกไม่ถูกต้อง');

  const claim = await claimOperation(idempotencyKey, body);
  if (claim.replay) return claim.replay;
  let externalStarted = false;
  try {
    externalStarted = true;
    const c = await duffel('POST', `/air/order_cancellations/${confirm}/actions/confirm`, { signal });
    const response = { type: 'done', cancelled: { orderId, confirmedAt: c.confirmed_at, refund: c.refund_amount != null ? await money(c.refund_amount, c.refund_currency) : null } };
    try {
      await updateOrderRecord(orderId, { cancelledAt: c.confirmed_at || new Date().toISOString() });
      if (claim.persisted) await completeIdempotentOperation(claim.key, response);
    } catch (stateError) {
      log.warn?.(`[bop] cancellation state write failed: ${stateError.name || 'error'}`);
      if (claim.persisted) await markIdempotentOperationUncertain(claim.key, 'state write failed').catch(() => {});
    }
    return response;
  } catch (error) {
    await releaseOrHoldClaim(claim, externalStarted, error, log);
    throw error;
  }
}
