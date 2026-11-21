// Live rain check for a plan's weather-exposed stops (POST /api/weather-check). No model, no key needed.
// Provider: Open-Meteo hourly forecast (free host; commercial host when OPEN_METEO_API_KEY is set server-side).
// Data CC BY 4.0: the UI must show "ข้อมูลอากาศ: Open-Meteo.com" next to any alert.
import { fetchJson, loadJson, saveJson, pool } from './geo.mjs';
import { tripDay } from '../src/plan.js';

/* Tunable thresholds (mm per hour, % probability). Checked per forecast hour overlapping the stop window. */
export const RAIN = {
  heavy: { mm: 2.5, probMm: 1, prob: 70 },   // any hour >= 2.5 mm, or >= 70 % with >= 1 mm
  likely: { mm: 0.5, prob: 50 },             // >= 50 % with >= 0.5 mm
  horizonDays: 15,                           // today .. today+15 (Open-Meteo gives 16 days)
  trendAfterDays: 3,                         // further out = "แนวโน้ม", no replan offer unless heavy
};
const EXPOSED_KINDS = new Set(['nature', 'view']);
const FILE = 'weather.json';
const PERSIST = process.env.BOP_WEATHER_DISK !== '0';  // tests set 0
const disk = PERSIST ? loadJson(FILE) : {};                 // `lat,lng|date` -> { at, hours: [{ h, mm, prob, code }] }
let breakUntil = 0, fails = 0;
const MIN = 60_000;

const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const localISO = d => new Date(d.getTime() - d.getTimezoneOffset() * MIN).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

/** Stops worth a rain check: outdoor flag, or nature/view kinds, with usable coordinates and times. */
export function exposedStops(plan, setup) {
  const out = [];
  (plan?.days || []).forEach((d, di) => {
    const date = d.date || tripDay(setup?.startDate, di).date;
    (d.stops || []).forEach(s => {
      if (!(s.outdoor || EXPOSED_KINDS.has(s.k))) return;
      const ll = s.ll;
      if (!Array.isArray(ll) || !Number.isFinite(+ll[0]) || !Number.isFinite(+ll[1])) return;
      const a = toMin(s.t0), b = toMin(s.t1);
      if (a == null || b == null || b <= a) return;
      out.push({ stopId: s.id, n: s.n, day: di, date, ll: [+ll[0], +ll[1]], t0: a, t1: b, key: `${(+ll[0]).toFixed(2)},${(+ll[1]).toFixed(2)}` });
    });
  });
  return out;
}

/**
 * Alert for one stop window. Open-Meteo hourly values at time T describe the PRECEDING hour (T-1h .. T),
 * so hour `h` (minutes of its timestamp) covers [h-60, h).
 */
export function rainAlert(hours, t0, t1) {
  let level = null, from = null, to = null, mm = 0, prob = 0;
  for (const x of hours || []) {
    const end = x.h, start = end - 60;
    if (!(start < t1 && end > t0)) continue;
    const m = +x.mm || 0, p = +x.prob || 0;
    const lv = m >= RAIN.heavy.mm || (p >= RAIN.heavy.prob && m >= RAIN.heavy.probMm) ? 'heavy'
      : p >= RAIN.likely.prob && m >= RAIN.likely.mm ? 'likely' : null;
    if (!lv) continue;
    if (lv === 'heavy') level = 'heavy'; else if (!level) level = 'likely';
    from = from == null ? start : Math.min(from, start);
    to = to == null ? end : Math.max(to, end);
    mm = Math.max(mm, m); prob = Math.max(prob, p);
  }
  if (!level) return null;
  return { level, from: hhmm(Math.max(from, 0)), to: hhmm(to), mm: Math.round(mm * 10) / 10, prob };
}

function ttlFor(date, today) { return daysBetween(today, date) <= 2 ? 60 * MIN : 180 * MIN; }

