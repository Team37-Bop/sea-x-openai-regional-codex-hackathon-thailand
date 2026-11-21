import { cities, coordinates, distance } from './domain.mjs';

const cache = new Map();
const blockedUntil = new Map();
const pendingWeather = new Map();
const forecastCache = new Map();
let weatherFailures = 0;
let weatherBlockedUntil = 0;
async function lookup(url, signal, ttl = 900_000) {
  const old = cache.get(url.href);
  if (old && old.until > Date.now()) return old.value;
  if ((blockedUntil.get(url.host) ?? 0) > Date.now()) return null;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'BopTripPlanner/1.0 (group itinerary planner)' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(3500)]),
    });
    if (!response.ok) throw new Error('Upstream ' + response.status);
    const value = await response.json();
    if (cache.size >= 1500) cache.delete(cache.keys().next().value);
    cache.set(url.href, { value, until: Date.now() + ttl });
    return value;
  } catch (error) {
    signal.throwIfAborted();
    blockedUntil.set(url.host, Date.now() + 60_000);
    return null;
  }
}
function query(address, params) {
  const url = new URL(address);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}
async function photon(name, signal) {
  const result = await lookup(query('https://photon.komoot.io/api/', { q: name, limit: 5 }), signal);
  return (result?.features ?? []).map(feature => ({
    name: feature.properties.name, cc: feature.properties.countrycode,
    ll: feature.geometry.coordinates.slice(0, 2).reverse(), kind: feature.properties.osm_key,
  }));
}
async function nominatim(name, signal) {
  const result = await lookup(query('https://nominatim.openstreetmap.org/search', {
    q: name, limit: 5, format: 'jsonv2', addressdetails: 1,
  }), signal);
  return (result ?? []).map(hit => ({
    name: hit.name, cc: hit.address?.country_code?.toUpperCase(), ll: [+hit.lat, +hit.lon], kind: hit.category,
  }));
}
export async function findCity(name, signal) {
  if (Object.hasOwn(cities, name)) return { name, ...cities[name] };
  for (const search of [nominatim, photon]) {
    const hit = (await search(name, signal)).find(item => coordinates(item.ll) && !['highway', 'landuse'].includes(item.kind));
    if (hit) return { name: hit.name || name, cc: hit.cc ?? '', ll: hit.ll };
  }
  return null;
}
export async function findPlace(name, center, radius, signal) {
  for (const search of [photon, nominatim]) {
    const hit = (await search(name, signal)).find(item => coordinates(item.ll)
      && !['highway', 'boundary', 'landuse'].includes(item.kind) && distance(center, item.ll) <= radius);
    if (hit) return hit.ll;
  }
  return null;
}
export async function route(from, to, mode, signal, offline = false) {
  const km = distance(from, to);
  const fallback = { geometry: [from, to], km, min: Math.ceil(km * (mode === 'walk' ? 14 : 3)), real: false };
  if (offline || km < .02) return fallback;
  const walk = mode === 'walk';
  const pair = [from, to].map(ll => [...ll].reverse().join(',')).join(';');
  const osrm = await lookup(query(
    'https://routing.openstreetmap.de/routed-' + (walk ? 'foot' : 'car') + '/route/v1/' + (walk ? 'foot' : 'driving') + '/' + pair,
    { overview: 'full', geometries: 'geojson' },
  ), signal);
  const road = osrm?.routes?.[0];
  if (road) return { geometry: road.geometry.coordinates.map(ll => [...ll].reverse()), km: road.distance / 1000, min: Math.ceil(road.duration / 60), real: true };
  const valhalla = await lookup(query('https://valhalla1.openstreetmap.de/route', { json: JSON.stringify({
    locations: [from, to].map(([lat, lon]) => ({ lat, lon })), costing: walk ? 'pedestrian' : 'auto', shape_format: 'geojson',
  }) }), signal);
  const trip = valhalla?.trip;
  const shape = trip?.legs?.[0]?.shape;
  if (shape?.coordinates) return {
    geometry: shape.coordinates.map(ll => [...ll].reverse()), km: trip.summary.length,
    min: Math.ceil(trip.summary.time / 60), real: true,
  };
  return fallback;
}
async function forecast(latitude, longitude, date, today, signal) {
  const id = latitude + ',' + longitude + '|' + date;
  const hit = forecastCache.get(id);
  if (hit?.until > Date.now()) return hit.data;
  if (pendingWeather.has(id)) return pendingWeather.get(id);
  if (weatherBlockedUntil > Date.now()) return null;
  const task = (async () => {
    const key = process.env.OPEN_METEO_API_KEY;
    const url = query(key ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast',
      { latitude, longitude, timezone: 'auto', hourly: 'precipitation,precipitation_probability',
        start_date: date, end_date: date, ...(key ? { apikey: key } : {}) });
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]) });
      if (response.status === 429) weatherBlockedUntil = Date.now() + 600_000;
      if (!response.ok) throw new Error('Unavailable forecast');
      const data = (await response.json()).hourly;
      if (!data) throw new Error('Missing hourly data');
      weatherFailures = 0;
      if (forecastCache.size >= 1000) forecastCache.delete(forecastCache.keys().next().value);
      forecastCache.set(id, { data, until: Date.now() + (Date.parse(date) - Date.parse(today) <= 172_800_000 ? 3600000 : 10800000) });
      return data;
    } catch {
      signal.throwIfAborted();
      if (++weatherFailures >= 2) {
        weatherBlockedUntil = Date.now() + 600_000;
        weatherFailures = 0;
      }
      return null;
    }
  })();
  pendingWeather.set(id, task);
  try { return await task; } finally { pendingWeather.delete(id); }
}
export async function weather(plan, signal, today = new Date().toISOString().slice(0, 10)) {
  const alerts = [];
  const end = new Date(Date.parse(today) + 15 * 86_400_000).toISOString().slice(0, 10);
  const exposed = (plan.days ?? []).flatMap((day, index) => day.stops.filter(stop =>
    coordinates(stop.ll) && (['nature', 'view'].includes(stop.kind) || stop.outdoor === true))
    .map(stop => ({ day, index, stop })));
  const inRange = exposed.filter(({ day }) => today <= day.date && day.date <= end);
  let succeeded = 0;
  await Promise.all(inRange.map(async ({ day, index, stop }) => {
    const [latitude, longitude] = stop.ll.map(value => value.toFixed(2));
    const data = await forecast(latitude, longitude, day.date, today, signal);
    if (!data) return;
    succeeded++;
    const hours = data.time.flatMap((time, i) => {
      const hh = time.slice(11);
      const nextHour = String(Number(hh.slice(0, 2)) + 1).padStart(2, '0') + ':00';
      if (!time.startsWith(day.date) || hh >= stop.end || nextHour <= stop.start) return [];
      const mm = data.precipitation[i];
      const prob = data.precipitation_probability[i];
      const heavy = mm >= 2.5 || (mm >= 1 && prob >= 70);
      return heavy || (prob >= 50 && mm >= .5) ? [{ hh, end: nextHour, mm, prob, heavy }] : [];
    });
    if (hours.length) {
      alerts.push({
        stopId: stop.id, n: stop.name, day: index, date: day.date,
        level: hours.some(hour => hour.heavy) ? 'heavy' : 'likely',
        from: hours[0].hh, to: hours.at(-1).end, mm: Math.max(...hours.map(hour => hour.mm)), prob: Math.max(...hours.map(hour => hour.prob)),
        trend: Date.parse(day.date) - Date.parse(today) > 3 * 86_400_000, source: 'open-meteo', fetchedAt: new Date().toISOString(),
      });
    }
  }));
  const reason = inRange.length && !succeeded ? 'unavailable' : exposed.length && !inRange.length ? 'beyond_horizon' : undefined;
  return { alerts: alerts.sort((a, b) => a.day - b.day || a.from.localeCompare(b.from)), reason, horizon: { from: today, to: end } };
}
