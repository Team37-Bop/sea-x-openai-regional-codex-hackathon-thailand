/* Onboarding: the organizer describes the trip and the group before Bop plans anything. */
import * as P from '../plan.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));

/* Used only if plan.js does not export SAMPLE_SETUP yet. Ids match `star:'min'` in BASE. */
const FALLBACK_SAMPLE = {
  title: 'เชียงใหม่กับแก๊งมหา\'ลัย', city: 'เชียงใหม่', startDate: '2026-11-20', days: 3,
  arrive: { from: 'DMK', time: '09:15' }, depart: { to: 'DMK', time: '21:15' },
  pace: 'normal', hotelArea: 'เมืองเก่า',
  members: [
    { id: 'min', name: 'มิ้น', role: 'organizer', wants: ['อยากดูพระอาทิตย์ขึ้นบนดอย'] },
    { id: 'palm', name: 'ปาล์ม', avoid: 'เนื้อสัตว์ (กินมังสวิรัติ)' },
    { id: 'oat', name: 'โอ๊ต', maxWalkKm: 3, note: 'เข่าไม่ดี' },
    { id: 'fon', name: 'ฝน', budget: 5000 },
  ],
  extra: '',
};
export const sampleSetup = () => withDates(clone(P.SAMPLE_SETUP || FALLBACK_SAMPLE));

