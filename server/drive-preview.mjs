import { bad, cities, clock, coordinates, distance, minutes, normTime, str } from './domain.mjs';
import { findCity, route } from './geo.mjs';

const aliases = new Map([
  ['กรุงเทพ', 'กรุงเทพฯ'],
  ['กรุงเทพมหานคร', 'กรุงเทพฯ'],
  ['กทม', 'กรุงเทพฯ'],
  ['bangkok', 'กรุงเทพฯ'],
  ['krungthep', 'กรุงเทพฯ'],
  ['krungthepmahanakhon', 'กรุงเทพฯ'],
  ['chiangmai', 'เชียงใหม่'],
  ['เมืองเชียงใหม่', 'เชียงใหม่'],
]);

function knownPoint(name) {
  if (Object.hasOwn(cities, name)) return cities[name].ll;
  const key = name
    .toLowerCase()
    .replace(/^(?:จังหวัด|จ\.)\s*/, '')
    .replace(/[\s.ฯ-]+/g, '');
  const city = aliases.get(key) ?? key;
  return Object.hasOwn(cities, city) ? cities[city].ll : null;
}
async function resolvePoint(name, provided, label, signal) {
  if (coordinates(provided)) return provided;
  const local = knownPoint(name);
  if (local) return local;
  const hit = await findCity(name, signal);
  signal.throwIfAborted();
  if (coordinates(hit?.ll)) return hit.ll;
  throw bad('ไม่พบพิกัด' + label + ' “' + name + '” ลองใส่ชื่อเมืองหรือที่อยู่ให้ละเอียดขึ้น');
}

const dayMinutes = 1440;
const localClock = (value) => clock(((value % dayMinutes) + dayMinutes) % dayMinutes);

export async function drivePreview(input, signal = new AbortController().signal) {
  signal.throwIfAborted();
  const dir = input?.dir;
  if (dir !== 'go' && dir !== 'back') throw bad('กรุณาเลือกขาไปหรือขากลับ');
  const city = str(input.city);
  const place = str(input.place);
  const placeLabel = dir === 'go' ? 'จุดเริ่มขับรถ' : 'ปลายทางขากลับ';
  if (!coordinates(input.cityLL) && !city) throw bad('กรุณาใส่เมืองของทริปก่อนคำนวณเวลาขับรถ');
  if (!coordinates(input.placeLL) && !place) throw bad('กรุณาใส่' + placeLabel + ' เช่น ชื่อเมืองหรือที่อยู่');

  const supplied = typeof input.time === 'string' ? input.time.trim() : input.time;
  const anchor = supplied == null || supplied === '' ? (dir === 'go' ? '10:00' : '18:00') : normTime(supplied);
  if (!anchor) throw bad('กรุณาใส่เวลาในรูปแบบ HH:MM');
  const [cityLL, placeLL] = await Promise.all([
    resolvePoint(city, input.cityLL, 'เมืองของทริป', signal),
    resolvePoint(place, input.placeLL, placeLabel, signal),
  ]);
  const [from, to] = dir === 'go' ? [placeLL, cityLL] : [cityLL, placeLL];
  // When neither router has a road measurement, use 30 km/h over the first 20 km
  // and 60 km/h thereafter. Only the straight-line distance is known in that case.
  const directKm = distance(from, to);
  const fallbackMin = Math.ceil(Math.min(directKm, 20) * 2 + Math.max(0, directKm - 20));
  const road = await route(from, to, 'own', signal, false, { min: fallbackMin });
  signal.throwIfAborted();
  const duration = road.min;
  const reference = minutes(anchor);
  const dep = dir === 'go' ? reference - duration : reference;
  const arr = dir === 'back' ? reference + duration : reference;
  const depDayOffset = Math.floor(dep / dayMinutes),
    arrDayOffset = Math.floor(arr / dayMinutes);
  return {
    km: road.km,
    minutes: duration,
    approx: !road.real,
    dep: localClock(dep),
    arr: localClock(arr),
    overnight: depDayOffset !== arrDayOffset,
    depDayOffset,
    arrDayOffset,
    liveTraffic: false,
    includesRest: false,
  };
}
