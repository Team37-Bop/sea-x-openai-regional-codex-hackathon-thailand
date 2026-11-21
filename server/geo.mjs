import { addressedBranch, numberedStreet, plainAddress } from './place-text.mjs';
import { legKey, routeResult } from './route-result.mjs';
import { isScheduledService } from '../web/leg-modes.js';
export { legKey };
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { cities, coordinates, distance } from './domain.mjs';
export { weather } from './weather.mjs';

const dir = process.env.BOP_CACHE_DIR || fileURLToPath(new URL('./.cache', import.meta.url));
const data = { routes: new Map(), cities: new Map(), geocode: new Map() },
  timers = new Map(),
  writes = new Map();
async function loadFile(path, into) {
  try {
    for (const [key, value] of Object.entries(JSON.parse(await readFile(path, 'utf8')))) into.set(key, value);
  } catch {}
}
const ready = (async () => {
  const seed = process.env.LAMBDA_TASK_ROOT
    ? join(process.env.LAMBDA_TASK_ROOT, 'src', 'routes.json')
    : fileURLToPath(new URL('../src/routes.json', import.meta.url));
  await loadFile(seed, data.routes);
  await Promise.all(Object.entries(data).map(([name, into]) => loadFile(join(dir, name + '.json'), into)));
})();
function save(bucket, key, value) {
  const map = data[bucket];
  if (map.size >= 12000) map.delete(map.keys().next().value);
  map.set(key, value);
  clearTimeout(timers.get(bucket));
  timers.set(
    bucket,
    setTimeout(() => {
      const write = async () => {
        const tmp = join(dir, bucket + '.' + crypto.randomUUID() + '.tmp');
        try {
          await mkdir(dir, { recursive: true });
          await writeFile(tmp, JSON.stringify(Object.fromEntries(map)));
          await rename(tmp, join(dir, bucket + '.json'));
        } catch (error) {
          console.warn('Bop cache:', error.message);
        }
      };
      writes.set(bucket, (writes.get(bucket) ?? Promise.resolve()).then(write));
    }, 500).unref(),
  );
}
const active = new Map(),
  breakers = new Map();
function once(key, signal, work) {
  const running = active.get(key);
  if (running && !running.signal.aborted) {
    return running.task.catch((error) => {
      if (running.signal.aborted && !signal.aborted) return once(key, signal, work);
      throw error;
    });
  }
  signal.throwIfAborted();
  const task = work().finally(() => {
    if (active.get(key)?.task === task) active.delete(key);
  });
  active.set(key, { signal, task });
  return task;
}
function queue(width, gap) {
  const pending = [];
  let used = 0;
  function start() {
    while (used < width && pending.length) {
      const { work, resolve, reject } = pending.shift();
      used++;
      Promise.resolve()
        .then(work)
        .then(resolve, reject)
        .finally(async () => {
          if (gap) await delay(gap);
          used--;
          start();
        });
    }
  }
  return (work) =>
    new Promise((resolve, reject) => {
      pending.push({ work, resolve, reject });
      start();
    });
}
const osmQueue = queue(1, 1100),
  routeQueue = queue(3, 120);