export const PACE = { chill: 'สบาย ๆ', normal: 'กำลังดี', packed: 'อัดแน่น' };
/* destination suggestions: [lat,lng], country, currency, main airport, Thai country name */
export const CITIES = {
  // ไทย
  'เชียงใหม่': [[18.79, 98.985], 'TH', 'THB', 'CNX', 'ไทย'],
  'เชียงราย': [[19.91, 99.84], 'TH', 'THB', 'CEI', 'ไทย'],
  'ภูเก็ต': [[7.88, 98.39], 'TH', 'THB', 'HKT', 'ไทย'],
  'กระบี่': [[8.06, 98.92], 'TH', 'THB', 'KBV', 'ไทย'],
  'เกาะสมุย': [[9.51, 100.01], 'TH', 'THB', 'USM', 'ไทย'],
  'หัวหิน': [[12.57, 99.96], 'TH', 'THB', '', 'ไทย'],
  'พัทยา': [[12.93, 100.88], 'TH', 'THB', 'UTP', 'ไทย'],
  'เขาใหญ่': [[14.44, 101.37], 'TH', 'THB', '', 'ไทย'],
  'น่าน': [[18.78, 100.78], 'TH', 'THB', 'NNT', 'ไทย'],
  'ขอนแก่น': [[16.43, 102.83], 'TH', 'THB', 'KKC', 'ไทย'],
  // เอเชีย
  'โตเกียว': [[35.68, 139.76], 'JP', 'JPY', 'NRT', 'ญี่ปุ่น'],
  'โอซาก้า': [[34.69, 135.5], 'JP', 'JPY', 'KIX', 'ญี่ปุ่น'],
  'เกียวโต': [[35.01, 135.77], 'JP', 'JPY', 'KIX', 'ญี่ปุ่น'],
  'ฮอกไกโด (ซัปโปโร)': [[43.06, 141.35], 'JP', 'JPY', 'CTS', 'ญี่ปุ่น'],
  'ฟุกุโอกะ': [[33.59, 130.4], 'JP', 'JPY', 'FUK', 'ญี่ปุ่น'],
  'โซล': [[37.57, 126.98], 'KR', 'KRW', 'ICN', 'เกาหลีใต้'],
  'ปูซาน': [[35.18, 129.08], 'KR', 'KRW', 'PUS', 'เกาหลีใต้'],
  'ไทเป': [[25.04, 121.56], 'TW', 'TWD', 'TPE', 'ไต้หวัน'],
  'ฮ่องกง': [[22.3, 114.17], 'HK', 'HKD', 'HKG', 'ฮ่องกง'],
  'มาเก๊า': [[22.2, 113.55], 'MO', 'MOP', 'MFM', 'มาเก๊า'],
  'เซี่ยงไฮ้': [[31.23, 121.47], 'CN', 'CNY', 'PVG', 'จีน'],
  'ปักกิ่ง': [[39.9, 116.4], 'CN', 'CNY', 'PEK', 'จีน'],
  'สิงคโปร์': [[1.29, 103.85], 'SG', 'SGD', 'SIN', 'สิงคโปร์'],
  'กัวลาลัมเปอร์': [[3.14, 101.69], 'MY', 'MYR', 'KUL', 'มาเลเซีย'],
  'บาหลี': [[-8.65, 115.22], 'ID', 'IDR', 'DPS', 'อินโดนีเซีย'],
  'ดานัง': [[16.05, 108.2], 'VN', 'VND', 'DAD', 'เวียดนาม'],
  'ฮานอย': [[21.03, 105.85], 'VN', 'VND', 'HAN', 'เวียดนาม'],
  'โฮจิมินห์': [[10.78, 106.7], 'VN', 'VND', 'SGN', 'เวียดนาม'],
  'หลวงพระบาง': [[19.89, 102.13], 'LA', 'LAK', 'LPQ', 'ลาว'],
  'เสียมเรียบ': [[13.36, 103.86], 'KH', 'USD', 'SAI', 'กัมพูชา'],
  'มัลดีฟส์': [[4.18, 73.51], 'MV', 'USD', 'MLE', 'มัลดีฟส์'],
  'ดูไบ': [[25.2, 55.27], 'AE', 'AED', 'DXB', 'สหรัฐอาหรับเอมิเรตส์'],
  'อินเดีย (นิวเดลี)': [[28.61, 77.21], 'IN', 'INR', 'DEL', 'อินเดีย'],
  // ยุโรป
  'ลอนดอน': [[51.51, -0.13], 'GB', 'GBP', 'LHR', 'สหราชอาณาจักร'],
  'ปารีส': [[48.86, 2.35], 'FR', 'EUR', 'CDG', 'ฝรั่งเศส'],
  'โรม': [[41.9, 12.5], 'IT', 'EUR', 'FCO', 'อิตาลี'],
  'มิลาน': [[45.46, 9.19], 'IT', 'EUR', 'MXP', 'อิตาลี'],
  'บาร์เซโลนา': [[41.39, 2.17], 'ES', 'EUR', 'BCN', 'สเปน'],
  'อัมสเตอร์ดัม': [[52.37, 4.9], 'NL', 'EUR', 'AMS', 'เนเธอร์แลนด์'],
  'ซูริก': [[47.38, 8.54], 'CH', 'CHF', 'ZRH', 'สวิตเซอร์แลนด์'],
  'อินเทอร์ลาเคน': [[46.69, 7.86], 'CH', 'CHF', 'ZRH', 'สวิตเซอร์แลนด์'],
  'ปราก': [[50.08, 14.44], 'CZ', 'CZK', 'PRG', 'เช็กเกีย'],
  'เวียนนา': [[48.21, 16.37], 'AT', 'EUR', 'VIE', 'ออสเตรีย'],
  'มิวนิก': [[48.14, 11.58], 'DE', 'EUR', 'MUC', 'เยอรมนี'],
  'อิสตันบูล': [[41.01, 28.98], 'TR', 'TRY', 'IST', 'ตุรกี'],
  'เรคยาวิก': [[64.15, -21.94], 'IS', 'ISK', 'KEF', 'ไอซ์แลนด์'],
  // อเมริกา โอเชียเนีย
  'นิวยอร์ก': [[40.71, -74.01], 'US', 'USD', 'JFK', 'สหรัฐอเมริกา'],
  'ลอสแอนเจลิส': [[34.05, -118.24], 'US', 'USD', 'LAX', 'สหรัฐอเมริกา'],
  'ซานฟรานซิสโก': [[37.77, -122.42], 'US', 'USD', 'SFO', 'สหรัฐอเมริกา'],
  'ซิดนีย์': [[-33.87, 151.21], 'AU', 'AUD', 'SYD', 'ออสเตรเลีย'],
  'เมลเบิร์น': [[-37.81, 144.96], 'AU', 'AUD', 'MEL', 'ออสเตรเลีย'],
  'โอ๊คแลนด์': [[-36.85, 174.76], 'NZ', 'NZD', 'AKL', 'นิวซีแลนด์'],
};
/* currency for countries not in CITIES (filled from /api/city lookups) */
export const CC_CURRENCY = { TH:'THB', JP:'JPY', KR:'KRW', TW:'TWD', HK:'HKD', MO:'MOP', CN:'CNY', SG:'SGD', MY:'MYR', ID:'IDR', VN:'VND', LA:'LAK', KH:'USD', MM:'MMK', PH:'PHP', IN:'INR', LK:'LKR', NP:'NPR', MV:'USD', AE:'AED', QA:'QAR', SA:'SAR', TR:'TRY', GB:'GBP', IE:'EUR', FR:'EUR', DE:'EUR', IT:'EUR', ES:'EUR', PT:'EUR', NL:'EUR', BE:'EUR', AT:'EUR', GR:'EUR', FI:'EUR', CH:'CHF', CZ:'CZK', HU:'HUF', PL:'PLN', DK:'DKK', SE:'SEK', NO:'NOK', IS:'ISK', US:'USD', CA:'CAD', MX:'MXN', BR:'BRL', AU:'AUD', NZ:'NZD', EG:'EGP', MA:'MAD', ZA:'ZAR', RU:'RUB', GE:'GEL', UZ:'UZS', KZ:'KZT', MN:'MNT', BT:'BTN' };
const regionTh = (() => { try { const dn = new Intl.DisplayNames(['th'], { type: 'region' }); return cc => { try { return dn.of(cc) || cc; } catch (_) { return cc; } }; } catch (_) { return cc => cc; } })();
/* cache of looked-up destinations not in CITIES: name -> same tuple shape */
const LOOKED = {};
export const cityTuple = name => CITIES[(name || '').trim()] || LOOKED[(name || '').trim()] || null;
export async function lookupCity(name) {
  const k = (name || '').trim();
  if (!k || CITIES[k]) return CITIES[k] || null;
  if (LOOKED[k]) return LOOKED[k];
  try {
    const r = await fetch('/api/city?q=' + encodeURIComponent(k));
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.ll) return null;
    const cc = String(j.cc || '').toUpperCase();
    return (LOOKED[k] = [j.ll, cc, CC_CURRENCY[cc] || '', '', cc ? regionTh(cc) : '']);
  } catch (_) { return null; }
}
export const CITY_LL = Object.fromEntries(Object.entries(CITIES).map(([k, v]) => [k, v[0]]));
export const MAX_DAYS = 7;
let cityT = null;

/* ---------- names, dates ---------- */
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
export function initials(name) {
  const n = String(name || '?').trim() || '?';
  const g = seg ? [...seg.segment(n)].map(x => x.segment) : [...n];
  return /^[เแโใไ]/.test(g[0]) && g[1] ? g[0] + g[1] : g[0];
}
export const organizer = s => (s && s.members && (s.members.find(m => m.role === 'organizer') || s.members[0])) || { name: 'คนจัดทริป' };
export const memberName = (s, id) => { const m = s && s.members && s.members.find(x => x.id === id); return m ? m.name : id; };
export const avClass = (s, id) => 'c' + Math.max(0, (s && s.members ? s.members.findIndex(m => m.id === id) : 0)) % 6;

