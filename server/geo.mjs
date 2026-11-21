// Geocoding (Photon -> Nominatim) and road routing (OSRM -> Valhalla -> straight line), no API keys.
// Every provider has a circuit breaker (10 min after repeated failures) and results persist in server/.cache/,
// so repeated demos hit no network at all.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { legKey, OSRM_PROFILE, haversine, allLegs } from '../src/plan.js';

const UA = 'Bop/0.1 (group-travel agent demo app)';
const PHOTON = 'https://photon.komoot.io/api/';
const OSRM = 'https://routing.openstreetmap.de';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CITY = new Map(); // city -> { ll, cc, name }

/* ---------- persistent cache (server/.cache locally; /tmp in Lambda Web Functions) ---------- */
function directoryUrl(configured) {
  const absolute = path.resolve(configured || path.join(process.cwd(), 'server/.cache')) + path.sep;
  return pathToFileURL(absolute);
}
const CACHE_DIR = directoryUrl(process.env.BOP_CACHE_DIR);
export function loadJson(name) { try { return JSON.parse(readFileSync(new URL(name, CACHE_DIR), 'utf8')); } catch { return {}; } }
const saveTimers = {}, pending = {};
function writeNow(name) {
  const obj = pending[name]; if (!obj) return;
  delete pending[name]; clearTimeout(saveTimers[name]);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = new URL(name + '.tmp', CACHE_DIR);
    writeFileSync(tmp, JSON.stringify(obj)); renameSync(tmp, new URL(name, CACHE_DIR));
  } catch (e) { console.warn('[bop] cache write failed:', e.message); }
}
export function saveJson(name, obj) {
  pending[name] = obj; clearTimeout(saveTimers[name]);
  saveTimers[name] = setTimeout(() => writeNow(name), 500);
  saveTimers[name].unref?.();
}
process.on('exit', () => Object.keys(pending).forEach(writeNow)); // flush on shutdown / end of a script
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { Object.keys(pending).forEach(writeNow); if (!process.listenerCount(sig)) process.exit(0); });
let seed = {};
try { seed = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/routes.json'), 'utf8')); } catch { /* optional */ }
const routeDisk = { ...seed, ...loadJson('routes.json') };          // legKey -> { dur, dist, geom, via }
const geoDisk = loadJson('geocode.json');                           // query|lat,lng -> { lat, lng, source:'geocoded', osmName }
const cityDisk = loadJson('cities.json');                           // city -> { ll, cc, name }
const ROUTES = new Map(Object.entries(routeDisk));
const GEO = new Map(Object.entries(geoDisk));
for (const [k, v] of Object.entries(cityDisk)) CITY.set(k, v);
const remember = (map, disk, file, k, v) => { map.set(k, v); disk[k] = v; saveJson(file, disk); };

/* ---------- circuit breakers ---------- */
const BREAK = { osrm: 0, valhalla: 0, photon: 0, nominatim: 0 }, FAILS = { osrm: 0, valhalla: 0, photon: 0, nominatim: 0 };
const up = name => Date.now() >= BREAK[name];
function failed(name, e) {
  // refused/timeout/429/5xx: two in a row trips the breaker for 10 minutes
  if (++FAILS[name] >= 2 || /HTTP 429/.test(e && e.message)) { BREAK[name] = Date.now() + 10 * 60_000; FAILS[name] = 0; console.warn(`[bop] ${name} unavailable, skipping for 10 min (${e && e.message})`); }
}
const ok = name => { FAILS[name] = 0; };
export const providerStatus = () => Object.fromEntries(Object.keys(BREAK).map(k => [k, up(k) ? 'up' : 'down']));

export async function fetchJson(url, { timeout = 8000, signal } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
}

/** Run `fn` over items with at most `n` in flight. */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const BAD_KEYS = new Set(['highway', 'place', 'boundary', 'landuse', 'railway', 'power', 'natural:peak']);

async function photon(q, bias, signal) {
  const u = new URL(PHOTON);
  u.searchParams.set('q', q); u.searchParams.set('limit', '4');
  if (bias) { u.searchParams.set('lat', bias[0]); u.searchParams.set('lon', bias[1]); }
  const j = await fetchJson(u, { timeout: 6000, signal });
  return (j.features || []).map(f => ({
    ll: [+f.geometry.coordinates[1].toFixed(5), +f.geometry.coordinates[0].toFixed(5)],
    name: f.properties.name || '', key: f.properties.osm_key, value: f.properties.osm_value,
  }));
}

/**
 * Geocode the trip's city once (Nominatim handles Thai names of foreign cities, e.g. "โตเกียว"; Photon does not).
 * Returns { ll: [lat,lng], cc: 'JP', name: 'Tokyo' } or null. Every place search is then biased to `ll`.
 */
export async function cityInfo(city, signal) {
  const k = String(city || '').trim().toLowerCase();
  if (!k) return null;
  if (CITY.has(k)) return CITY.get(k);
  let info = null;
  if (up('nominatim')) try {
    const u = new URL(NOMINATIM);
    for (const [a, b] of Object.entries({ q: city, format: 'jsonv2', limit: '1', addressdetails: '1', 'accept-language': 'en' })) u.searchParams.set(a, b);
    const r = (await fetchJson(u, { timeout: 6000, signal }))[0];
    if (r) info = { ll: [+(+r.lat).toFixed(5), +(+r.lon).toFixed(5)], cc: String(r.address && r.address.country_code || '').toUpperCase(),
      name: r.name || (r.address && (r.address.city || r.address.state)) || city };
    ok('nominatim');
  } catch (e) { if (signal?.aborted) throw e; failed('nominatim', e); }
  if (!info && up('photon')) {
    try {
      const r = (await photon(city, null, signal)).find(x => x.key === 'place' || x.key === 'boundary');
      if (r) info = { ll: r.ll, cc: '', name: city };
      ok('photon');
    } catch (e) { if (signal?.aborted) throw e; failed('photon', e); }
  }
  if (info) remember(CITY, cityDisk, 'cities.json', k, info);
  return info;
}
export const cityCenter = async (city, signal) => (await cityInfo(city, signal))?.ll || null;

/**
 * Resolve one stop spec in place: sets spec.lat/lng and spec.source ('catalog' | 'geocoded' | 'model').
 * A Photon hit is accepted only if it is a real POI within `maxKm` of the model's own coordinates
 * (or of the city centre when the model gave none). Otherwise the model's coordinates stand.
 */
// Nominatim fallback when Photon is unreachable. Usage policy: max 1 request/second, so calls are serialized.
let nomChain = Promise.resolve();
async function nominatimPlace(q, anchor, signal) {
  const run = nomChain.then(async () => {
    const u = new URL(NOMINATIM);
    const p = { q, format: 'jsonv2', limit: '4' };
    if (anchor) { const d = 0.3; p.viewbox = `${anchor[1] - d},${anchor[0] + d},${anchor[1] + d},${anchor[0] - d}`; p.bounded = '1'; }
    for (const [a, b] of Object.entries(p)) u.searchParams.set(a, b);
    try { return (await fetchJson(u, { timeout: 6000, signal })).map(r => ({ ll: [+(+r.lat).toFixed(5), +(+r.lon).toFixed(5)], name: r.name || '', key: r.category, value: r.type })); }
    finally { await new Promise(r => setTimeout(r, 1100)); }
  });
  nomChain = run.catch(() => {});
  return run;
}

export async function resolveSpec(spec, { center, signal, maxKm = 3, budget } = {}) {
  if (spec.catalog) { spec.source = 'catalog'; return spec; }
  if (spec.pinned && (spec.lat || spec.lng)) { spec.source = 'pick'; return spec; } // coordinates the group already picked
  const model = (spec.lat || spec.lng) ? [spec.lat, spec.lng] : null;
  const q = String(spec.query || spec.n || '').trim();
  const ck = `${q}|${model ? model.map(x => x.toFixed(2)).join(',') : ''}`;
  if (GEO.has(ck)) { Object.assign(spec, await GEO.get(ck)); return spec; }
  const p = lookup(q, model, center, signal, maxKm, budget);
  GEO.set(ck, p); // in-flight dedupe
  try {
    const g = await p; Object.assign(spec, g);
    // Persist real hits, and "searched but no match" answers (so demos don't re-ask); never outage fallbacks.
    if (g.source === 'geocoded' || g.answered) remember(GEO, geoDisk, 'geocode.json', ck, g);
    else GEO.delete(ck);
  } catch (e) { GEO.delete(ck); throw e; }
  return spec;
}
async function lookup(q, model, center, signal, maxKm, budget) {
  let hit = null, answered = false;
  if (q) {
    try {
      const anchor = model || center;
      const pick = cands => (cands || []).find(c => !BAD_KEYS.has(c.key) && !BAD_KEYS.has(`${c.key}:${c.value}`) &&
        (!anchor || haversine(anchor, c.ll) <= (model ? maxKm : 40)));
      if (up('photon')) {
        try { const c = await photon(q, anchor, signal); ok('photon'); answered = true; hit = pick(c); }
        catch (e) { if (signal?.aborted) throw e; failed('photon', e); }
      }
      // Photon down, or nothing acceptable: ask Nominatim (1 req/s, capped per request)
      if (!hit && up('nominatim') && budget && budget.nominatim-- > 0) {
        try { const c = await nominatimPlace(q, anchor, signal); ok('nominatim'); answered = true; hit = pick(c); }
        catch (e) { if (signal?.aborted) throw e; failed('nominatim', e); }
      }
    } catch { /* network / rate limit: keep model coordinates */ }
  }
  const g = hit ? { lat: hit.ll[0], lng: hit.ll[1], source: 'geocoded', osmName: hit.name }
    : model ? { lat: model[0], lng: model[1], source: 'model', ...(answered ? { answered: true } : {}) }
    : center ? { lat: center[0], lng: center[1], source: 'model' } : { source: 'model' };
  return g;
}

export async function resolveSpecs(specs, opts) {
  const budget = { nominatim: 8 };
  await pool(specs, 4, s => resolveSpec(s, { ...opts, budget }));
  const by = { catalog: 0, geocoded: 0, model: 0, pick: 0 };
  specs.forEach(s => { by[s.source] = (by[s.source] || 0) + 1; });
  return by;
}

/* ---------- routing: OSRM -> Valhalla -> straight line ---------- */
async function osrm(l, signal) {
  const url = `${OSRM}/${OSRM_PROFILE[l.m] || 'routed-car'}/route/v1/driving/${l.a[1]},${l.a[0]};${l.b[1]},${l.b[0]}?overview=full&geometries=geojson`;
  const j = await fetchJson(url, { timeout: 8000, signal });
  const r = j.routes && j.routes[0];
  if (!r) return null;
  return { dur: Math.round(r.duration), dist: Math.round(r.distance), via: 'osrm',
    geom: r.geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) };
}
/** Decode an encoded polyline (Valhalla uses precision 6) to [[lng,lat],...]. */
export function decodePolyline(str, precision = 6) {
  const f = 10 ** precision, out = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (which === 0) lat += d; else lng += d;
    }
    out.push([+(lng / f).toFixed(5), +(lat / f).toFixed(5)]);
  }
  return out;
}
async function valhalla(l, signal) {
  const body = { locations: [{ lat: l.a[0], lon: l.a[1] }, { lat: l.b[0], lon: l.b[1] }], costing: l.m === 'walk' ? 'pedestrian' : 'auto', units: 'kilometers', directions_type: 'none' };
  const u = new URL(VALHALLA); u.searchParams.set('json', JSON.stringify(body));
  const j = await fetchJson(u, { timeout: 10000, signal });
  const t = j.trip; if (!t || !t.summary) return null;
  const geom = (t.legs || []).flatMap(x => decodePolyline(x.shape || '', 6));
  return { dur: Math.round(t.summary.time), dist: Math.round(t.summary.length * 1000), via: 'valhalla', geom };
}
const PROVIDERS = [['osrm', osrm], ['valhalla', valhalla]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function routeLeg(l, signal) {
  for (const [name, fn] of PROVIDERS) {
    if (!up(name)) continue;
    try { const r = await fn(l, signal); ok(name); if (r && r.geom.length >= 2) return r; }
    catch (e) { if (signal?.aborted) throw e; failed(name, e); }
  }
  return null;
}

/** Route every missing leg of the given plans (3 at a time, 120 ms gap per worker: FOSSGIS servers are shared). */
export async function routePlans(plans, { signal } = {}) {
  const need = new Map();
  for (const p of plans) for (const l of allLegs(p)) need.set(legKey(l.a, l.b, l.m), l);
  const todo = [...need].filter(([k]) => !ROUTES.has(k));
  let failedN = 0;
  const via = {};
  await pool(todo, 3, async ([k, l]) => {
    const r = await routeLeg(l, signal);
    if (r) { remember(ROUTES, routeDisk, 'routes.json', k, r); via[r.via] = (via[r.via] || 0) + 1; } else failedN++;
    await sleep(120);
  });
  const routes = {};
  for (const [k, l] of need) {
    if (ROUTES.has(k)) routes[k] = ROUTES.get(k);
    // no router reachable: a straight line so the map can still draw the leg (not cached; schedule() keeps its estimate)
    else routes[k] = { geom: [[l.a[1], l.a[0]], [l.b[1], l.b[0]]], approx: true };
  }
  return { routes, total: need.size, cached: need.size - todo.length, fetched: todo.length - failedN, failed: failedN, via };
}

/** Geometry-only view for the client (API.md: routes: Record<key, {geom}>). */
export const geomOnly = routes => Object.fromEntries(Object.entries(routes).map(([k, r]) => [k, r.approx ? { geom: r.geom, approx: true } : { geom: r.geom }]));
