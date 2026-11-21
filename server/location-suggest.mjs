import { bad, coordinates, distance } from './domain.mjs';
import { localSuggestions } from '../web/location-suggest.js';

const kinds = new Set(['city', 'transport', 'stay', 'place']);
const hotelTypes = ['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'resort', 'chalet'];
const currencies = {
  TH: 'THB',
  VN: 'VND',
  TW: 'TWD',
  KR: 'KRW',
  JP: 'JPY',
  SG: 'SGD',
  MY: 'MYR',
  LA: 'LAK',
  KH: 'KHR',
  ID: 'IDR',
  CN: 'CNY',
  HK: 'HKD',
  PH: 'PHP',
  IN: 'INR',
  GB: 'GBP',
  US: 'USD',
  AU: 'AUD',
  FR: 'EUR',
  DE: 'EUR',
};
const cache = new Map();
let unavailableUntil = 0;
function safeString(value, size = 120) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, size) : '';
}
function parseFeature(feature, kind) {
  const p = feature?.properties;
  const ll = feature?.geometry?.coordinates;
  if (!p || !Array.isArray(ll) || !coordinates([ll[1], ll[0]])) return;
  const name = safeString(p.name);
  if (!name) return;
  if (
    kind === 'city' &&
    !(p.type === 'city' || ['city', 'town', 'village', 'municipality'].includes(p.osm_value))
  )
    return;
  if (
    kind === 'stay' &&
    !hotelTypes.includes(p.osm_value) &&
    !/โรงแรม|โฮสเทล|รีสอร์ท|เกสต์เฮาส์|hotel|hostel|inn\b|resort|guest\s?house/i.test(name)
  )
    return;
  const airport = safeString(p.extra?.iata ?? p.iata, 3).toUpperCase();
  const isAirport = p.osm_value === 'aerodrome' && /^[A-Z]{3}$/.test(airport);
  const canonical = isAirport && !name.includes('(' + airport + ')') ? name + ' (' + airport + ')' : name;
  const cc = /^[a-z]{2}$/i.test(p.countrycode) ? p.countrycode.toUpperCase() : '';
  const locality = [p.district, p.city, p.state, p.country]
    .map((v) => safeString(v, 60))
    .filter((v) => v && v !== name);
  return {
    name: canonical,
    ll: [ll[1], ll[0]],
    label: [canonical, ...new Set(locality)].join(' · '),
    cc,
    ...(isAirport ? { airport } : {}),
    ...(currencies[cc] ? { currency: currencies[cc] } : {}),
  };
}
function normalizedKind(kind) {
  const value = kind ?? 'city';
  if (!kinds.has(value)) throw bad('ประเภทสถานที่ไม่ถูกต้อง');
  return value;
}
export async function lookupSuggestions(
  query,
  { kind, city = '', center, signal = new AbortController().signal } = {},
) {
  signal.throwIfAborted();
  kind = normalizedKind(kind);
  if (typeof query !== 'string' || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query))
    throw bad('ชื่อสถานที่ไม่ถูกต้อง');
  if (
    typeof city !== 'string' ||
    city.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(city) ||
    (center != null && !coordinates(center))
  )
    throw bad('เมืองหรือพิกัดไม่ถูกต้อง');
  const q = safeString(query),
    contextCity = safeString(city);
  if (!q) return [];
  const local = localSuggestions(q, { kind, city: contextCity });
  if ([...q].length < 2 || local.length >= 7) return local;
  const nearDestination = kind === 'stay' || kind === 'place';
  const focus = coordinates(center)
    ? center
    : nearDestination && contextCity
      ? localSuggestions(contextCity, { kind: 'city' })[0]?.ll
      : null;
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', nearDestination && contextCity && !focus ? q + ' ' + contextCity : q);
  url.searchParams.set('limit', '10');
  if (kind === 'city') url.searchParams.append('layer', 'city');
  if (kind === 'stay') for (const type of hotelTypes) url.searchParams.append('osm_tag', 'tourism:' + type);
  if (focus) {
    url.searchParams.set('lat', focus[0].toFixed(3));
    url.searchParams.set('lon', focus[1].toFixed(3));
    url.searchParams.set('zoom', kind === 'stay' ? '13' : '8');
  }
  const cacheKey = [kind, contextCity, url.search.toLowerCase()].join('|');
  const hit = cache.get(cacheKey);
  if (hit?.until > Date.now()) return hit.rows;
  if (Date.now() < unavailableUntil) return local;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(3200)]),
      headers: {
        'User-Agent': 'BopTripPlanner/1.0 (location autocomplete)',
        'Accept-Language': /[\u0e00-\u0e7f]/.test(q) ? 'th,en;q=0.7' : 'en',
      },
    });
    if (response.status === 429) unavailableUntil = Date.now() + 60_000;
    if (!response.ok) {
      await response.body?.cancel();
      return local;
    }
    const { features } = await response.json();
    if (!Array.isArray(features)) return local;
    const rows = [...local];
    const remote = features.map((feature) => parseFeature(feature, kind)).filter(Boolean);
    if (nearDestination && focus) remote.sort((a, b) => distance(focus, a.ll) - distance(focus, b.ll));
    for (const item of remote) {
      if (rows.length >= 7) break;
      if (nearDestination && focus && distance(focus, item.ll) > 100) continue;
      if (!rows.some((row) => row.name === item.name && distance(row.ll, item.ll) < 0.8)) rows.push(item);
    }
    signal.throwIfAborted();
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { rows, until: Date.now() + (rows.length ? 600000 : 60000) });
    return rows;
  } catch {
    signal.throwIfAborted();
    return local;
  }
}