async function fetchGroup(key, dates, signal) {
  const [lat, lng] = key.split(',');
  const k = process.env.OPEN_METEO_API_KEY;
  const host = k ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
  const sorted = [...dates].sort();
  const q = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'auto',
    hourly: 'precipitation,precipitation_probability,weather_code',
    start_date: sorted[0], end_date: addDays(sorted[sorted.length - 1], 1), // +1 day: its 00:00 value closes 23:00-24:00
  });
  if (k) q.set('apikey', k);
  const j = await fetchJson(`${host}/v1/forecast?${q}`, { timeout: 8000, signal });
  const H = j?.hourly;
  if (!H || !Array.isArray(H.time)) throw new Error('bad response');
  const byDate = {};
  H.time.forEach((t, i) => {
    const [date, clock] = String(t).split('T');
    let h = toMin(clock);
    if (h == null) return;
    // 00:00 of the next day closes the last hour (23:00-24:00) of this day
    let d = date;
    if (h === 0) { d = addDays(date, -1); h = 24 * 60; }
    (byDate[d] ||= []).push({ h, mm: H.precipitation?.[i] ?? 0, prob: H.precipitation_probability?.[i] ?? 0, code: H.weather_code?.[i] ?? null });
  });
  return byDate;
}

/** POST /api/weather-check handler. Never throws for provider trouble: returns alerts [] with a reason. */
export async function runWeatherCheck({ setup, plan, emit = () => {}, signal, now = new Date() }) {
  const today = localISO(now), last = addDays(today, RAIN.horizonDays);
  const horizon = { from: today, to: last };
  const done = (alerts, reason, extra = {}) => ({ type: 'done', alerts, horizon, ...(reason ? { reason } : {}), source: 'open-meteo', ...extra });
  const stops = exposedStops(plan, setup);
  if (!stops.length) return done([], 'no_exposed');
  const inRange = stops.filter(s => s.date >= today && s.date <= last);
  if (!inRange.length) return done([], 'beyond_horizon', { checked: 0 });

  // group by rounded coordinates; keep only (key,date) pairs not fresh in cache
  const groups = new Map();
  for (const s of inRange) {
    const c = disk[`${s.key}|${s.date}`];
    if (c && Date.now() - c.at < ttlFor(s.date, today)) continue;
    if (!groups.has(s.key)) groups.set(s.key, new Set());
    groups.get(s.key).add(s.date);
  }
  let failed = 0;
  if (groups.size) {
    if (Date.now() < breakUntil) failed = groups.size;
    else {
      emit(`เช็กพยากรณ์ฝน ${inRange.length} จุดกลางแจ้ง`);
      await pool([...groups], 3, async ([key, dates]) => {
        try {
          const byDate = await fetchGroup(key, dates, signal);
          fails = 0;
          const at = Date.now();
          for (const d of dates) if (byDate[d]) disk[`${key}|${d}`] = { at, hours: byDate[d] };
        } catch (e) {
          failed++;
          if (signal?.aborted) return;
          if (++fails >= 2 || /HTTP 429/.test(e?.message)) { breakUntil = Date.now() + 10 * MIN; fails = 0; console.warn(`[bop] open-meteo unavailable, skipping for 10 min (${e?.message})`); }
        }
      });
      if (PERSIST) saveJson(FILE, disk);
    }
  }

  const alerts = [];
  let missing = 0;
  for (const s of inRange) {
    const c = disk[`${s.key}|${s.date}`];
    if (!c) { missing++; continue; }
    const a = rainAlert(c.hours, s.t0, s.t1);
    if (!a) continue;
    const ahead = daysBetween(today, s.date);
    alerts.push({ stopId: s.stopId, n: s.n, day: s.day, date: s.date, ...a, trend: ahead > RAIN.trendAfterDays, source: 'open-meteo', fetchedAt: new Date(c.at).toISOString() });
  }
  const rank = { heavy: 2, likely: 1 };
  alerts.sort((a, b) => a.day - b.day || rank[b.level] - rank[a.level] || a.from.localeCompare(b.from));
  const reason = missing === inRange.length ? 'unavailable' : inRange.length < stops.length && !alerts.length ? 'partial_horizon' : null;
  return done(alerts, reason, { checked: inRange.length - missing, failed: failed ? true : undefined });
}