const parseISO = iso => { const [y, m, d] = String(iso || '').split('-').map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
const fDay = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
const fYear = new Intl.DateTimeFormat('th-TH', { year: 'numeric' });
export function dateOf(setup, di) { const d = parseISO(setup && setup.startDate); if (!d) return null; d.setDate(d.getDate() + di); return d; }
export function rangeText(setup) {
  const a = dateOf(setup, 0), b = dateOf(setup, (setup.days || 1) - 1);
  if (!a) return '';
  const y = fYear.format(b).replace(/[^\d]/g, '');
  return (setup.days > 1 ? `${fDay.format(a)} – ${fDay.format(b)}` : fDay.format(a)) + (y ? ` ${y}` : '');
}
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function spanDays(a, b) { const x = parseISO(a), y = parseISO(b); return x && y ? Math.round((y - x) / 864e5) + 1 : 0; }
export function endOf(start, days) { const d = parseISO(start); if (!d) return ''; d.setDate(d.getDate() + (+days || 1) - 1); return isoOf(d); }
export function withDates(d) { if (!d.endDate && d.startDate) d.endDate = endOf(d.startDate, d.days); return d; }
function nightsLine(d) {
  const n = spanDays(d.startDate, d.endDate);
  if (!n) return 'เลือกวันไปและวันกลับ';
  if (n < 1) return 'วันกลับต้องไม่ก่อนวันไป';
  if (n > MAX_DAYS) return `ยาวสุด ${MAX_DAYS} วัน (ตอนนี้ ${n} วัน)`;
  return nightsText(n);
}
function cityHint(city) {
  const c = cityTuple(city);
  if (!c) return (city || '').trim() ? 'Bop จะหาข้อมูลปลายทางนี้ให้ ราคาแสดงเป็นบาท' : '';
  if (!c[1]) return 'Bop จะหาข้อมูลปลายทางนี้ให้ ราคาแสดงเป็นบาท';
  return c[1] === 'TH' ? 'ในประเทศ' : `ต่างประเทศ · ${c[4] || c[1]} · ราคาแปลงเป็นบาท${c[2] ? ` (${c[2]} → THB)` : ''}`;
}
export function nightsText(n) { n = +n || 1; return n === 1 ? 'ไปเช้าเย็นกลับ' : `${n} วัน ${n - 1} คืน`; }

/* ---------- constraint summary (shown in the header when checks() has no line for a member) ---------- */
export function memberWants(m) {
  const out = [];
  const av = (m.avoid || (m.veg ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : '')).trim();
  if (av) out.push(`ไม่ทาน ${av}`);
  if (m.maxWalkKm) out.push(`เดินไม่เกิน ${m.maxWalkKm} กม./วัน`);
  if (m.budget) out.push(`งบ ฿${Number(m.budget).toLocaleString('en-US')}`);
  (m.wants || []).forEach(w => out.push(w));
  if (m.note) out.push(m.note);
  return out;
}

/* ---------- booked stays: one row per hotel, in trip order, each { name, nights } ----------
   The first row starts on night 1. One row = every night there. Old drafts { mode:'booked', name } become one row. */
const tripNights = d => Math.max(0, (Math.min(MAX_DAYS, spanDays(d.startDate, d.endDate)) || +d.days || 1) - 1);
export function stayRows(d) {
  const st = d.stay || (d.stay = { mode: 'auto' });
  if (!Array.isArray(st.stays) || !st.stays.length) st.stays = [{ name: st.name || '', nights: tripNights(d) }];
  delete st.name;
  if (st.stays.length === 1) st.stays[0].nights = tripNights(d);
  return st.stays;
}
const stayInputId = (i, k = 'name') => k === 'name' ? (i ? `f-stayname-${i}` : 'f-stayname') : `f-staynights-${i}`;
export function addStay(d) {
  const rows = stayRows(d), N = tripNights(d);
  if (rows.length >= N) return -1;
  const used = rows.reduce((a, r) => a + (+r.nights || 0), 0);
  let give = N - used;
  if (give < 1) { const r = [...rows].reverse().find(x => +x.nights > 1); if (!r) return -1; r.nights = +r.nights - 1; give = 1; }
  rows.push({ name: '', nights: give });
  return rows.length - 1;
}
export function delStay(d, i) {
  const rows = stayRows(d); if (rows.length < 2 || !rows[i]) return;
  const [r] = rows.splice(i, 1), to = rows[Math.max(0, i - 1)];
  to.nights = (+to.nights || 0) + (+r.nights || 0);
  if (rows.length === 1) rows[0].nights = tripNights(d);
}
function staySetup(d, days) {
  if (!d.stay || d.stay.mode !== 'booked') return { mode: 'auto' };
  const N = Math.max(0, days - 1);
  const rows = (Array.isArray(d.stay.stays) ? d.stay.stays : [{ name: d.stay.name }])
    .map(r => ({ name: String(r.name || '').trim(), nights: Math.max(0, Math.round(+r.nights || 0)) })).filter(r => r.name);
  if (!rows.length) return { mode: 'auto' };
  if (rows.length === 1 || N === 0) return { mode: 'booked', stays: [{ name: rows[0].name, nights: N }] };
  return { mode: 'booked', stays: rows };
}
/* null when the booked rows add up; else { field, msg } in Thai */
function stayProblem(d, N) {
  if (!d.stay || d.stay.mode !== 'booked') return null;
  const rows = Array.isArray(d.stay.stays) && d.stay.stays.length ? d.stay.stays : [{ name: d.stay.name || '', nights: N }];
  const empty = rows.findIndex(r => !String(r.name || '').trim());
  if (rows.length === 1) return empty === 0 && N > 0 ? { field: 'f-stayname', msg: 'ใส่ชื่อหรือที่อยู่ที่พักที่จองไว้ หรือเลือก “ให้ Bop แนะนำ”' } : null;
  if (empty >= 0) return { field: stayInputId(empty), msg: `ใส่ชื่อที่พักแห่งที่ ${empty + 1} หรือลบแถวนี้` };
  const bad = rows.findIndex(r => !(r.nights !== '' && Number.isInteger(+r.nights) && +r.nights >= 1));
  if (bad >= 0) return { field: stayInputId(bad, 'nights'), msg: `ที่พักแห่งที่ ${bad + 1} ต้องพักอย่างน้อย 1 คืน` };
  const sum = rows.reduce((a, r) => a + +r.nights, 0);
  if (sum !== N) return { field: stayInputId(rows.length - 1, 'nights'), msg: N === 0 ? 'ทริปไปเช้าเย็นกลับไม่มีคืนพัก ลบที่พักให้เหลือแห่งเดียว' : `จำนวนคืนรวม ${sum} คืน ไม่ตรงกับทริป ${N} คืน แก้ให้รวมกันได้ ${N} คืน` };
  return null;
}
function staySum(d) {
  const rows = stayRows(d), N = tripNights(d), sum = rows.reduce((a, r) => a + (+r.nights || 0), 0);
  return { ok: sum === N, txt: sum === N ? `ครบ ${N} คืน` : `รวม ${sum} จาก ${N} คืน${sum > N ? ' (เกิน)' : ''}` };
}
/* check-in / check-out dates of each row: "ศ. 20 พ.ย. → ส. 21 พ.ย." */
function stayDates(d) {
  let night = 0;
  return stayRows(d).map(r => {
    const n = Math.max(0, Math.round(+r.nights || 0)), a = dateOf(d, night), b = dateOf(d, night + n);
    night += n;
    return a && b && n ? `${fDay.format(a)} → ${fDay.format(b)}` : '';
  });
}

/* ---------- normalise the draft into a TripSetup for the API ---------- */
export function toSetup(d) {
  const s = {
    title: (d.title || '').trim() || `${d.city || 'ทริป'} ${nightsText(d.days)}`,
    city: (d.city || '').trim(),
    startDate: d.startDate,
    endDate: d.endDate,
    days: Math.min(MAX_DAYS, Math.max(1, spanDays(d.startDate, d.endDate) || +d.days || 1)),
    pace: d.pace || 'normal',
    autonomy: d.autonomy === 'ask' ? 'ask' : 'auto',
    members: d.members.filter(m => (m.name || '').trim()).map(m => {
      const o = { id: m.id, name: m.name.trim() };
      if (m.role === 'organizer') o.role = 'organizer';
      const av = (m.avoid || (m.veg ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : '')).trim();
      if (av) o.avoid = av.slice(0, 120);
      if (+m.maxWalkKm > 0) o.maxWalkKm = +m.maxWalkKm;
      if (+m.budget > 0) o.budget = +m.budget;
      const w = (Array.isArray(m.wants) ? m.wants : String(m.wants || '').split('\n')).map(x => x.trim()).filter(Boolean);
      if (w.length) o.wants = w;
      if ((m.note || '').trim()) o.note = m.note.trim();
      return o;
    }),
  };
  const c = cityTuple(s.city), up = v => (v || '').trim().toUpperCase();
  if (d.country || c) s.country = up(d.country) || c[1];
  if (d.currency || c) s.currency = up(d.currency) || c[2];
  if (c && /^[A-Z]{3}$/.test(c[3] || '')) s.cityAirport = c[3];
  for (const dir of ['arrive', 'depart']) {
    const t = d[dir]; if (!t) continue;
    const by = t.by || 'flight', key = dir === 'arrive' ? 'from' : 'to';
    let place = (t[key] || '').trim(); if (by === 'flight') place = up(place);
    const o = { by, [key]: place || (by === 'flight' ? (dir === 'depart' && s.arrive?.by === 'flight' ? s.arrive.from : 'BKK') : 'กรุงเทพฯ') };
    if (by !== 'undecided' && t.time) o.time = t.time;
    if (NOUN[by] && t.auto) { o.auto = true; if (t.choice) o.choice = t.choice; }
    s[dir] = o;
  }
  if (d.arrive?.by === 'drive' || d.depart?.by === 'drive' || d.hasCar) s.hasCar = !!d.hasCar;
  s.stay = staySetup(d, s.days);
  if ((d.extra || '').trim()) s.extra = d.extra.trim();
  if (s.members.length && !s.members.some(m => m.role === 'organizer')) s.members[0].role = 'organizer';
  return s;
}
export function validate(d) {
  if (!(d.city || '').trim()) return { field: 'f-city', msg: 'ใส่เมืองที่จะไป' };
  if (!parseISO(d.startDate)) return { field: 'f-start', msg: 'เลือกวันไป' };
  if (!parseISO(d.endDate)) return { field: 'f-end', msg: 'เลือกวันกลับ' };
  const n = spanDays(d.startDate, d.endDate);
  if (n < 1) return { field: 'f-end', msg: 'วันกลับต้องเป็นวันเดียวกับวันไปหรือหลังจากนั้น' };
  if (n > MAX_DAYS) return { field: 'f-end', msg: `ทริปยาวได้สูงสุด ${MAX_DAYS} วัน` };
  const sb = stayProblem(d, n - 1); if (sb) return sb;
  if (!d.members.some(m => (m.name || '').trim())) return { field: 'f-newmem', msg: 'เพิ่มเพื่อนอย่างน้อย 1 คน' };
  return null;
}

/* ---------- render ---------- */
const ICO = {
  x: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  arrow: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
};

function memberBlock(m, i) {
  const id = m.id, wants = Array.isArray(m.wants) ? m.wants.join('\n') : (m.wants || '');
  return `<fieldset class="mrow" data-mid="${esc(id)}">
    <legend class="sr">เพื่อนคนที่ ${i + 1}</legend>
    <div class="mrow-h">
      <span class="av c${i % 6}" aria-hidden="true">${esc(initials(m.name))}</span>
      <label class="sr" for="mn-${esc(id)}">ชื่อ</label>
      <input class="in name" id="mn-${esc(id)}" data-k="name" value="${esc(m.name)}" placeholder="ชื่อเล่น" autocomplete="off">
      <label class="org"><input type="radio" name="org" data-k="role" ${m.role === 'organizer' ? 'checked' : ''}><span>คนจัดทริป</span></label>
      <button class="iconbtn" type="button" data-del="${esc(id)}" aria-label="ลบ ${esc(m.name || 'เพื่อนคนนี้')}">${ICO.x}</button>
    </div>
    <div class="mrow-c">
      <label class="txt-f"><span>แพ้/ไม่ทาน</span><input class="in" data-k="avoid" maxlength="120" value="${esc(m.avoid || (m.veg ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : ''))}" placeholder="เช่น กุ้ง ถั่วลิสง หมู มังสวิรัติ" autocomplete="off"></label>
      <label class="num-f"><span>เดินไม่เกิน</span><input class="in" type="number" inputmode="decimal" min="0" max="30" step="0.5" data-k="maxWalkKm" value="${m.maxWalkKm ?? ''}" placeholder="–"><span>กม./วัน</span></label>
      <label class="num-f"><span>งบ ฿</span><input class="in w-budget" type="number" inputmode="numeric" min="0" step="500" data-k="budget" value="${m.budget ?? ''}" placeholder="ไม่จำกัด"><span>ต่อคน</span></label>
    </div>
    <div class="mrow-t">
      <label><span class="lab">อยากทำอะไร <i>บรรทัดละอย่าง</i></span><textarea class="in" rows="1" data-k="wants" placeholder="เช่น อยากดูพระอาทิตย์ขึ้นบนดอย">${esc(wants)}</textarea></label>
      <label><span class="lab">โน้ต</span><input class="in" data-k="note" value="${esc(m.note || '')}" placeholder="เช่น เข่าไม่ดี เลี่ยงบันได" autocomplete="off"></label>
    </div>
  </fieldset>`;
}

export const BY = { flight: 'เครื่องบิน', drive: 'ขับรถไปเอง', bus: 'รถทัวร์', train: 'รถไฟ', undecided: 'ยังไม่รู้ ให้ Bop แนะนำ' };
export const NOUN = { flight: 'เที่ยวบิน', bus: 'รถทัวร์', train: 'รถไฟ' };
const LINK = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5"/></svg>';
const safeHref = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (_) { return ''; } };
const thb = n => n == null || n === '' || isNaN(+n) ? '' : '฿' + Math.round(+n).toLocaleString('en-US');
/* one transport option row (setup picker and planner bookings share it) */
export function optRow(o, { picked = false, attr = '' } = {}) {
  const href = o.src && safeHref(o.src.url);
  return `<li class="topt ${picked ? 'picked' : ''} ${o.recommended ? 'rec' : ''}">
    <button class="topt-b" type="button" ${attr} aria-pressed="${picked}">
      <span class="topt-c"><b>${esc(o.carrier || NOUN[o.by] || '')}</b>${o.code ? ` <span class="mono">${esc(o.code)}</span>` : ''}${o.recommended ? '<span class="rec-m">แนะนำ</span>' : ''}</span>
      <span class="topt-t mono">${esc(o.dep || '')} → ${esc(o.arr || '')}</span>
      <span class="topt-p mono">${o.price != null ? (o.checked === 'live' ? '' : '~') + thb(o.price) + '/คน' : ''}</span>
      <span class="topt-d">${esc([`${o.from || ''} → ${o.to || ''}`, o.bag].filter(Boolean).join(' · '))}${o.recommended && o.why ? `<span class="topt-w">${esc(o.why)}</span>` : ''}</span>
    </button>
    ${o.checked === 'live' ? `<span class="topt-s live">ราคาสด · จองได้${o.test ? ' (โหมดทดสอบ)' : ''}${o.cond ? ' · ' + esc(o.cond) : ''}</span>` : href ? `<a class="topt-s" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(o.src.title || href)}">ราคาประมาณจากเว็บ${LINK}</a>` : (o.checked === 'estimate' ? '<span class="topt-s est">ราคาประมาณ</span>' : '')}
  </li>`;
}
export function transportHTML(d, dir, T) {
  const t = d[dir] || {}, by = t.by || 'flight', noun = NOUN[by];
  if (!noun || !t.auto) return '';
  T = T || {};
  let h = '';
  if (T.state === 'run') h = `<p class="pi-h">Bop กำลังหา${noun}</p><ol class="trace">${(T.steps || []).map((x, i, a) => `<li class="${i === a.length - 1 ? 'run' : 'done'}"><i class="ic"></i><span>${esc(x)}</span></li>`).join('') || '<li class="run"><i class="ic"></i><span>กำลังเริ่ม…</span></li>'}</ol>`;
  else if (T.state === 'error') h = `<p class="topt-err" role="alert">${esc(T.msg || 'หาไม่สำเร็จ')}</p>`;
  else if (T.state === 'done') h = T.options && T.options.length
    ? `<ul class="topts" aria-label="ตัวเลือก${noun}">${T.options.map((o, i) => optRow(o, { picked: t.choice && t.choice.id === o.id, attr: `data-topt="${dir}" data-i="${i}"` })).join('')}</ul>`
    : `<p class="fhint">ไม่พบ${noun}ที่ตรงวัน Bop จะหาให้อีกครั้งตอนวางแผน</p>`;
  const picked = t.choice ? `<p class="topt-pick">เลือกแล้ว: ${esc(t.choice.carrier || '')} ${esc(t.choice.code || '')} ${esc(t.choice.dep || '')} → ${esc(t.choice.arr || '')}</p>` : '';
  return `${picked}<div class="topt-bar"><button class="btn sm ghost" type="button" data-tfind="${dir}" ${T.state === 'run' ? 'disabled' : ''}>${T.state === 'done' || T.state === 'error' ? 'ค้นใหม่' : `ดูตัวเลือก${noun}`}</button><span class="fhint">${t.choice ? '' : `ข้ามได้ Bop จะเลือก${noun}ให้ตอนวางแผน`}</span></div>${h}`;
}
function travelBlock(d, dir, ap, T) {
  const go = dir === 'arrive', t = d[dir] || (d[dir] = { by: 'flight' }), by = t.by || 'flight', key = go ? 'from' : 'to';
  const seg = Object.entries(BY).map(([k, v]) =>
    `<label class="seg-o"><input type="radio" name="by-${dir}" value="${k}" data-f="${dir}.by" ${by === k ? 'checked' : ''}><span>${v}</span></label>`).join('');
  const L = {
    flight: [go ? 'สนามบินต้นทาง' : 'บินกลับลงที่', go ? 'เวลาถึงปลายทาง' : 'เวลาเครื่องออก', 'BKK', true],
    drive: [go ? 'ออกจาก' : 'ขับกลับไปที่', go ? 'เวลาออกจากบ้าน' : 'เวลาออกเดินทางกลับ', 'กรุงเทพฯ', false],
    bus: [go ? 'ขึ้นรถที่' : 'กลับไปลงที่', go ? 'เวลาถึงปลายทาง' : 'เวลารถออก', 'หมอชิต', false],
    train: [go ? 'ขึ้นรถไฟที่' : 'กลับไปลงที่', go ? 'เวลาถึงปลายทาง' : 'เวลารถไฟออก', 'กรุงเทพอภิวัฒน์', false],
    undecided: [go ? 'ออกจากเมือง' : 'กลับไปที่', '', 'กรุงเทพฯ', false],
  }[by];
  const id = `f-${dir}`, noun = NOUN[by];
  if (noun && t.auto === undefined) t.auto = !t.time;
  const auto = noun && t.auto;
  return `<fieldset class="fld wide travel" aria-labelledby="${id}-l">
    <legend class="lab" id="${id}-l">${go ? 'เดินทางไป' : 'เดินทางกลับ'}</legend>
    <div class="seg seg-wrap" role="radiogroup" aria-labelledby="${id}-l">${seg}</div>
    <div class="travel-f">
      <label><span>${L[0]}</span><input class="in ${L[3] ? 'code' : ''}" data-f="${dir}.${key}" value="${esc(t[key] || '')}" placeholder="${esc(L[2])}" ${L[3] ? 'maxlength="4"' : ''} autocomplete="off"></label>
      ${!L[1] ? `<p class="fhint">Bop จะเสนอวิธีเดินทาง${go ? 'ไป' : 'กลับ'}ที่เหมาะกับกลุ่ม</p>` : auto ? '' : `<label><span>${L[1]} <i>ไม่ใส่ก็ได้</i></span><input class="in" type="time" data-f="${dir}.time" value="${esc(t.time || '')}"></label>`}
    </div>
    ${noun ? `<label class="tog"><input type="checkbox" data-f="${dir}.auto" ${auto ? 'checked' : ''}><span class="sw-t" aria-hidden="true"></span>ให้ Bop หา${noun}ให้</label>` : ''}
    <div class="tfind" id="tf-${dir}" aria-live="polite">${transportHTML(d, dir, T)}</div>
  </fieldset>`;
}
function stayList(d) {
  const rows = stayRows(d), N = tripNights(d), many = rows.length > 1, dates = stayDates(d);
  const row = (r, i) => `<div class="stay-row${many ? ' many' : ''}" data-si="${i}">
      <label class="stay-name"><span class="sr">${many ? `ที่พักแห่งที่ ${i + 1}` : 'ชื่อหรือที่อยู่ที่พัก'}</span><input class="in" id="${stayInputId(i)}" data-s="name" value="${esc(r.name || '')}" placeholder="${i ? 'ที่พักถัดไป' : 'ชื่อโรงแรมหรือที่อยู่ เช่น Brilliant Hotel Da Nang'}" autocomplete="off"></label>
      ${many ? `<label class="stay-k"><input class="in" type="number" id="${stayInputId(i, 'nights')}" data-s="nights" min="1" max="${Math.max(1, N)}" step="1" inputmode="numeric" value="${esc(r.nights ?? '')}" aria-label="จำนวนคืนที่พักแห่งที่ ${i + 1}"><span>คืน</span></label>
      <button class="iconbtn" type="button" data-sdel="${i}" aria-label="ลบที่พักแห่งที่ ${i + 1}">${ICO.x}</button>
      <span class="stay-d fhint" data-sd="${i}">${esc(dates[i])}</span>` : ''}
    </div>`;
  const sum = staySum(d);
  const hint = N === 0 ? 'ทริปไปเช้าเย็นกลับไม่มีคืนพัก ใส่ไว้ถ้าอยากแวะพักที่นี่ระหว่างวัน'
    : many ? 'วันที่ย้ายที่พัก Bop จะเริ่มวันจากที่พักเดิม (เช็กเอาต์ ขนกระเป๋าไปด้วย) แล้วจบวันที่ที่พักใหม่'
    : 'Bop จะหาพิกัด แล้วให้ทุกวันเริ่มและจบที่นี่ ถ้าแต่ละคืนพักคนละที่ กด “เพิ่มที่พัก”';
  return `<div class="stays">${rows.map(row).join('')}</div>
    ${N > 1 && rows.length < N || many ? `<div class="stay-bar">${N > 1 && rows.length < N ? `<button class="btn ghost sm" type="button" id="addstay">${ICO.plus}เพิ่มที่พัก</button>` : ''}
      ${many ? `<output class="stay-sum${sum.ok ? '' : ' bad'}" id="f-staysum" aria-live="polite">${esc(sum.txt)}</output>` : ''}</div>` : ''}
    <p class="fhint">${hint}</p>`;
}
function stayBlock(d) {
  const st = d.stay || (d.stay = { mode: 'auto' }), booked = st.mode === 'booked';
  return `<fieldset class="fld wide travel" id="f-stay" aria-labelledby="f-stay-l">
    <legend class="lab" id="f-stay-l">ที่พัก</legend>
    <div class="seg" role="radiogroup" aria-labelledby="f-stay-l">
      <label class="seg-o"><input type="radio" name="stay-mode" value="auto" data-f="stay.mode" ${booked ? '' : 'checked'}><span>ให้ Bop แนะนำ</span></label>
      <label class="seg-o"><input type="radio" name="stay-mode" value="booked" data-f="stay.mode" ${booked ? 'checked' : ''}><span>จองไว้แล้ว</span></label>
    </div>
    ${booked ? stayList(d)
      : '<p class="fhint">Bop จะเลือกย่านที่เดินทางน้อยที่สุดและเข้างบ พร้อมบอกเหตุผลและตัวอย่างที่พักในแผน</p>'}
  </fieldset>`;
}
export function renderSetup(root, d, ctx) {
  const pace = Object.entries(PACE).map(([k, v]) =>
    `<label class="seg-o"><input type="radio" name="pace" value="${k}" data-f="pace" ${d.pace === k ? 'checked' : ''}><span>${v}</span></label>`).join('');
  withDates(d);
  const ap = cityTuple(d.city) ? cityTuple(d.city)[3] : '';
  ['arrive', 'depart'].forEach(k => { d[k] = d[k] || { by: 'flight' }; d[k].by = d[k].by || 'flight'; });
  root.innerHTML = `
  <form class="setup-f" id="setupform" novalidate>
    <div class="setup-in gut">
      <div class="setup-intro">
        <p class="kicker">เริ่มทริปใหม่</p>
        <h2>เล่าให้ Bop ฟังว่าจะไปไหน กับใคร</h2>
        <p class="sub">Bop จะจัดแผนรายวันพร้อมเส้นทางจริง ให้ผ่านเงื่อนไขของทุกคนในกลุ่ม แล้วคอยปรับแผนให้ตอนมีเรื่องเปลี่ยน กรอกไว้ให้แล้วเป็นตัวอย่าง แก้ได้ทุกช่อง</p>
      </div>
      <div class="setup-grid">
        <section class="sblock" aria-labelledby="h-trip">
          <h3 id="h-trip"><span class="step-n">1</span>ทริป</h3>
          <label class="fld wide"><span class="lab">ชื่อทริป</span><input class="in" id="f-title" data-f="title" value="${esc(d.title)}" autocomplete="off"></label>
          <label class="fld wide"><span class="lab">ปลายทาง</span><input class="in" id="f-city" data-f="city" value="${esc(d.city)}" list="cities" placeholder="เมืองไหนก็ได้ ในหรือต่างประเทศ" autocomplete="off" required aria-describedby="f-cityhint">
            <datalist id="cities">${Object.keys(CITIES).map(c => `<option value="${c}">${CITIES[c][4]}</option>`).join('')}</datalist><span class="fhint" id="f-cityhint">${esc(cityHint(d.city))}</span></label>
          <div class="fld wide"><span class="lab" id="l-dates">วันเดินทาง</span>
            <div class="dates" role="group" aria-labelledby="l-dates">
              <label><span>วันไป</span><input class="in" type="date" id="f-start" data-f="startDate" value="${esc(d.startDate)}" required></label>
              <label><span>วันกลับ</span><input class="in" type="date" id="f-end" data-f="endDate" value="${esc(d.endDate || '')}" min="${esc(d.startDate)}" required></label>
              <output class="nights" id="f-nights" for="f-start f-end" aria-live="polite">${esc(nightsLine(d))}</output>
            </div></div>
          ${stayBlock(d)}
          ${travelBlock(d, 'arrive', ap, (ctx.topts || {}).arrive)}
          ${travelBlock(d, 'depart', ap, (ctx.topts || {}).depart)}
          ${(d.arrive?.by === 'drive' || d.depart?.by === 'drive' || d.hasCar) ? `<label class="tog fld wide car-tog"><input type="checkbox" data-f="hasCar" ${d.hasCar ? 'checked' : ''}><span class="sw-t" aria-hidden="true"></span>มีรถใช้ตลอดทริป <i>Bop จะวางแผนให้ขับรถเที่ยว</i></label>` : ''}
          <div class="fld wide"><span class="lab" id="l-pace">จังหวะเที่ยว</span><div class="seg" role="radiogroup" aria-labelledby="l-pace">${pace}</div></div>
          <div class="fld wide"><span class="lab" id="l-auto">ให้ Bop ทำงานแบบไหน</span>
            <div class="auto-ch" role="radiogroup" aria-labelledby="l-auto">
              <label class="auto-o"><input type="radio" name="autonomy" value="auto" data-f="autonomy" ${d.autonomy !== 'ask' ? 'checked' : ''}><span><b>ให้ Bop จัดให้เลย</b><i>เลือกร้านและที่เที่ยวให้ทั้งหมด แก้ทีหลังได้</i></span></label>
              <label class="auto-o"><input type="radio" name="autonomy" value="ask" data-f="autonomy" ${d.autonomy === 'ask' ? 'checked' : ''}><span><b>ถามความเห็นก่อน</b><i>Bop จะเสนอร้านและที่เที่ยวพร้อมรูปให้เลือกก่อนจัดแผน</i></span></label>
            </div></div>
          <label class="fld wide"><span class="lab">บอก Bop เพิ่ม <i>ไม่ใส่ก็ได้</i></span><textarea class="in" rows="2" data-f="extra" placeholder="เช่น ไม่อยากตื่นเช้าทุกวัน อยากได้คาเฟ่วิวดอย">${esc(d.extra || '')}</textarea></label>
        </section>
        <section class="sblock" aria-labelledby="h-mem">
          <h3 id="h-mem"><span class="step-n">2</span>เพื่อนในกลุ่ม <span class="cnt">${d.members.length} คน</span></h3>
          <p class="hint">ใส่เงื่อนไขเฉพาะคนที่มี Bop จะเช็กทุกข้อในแผน และบอกถ้ามีข้อไหนไม่ผ่าน</p>
          <div class="mlist">${d.members.map(memberBlock).join('')}</div>
          <div class="addm">
            <label class="sr" for="f-newmem">ชื่อเพื่อนที่จะเพิ่ม</label>
            <input class="in" id="f-newmem" placeholder="ชื่อเพื่อนอีกคน" autocomplete="off">
            <button class="btn ghost sm" type="button" id="addmem">${ICO.plus}เพิ่มเพื่อน</button>
          </div>
        </section>
      </div>
    </div>
    <div class="setup-bar gut">
      <p class="setup-msg" id="setupmsg" role="status">${ctx.msg || ''}</p>
      <div class="setup-act">
        ${ctx.hasPlan ? '<button class="btn ghost" type="button" id="backplan">กลับไปที่แผน</button>' : ''}
        <button class="btn ghost" type="button" id="usesample" ${ctx.claude ? 'hidden' : ''}>เปิดแผนตัวอย่าง</button>
        <button class="btn go" type="submit">เริ่มวางแผน${ICO.arrow}</button>
      </div>
    </div>
  </form>`;
}

/* keep an untouched title in step with the destination: "เชียงใหม่กับแก๊ง…" → "ดานังกับแก๊ง…", else "ทริปดานัง" */
function retitle(d, oldCity, newCity, form) {
  newCity = (newCity || '').trim();
  if (d._titleTouched || !newCity) return;
  const t = d.title || '', o = (oldCity || '').trim();
  d.title = o && t.startsWith(o) ? newCity + t.slice(o.length) : o && t.includes(o) ? t.replace(o, newCity) : `ทริป${/^[A-Za-z0-9]/.test(newCity) ? " " : ""}${newCity}`;
  const inp = form && form.querySelector('#f-title'); if (inp) inp.value = d.title;
}
/* write one input back into the draft; returns true if the form must re-render */
export function readField(d, el) {
  const f = el.dataset.f, k = el.dataset.k;
  if (el.dataset.s) {
    const row = el.closest('[data-si]'), rows = stayRows(d), r = row && rows[+row.dataset.si]; if (!r) return false;
    if (el.dataset.s === 'nights') {
      r.nights = el.value === '' ? '' : Math.round(+el.value);
      const sum = staySum(d), o = el.form && el.form.querySelector('#f-staysum');
      if (o) { o.textContent = sum.txt; o.classList.toggle('bad', !sum.ok); }
      stayDates(d).forEach((t, i) => { const x = el.form && el.form.querySelector(`[data-sd="${i}"]`); if (x) x.textContent = t; });
    } else r.name = el.value;
    return false;
  }
  if (f) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (f.includes('.')) { const [a, b] = f.split('.'); d[a] = d[a] || {}; d[a][b] = v; }
    else {
      if (f === 'city') retitle(d, d.city, v, el.form);
      if (f === 'title') d._titleTouched = true;
      d[f] = v;
    }
    if (f === 'arrive.by' || f === 'depart.by') {
      const [dir] = f.split('.'), t = d[dir], key = dir === 'arrive' ? 'from' : 'to', code = /^[A-Z]{3,4}$/.test(t[key] || '');
      if (v === 'flight' && !code) t[key] = '';
      else if (v !== 'flight' && (code || !t[key])) t[key] = 'กรุงเทพฯ';
      delete t.time; delete t.choice; delete t.auto;
      if (v === 'drive') d.hasCar = true;
      return true;
    }
    if (f === 'stay.mode') { if (v === 'booked') stayRows(d); return true; }
    if (f === 'arrive.auto' || f === 'depart.auto') { if (!v) delete d[f.split('.')[0]].choice; return true; }
    if (f === 'startDate' || f === 'endDate') {
      const en = el.form && el.form.querySelector('#f-end');
      if (f === 'startDate' && en) { en.min = v; if (!d.endDate || spanDays(v, d.endDate) < 1) { d.endDate = endOf(v, d.days || 1); en.value = d.endDate; } }
      const n = spanDays(d.startDate, d.endDate); if (n >= 1 && n <= MAX_DAYS) d.days = n;
      const o = el.form && el.form.querySelector('#f-nights'); if (o) { o.textContent = nightsLine(d); o.classList.toggle('bad', !(n >= 1 && n <= MAX_DAYS)); }
      // the booked-stay rows depend on the number of nights: redraw that block only (focus stays on the date input)
      const sb = el.form && el.form.querySelector('#f-stay'); if (sb && d.stay && d.stay.mode === 'booked') sb.outerHTML = stayBlock(d);
    }
    if (f === 'city') {
      const setC = c => { d.country = c ? c[1] : ''; d.currency = c ? c[2] : '';
        const h = el.form && el.form.querySelector('#f-cityhint'); if (h) h.textContent = cityHint(v); };
      setC(cityTuple(v));
      if (!cityTuple(v) && v.trim().length >= 2) {
        clearTimeout(cityT);
        cityT = setTimeout(async () => { const c = await lookupCity(v); if (c && d.city === v) setC(c); }, 500);
      }
    }
    return false;
  }
  if (k) {
    const row = el.closest('[data-mid]'); if (!row) return false;
    const m = d.members.find(x => x.id === row.dataset.mid); if (!m) return false;
    if (k === 'role') { d.members.forEach(x => { if (x.role === 'organizer') delete x.role; }); m.role = 'organizer'; return false; }
    if (k === 'avoid') { m.avoid = el.value; delete m.veg; }
    else if (k === 'maxWalkKm' || k === 'budget') m[k] = el.value === '' ? undefined : +el.value;
    else if (k === 'wants') m.wants = el.value.split('\n');
    else m[k] = el.value;
    if (k === 'name') { const av = row.querySelector('.av'); if (av) av.textContent = initials(el.value); }
  }
  return false;
}
export function addMember(d, name) {
  let n = d.members.length + 1, id;
  do { id = 'm' + n++; } while (d.members.some(m => m.id === id));
  d.members.push({ id, name: name.trim() });
  return id;
}