function query(address, params) {
  const url = new URL(address);
  for (const [key, value] of Object.entries(params))
    if (value != null) url.searchParams.set(key, String(value));
  return url;
}
async function lookup(url, signal) {
  signal.throwIfAborted();
  if (!breakers.has(url.host)) breakers.set(url.host, { count: 0, until: 0 });
  const breaker = breakers.get(url.host);
  if (breaker.until > Date.now()) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BopTripPlanner/1.0 (group itinerary planner)', 'Accept-Language': 'en' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(3500)]),
    });
    if (res.status === 429) breaker.until = Date.now() + 600_000;
    if (!res.ok) throw new Error('Upstream ' + res.status);
    const json = await res.json();
    breaker.count = 0;
    breaker.until = 0;
    return json;
  } catch {
    signal.throwIfAborted();
    if (++breaker.count >= 2) {
      breaker.until = Date.now() + 600_000;
      breaker.count = 0;
    }
    breakers.set(url.host, breaker);
    return null;
  }
}
async function photon(name, signal, center) {
  const result = await lookup(
    query('https://photon.komoot.io/api/', { q: name, limit: 5, lat: center?.[0], lon: center?.[1] }),
    signal,
  );
  return (
    result?.features?.map((f) => ({
      name: f.properties?.name,
      street: f.properties?.street,
      number: f.properties?.housenumber,
      cc: f.properties?.countrycode,
      kind: f.properties?.osm_key,
      type: f.properties?.osm_value,
      ll: f.geometry?.coordinates?.slice(0, 2).reverse(),
    })) ?? null
  );
}
async function nominatim(name, signal, limit = 5, center, radius, extended = false) {
  let viewbox;
  if (center) {
    const [lat, lon] = center;
    const dy = radius / 110;
    const dx = dy / Math.max(0.01, Math.cos(lat * Math.PI / 180));
    if (lon - dx >= -180 && lon + dx <= 180)
      viewbox = [lon - dx, Math.min(90, lat + dy), lon + dx, Math.max(-90, lat - dy)].join(',');
  }
  const result = await osmQueue(() =>
    lookup(
      query('https://nominatim.openstreetmap.org/search', {
        q: name,
        limit,
        format: 'jsonv2',
        ...(viewbox ? { viewbox, bounded: 1 } : {}),
        addressdetails: 1,
        ...(extended && { extratags: 1 }),
        'accept-language': 'en',
      }),
      signal,
    ),
  );
  return Array.isArray(result)
    ? result.map((h) => ({
        name: h.name || h.display_name?.split(',')[0],
        street: h.address?.road || h.address?.pedestrian,
        number: h.address?.house_number,
        site: h.extratags?.website || h.extratags?.['contact:website'],
        cc: h.address?.country_code?.toUpperCase(),
        ll: [Number(h.lat), Number(h.lon)],
        kind: h.category ?? h.class,
        type: h.type,
      }))
    : null;
}
export async function findCity(name, signal = new AbortController().signal) {
  await ready;
  const key = name.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(cities, key)) return { name: key, ...cities[key] };
  if (data.cities.has(key)) return data.cities.get(key);
  return once('city:' + key, signal, async () => {
    const h =
      (await nominatim(name, signal, 1))?.find((x) => coordinates(x.ll)) ??
      (await photon(name, signal))?.find((x) => coordinates(x.ll) && ['place', 'boundary'].includes(x.kind));
    if (!h) return null;
    const value = { name: h.name || name, cc: h.cc?.toUpperCase() || '', ll: h.ll };
    save('cities', key, value);
    return value;
  });
}
const realPoi = (h) =>
  coordinates(h.ll) &&
  !['highway', 'boundary', 'landuse', 'railway', 'power'].includes(h.kind) &&
  (h.kind !== 'place' || h.type === 'square') &&
  !(h.kind === 'natural' && h.type === 'peak');
const placeKey = (name, center, radius) => [name.trim().toLowerCase(), center.map(v => v.toFixed(2)), radius].join('|');
export async function findPlace(name, center, radius = 3, signal = new AbortController().signal, batch) {
  if (!name?.trim() || !coordinates(center)) return null;
  await ready;
  const key = placeKey(name, center, radius);
  const cached = data.geocode.get(key);
  if (coordinates(cached)) return cached;
  return once('poi:' + key, signal, async () => {
    const acceptable = (h) => realPoi(h) && distance(center, h.ll) <= radius;
    const primary = await photon(name, signal, center);
    let hit = primary?.find(acceptable);
    let secondary = null;
    if (!hit && (!batch || batch.remaining > 0)) {
      if (batch) batch.remaining--;
      secondary = await nominatim(name, signal, 5, center, radius);
      hit = secondary?.find(acceptable);
    }
    if (hit) save('geocode', key, hit.ll);
    return hit?.ll ?? null;
  });
}

const verifiedKey = (stop, center) =>
  (stop.kind === 'hotel' ? 'verified-hotel|' : 'verified|') + plainAddress(stop.query) + '|' + center.map(n => n.toFixed(3));
export async function brandOnlyPosition(stop, center) {
  if (stop.pinned || stop.place?.source !== 'geocoded' || !coordinates(stop.ll) || !coordinates(center)) return false;
  const brand = addressedBranch(stop);
  if (!brand) return false;
  await ready;
  const matches = cached => coordinates(cached) && cached[0] === stop.ll[0] && cached[1] === stop.ll[1];
  return !matches(data.geocode.get(verifiedKey(stop, center))) && matches(data.geocode.get(placeKey(brand, center, 40)));
}
// A business may be listed without the generic suffix used in the itinerary.
const venueSuffix = /\s+(?:café|cafe|kitchen|restaurant|hotel|hostel|bar)$/i;
export async function findSavedVenue(stop, center, signal, budget) {
  if (!coordinates(center) || typeof stop.query !== 'string' || !stop.query.trim()) return null;
  const parts = stop.query.split(',').map(part => part.trim()).filter(Boolean);
  const full = (parts[0] || '').split(/\s+[—–]\s+/)[0];
  const streetAddress = numberedStreet(parts);
  const short = full.replace(venueSuffix, '');
  if (!full || (!streetAddress && plainAddress(full).split(' ').length < 2)) return null;
  const hotel = stop.kind === 'hotel';
  const key = verifiedKey(stop, center);
  await ready;
  const cached = data.geocode.get(key);
  if (coordinates(cached)) return cached;
  const brand = addressedBranch(stop);
  const terms = new Set();
  if (streetAddress) {
    terms.add(short + ', ' + streetAddress[2]);
    if (brand) terms.add(brand + ', ' + streetAddress[0]);
  }
  terms.add(full);
  const expected = plainAddress(full);
  const display = plainAddress((stop.name || stop.n || '').split(/\s+[—–]\s+/)[0]);
  const branch = display.startsWith(expected + ' ') ? display.slice(expected.length + 1) : '';
  function branchWebsite(url) {
    if (!url || branch.split(' ').length < 2) return false;
    try {
      const path = plainAddress(decodeURIComponent(new URL(url).pathname));
      return (' ' + path + ' ').includes(' ' + branch + ' ');
    } catch { return false; }
  }
  function select(hits) {
    const identities = (hits || []).filter(hit => {
      if (!realPoi(hit) || distance(center, hit.ll) > 40) return false;
      if (hotel && !['hotel', 'hostel', 'motel', 'guest_house', 'resort', 'apartment', 'chalet', 'lodging'].includes(hit.type)) return false;
      const name = plainAddress(hit.name), exact = name === expected;
      if (!streetAddress) return exact;
      return (exact || name === plainAddress(short) || (brand && name === plainAddress(brand))) &&
        (hit.number ? plainAddress(hit.number).replaceAll(' ', '') === plainAddress(streetAddress[1]).replaceAll(' ', '') : exact && branchWebsite(hit.site)) &&
        plainAddress(hit.street) === plainAddress(streetAddress[2]);
    });
    const first = identities[0];
    return first && identities.every(hit => distance(first.ll, hit.ll) < 0.12) ? first.ll : null;
  }
  return once(key, signal, async () => {
    for (const term of terms) {
      let ll = select(await photon(term, signal, center));
      if (!ll && budget.remaining > 0) {
        budget.remaining--;
        ll = select(await nominatim(term, signal, 5, center, 40, true));
      }
      if (ll) { save('geocode', key, ll); return ll; }
    }
    return null;
  });
}

function decodeShape(encoded) {
  let offset = 0,
    lat = 0,
    lng = 0;
  const points = [];
  function unit() {
    let bit = 0,
      value = 0;
    while (offset < encoded.length && bit < 32) {
      const byte = encoded.charCodeAt(offset++) - 63;
      value |= (byte & 31) << bit;
      bit += 5;
      if (byte < 32) return value & 1 ? ~(value >> 1) : value >> 1;
    }
    throw new Error('Incomplete geometry');
  }
  try {
    while (offset < encoded.length) {
      lat += unit();
      lng += unit();
      points.push([lng / 1e6, lat / 1e6]);
    }
  } catch {
    return [];
  }
  return points;
}
function measure(geom, sec, meters, via) {
  if (
    !Array.isArray(geom) ||
    geom.length < 2 ||
    !geom.every((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite)) ||
    !Number.isFinite(sec) ||
    !Number.isFinite(meters) ||
    sec < 0 ||
    meters < 0
  )
    return null;
  return {
    geom: geom.map((pair) => pair.slice(0, 2).map((v) => Number(v.toFixed(5)))),
    sec: Math.round(sec),
    meters: Math.round(meters),
    via,
  };
}
export async function route(from, to, mode, signal, offline = false, leg = {}) {
  signal.throwIfAborted();
  // Car and foot routers do not know the alignment or stops of a scheduled service.
  if (isScheduledService(mode)) return routeResult(from, to, mode, leg);
  await ready;
  const key = legKey(from, to, mode),
    km = distance(from, to);
  let measured = data.routes.get(key),
    via = measured ? 'cache' : null;
  if (measured?.approx && !offline) measured = null;
  if (!measured && !offline && km >= 0.001) {
    measured = await once('route:' + key, signal, () =>
      routeQueue(async () => {
        const walk = mode === 'walk',
          pair = [from, to].map(([lat, lng]) => lng + ',' + lat).join(';');
        const osrm = await lookup(
          query(
            'https://routing.openstreetmap.de/routed-' +
              (walk ? 'foot' : 'car') +
              '/route/v1/' +
              (walk ? 'foot' : 'driving') +
              '/' +
              pair,
            { overview: 'full', geometries: 'geojson' },
          ),
          signal,
        );
        const first = osrm?.routes?.[0];
        let answer = measure(first?.geometry?.coordinates, first?.duration, first?.distance, 'OSRM');
        if (!answer) {
          const val = await lookup(
            query('https://valhalla1.openstreetmap.de/route', {
              json: JSON.stringify({
                locations: [from, to].map(([lat, lon]) => ({ lat, lon })),
                costing: walk ? 'pedestrian' : 'auto',
                units: 'kilometers',
              }),
            }),
            signal,
          );
          const trip = val?.trip,
            shape = trip?.legs?.[0]?.shape;
          answer = measure(
            typeof shape === 'string' ? decodeShape(shape) : shape?.coordinates,
            trip?.summary?.time,
            trip?.summary?.length * 1000,
            'Valhalla',
          );
        }
        if (answer) save('routes', key, answer);
        return answer;
      }),
    );
    via = measured?.via;
  }
  return routeResult(from, to, mode, leg, measured, via);
}
