const dayMs = 86_400_000;
export const normTime = (value) =>
  typeof value === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value.trim())
    ? value.trim().padStart(5, '0')
    : '';
export const validTime = (value) => !!normTime(value);
export const minutes = (time) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};
export const clock = (value) => {
  value = Math.min(1439, Math.max(0, Math.round(value)));
  return [Math.floor(value / 60), value % 60].map((number) => String(number).padStart(2, '0')).join(':');
};
export const dateAt = (date, offset) =>
  new Date(Date.parse(date) + offset * dayMs).toISOString().slice(0, 10);
const isDate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  dateAt(value, 0) === value;
export const coordinates = (ll) =>
  Array.isArray(ll) &&
  ll.length === 2 &&
  ll.every(Number.isFinite) &&
  Math.abs(ll[0]) <= 90 &&
  Math.abs(ll[1]) <= 180 &&
  ll.some(Boolean);
export const str = (value, size = 120) => (typeof value === 'string' ? value.trim().slice(0, size) : '');
const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined);
export const bad = (message) => Object.assign(new Error(message), { code: 'bad_request' });
export const estimate = () => ({ url: '', title: '', checked: 'estimate' });
export const cities = {
  เชียงใหม่: { ll: [18.7883, 98.9853], cc: 'TH', currency: 'THB', airport: 'CNX' },
  กรุงเทพฯ: { ll: [13.7563, 100.5018], cc: 'TH', currency: 'THB', airport: 'BKK' },
  ดานัง: { ll: [16.0544, 108.2022], cc: 'VN', currency: 'VND', airport: 'DAD' },
  โตเกียว: { ll: [35.6762, 139.6503], cc: 'JP', currency: 'JPY', airport: 'HND' },
  ไทเป: { ll: [25.033, 121.5654], cc: 'TW', currency: 'TWD', airport: 'TPE' },
  โซล: { ll: [37.5665, 126.978], cc: 'KR', currency: 'KRW', airport: 'ICN' },
};
const modes = ['flight', 'drive', 'bus', 'train', 'undecided'];
const comparable = (value) => str(value, 2048).toLowerCase().split('#')[0].replace(/\/+$/, '');
export function source(value, verified = new Set()) {
  const candidate = comparable(value?.url);
  return /^https?:\/\//.test(candidate) && [...verified].some((url) => comparable(url) === candidate)
    ? { url: str(value.url, 2048), title: str(value.title), checked: 'web' }
    : estimate();
}
export function transportOption(value, id, verified) {
  if (!value || !normTime(value.dep) || !normTime(value.arr) || !str(value.carrier)) return null;
  const marked = value.checked === 'web' || value.src?.checked === 'web';
  const src = marked && /^https:\/\//i.test(value.src?.url) ? source(value.src, verified) : estimate();
  const price = positive(value.price);
  return {
    id,
    by: ['flight', 'bus', 'train'].includes(value.by) ? value.by : 'flight',
    carrier: str(value.carrier),
    code: str(value.code, 30),
    from: str(value.from),
    to: str(value.to),
    dep: normTime(value.dep),
    arr: normTime(value.arr),
    price: price ? Math.round(price) : null,
    bag: str(value.bag),
    src,
    checked: src.checked,
    recommended: value.recommended === true,
    why: str(value.why, 220),
  };
}
export function direction(value, place) {
  if (!value || typeof value !== 'object') return undefined;
  const time = normTime(value.time),
    raw = value.choice;
  const choice = transportOption(
    raw,
    str(raw?.id) || (place === 'from' ? 'go-1' : 'back-1'),
    new Set([raw?.src?.url]),
  );
  if (choice && raw.checked === 'live') Object.assign(choice, { checked: 'estimate', src: estimate() });
  if (choice && raw.checked === 'live' && /^off_[a-z\d]+$/i.test(raw.offerId)) {
    Object.assign(choice, {
      checked: 'live',
      offerId: raw.offerId,
      expiresAt: str(raw.expiresAt, 80),
      bookable: raw.bookable === true,
      test: raw.test === true,
      src: { title: 'Duffel', url: '', checked: 'live' },
    });
  }
  const by = modes.includes(value.by) ? value.by : time ? 'flight' : 'undecided';
  return { by, [place]: str(value[place]), ...(coordinates(value.placeLL) ? { placeLL: value.placeLL } : {}), time, auto: value.auto === true, ...(choice ? { choice } : {}) };
}
export function normalize(input) {
  if (!isDate(input?.startDate)) throw bad('Bop ต้องการวันเริ่มเดินทางที่ถูกต้อง');
  const city = str(input.city) || 'เชียงใหม่';
  if (!Array.isArray(input.members) || !input.members.length) throw bad('ต้องมีสมาชิกอย่างน้อย 1 คน');
  const span = isDate(input.endDate)
    ? Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / dayMs) + 1
    : 0;
  const days = Math.min(7, Math.max(1, span > 0 ? span : Math.floor(positive(input.days) ?? 3)));
  const ids = new Set();
  const members = input.members.slice(0, 12).map((member, index) => {
    member ??= {};
    let id =
      str(member.id, 40)
        .toLowerCase()
        .replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'member-' + (index + 1);
    while (ids.has(id)) id += '_';
    ids.add(id);
    return {
      id,
      name: str(member.name, 40) || 'สมาชิก ' + (index + 1),
      ...(member.role === 'organizer' ? { role: 'organizer' } : {}),
      avoid: str(member.avoid) || (member.veg ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : ''),
      note: str(member.note, 400),
      ...(positive(member.maxWalkKm) ? { maxWalkKm: positive(member.maxWalkKm) } : {}),
      ...(positive(member.budget) ? { budget: Math.round(member.budget) } : {}),
      wants: Array.isArray(member.wants)
        ? member.wants
            .map((want) => str(want))
            .filter(Boolean)
            .slice(0, 5)
        : [],
    };
  });
  const arrive = direction(input.arrive, 'from'),
    depart = direction(input.depart, 'to');
  const requested = input.stay?.stays ?? [{ name: input.stay?.name, nights: days - 1 }];
  let left = days - 1;
  const stays = [];
  if (input.stay?.mode === 'booked') {
    for (const row of Array.isArray(requested) ? requested : []) {
      const name = str(row?.name);
      if (!name) continue;
      if (!left && (days > 1 || stays.length)) break;
      const nights = Math.min(left, Math.max(1, Math.floor(positive(row.nights) ?? 1)));
      stays.push({ name, nights, ...(coordinates(row.ll) ? { ll: row.ll } : {}) });
      left -= nights;
    }
    if (stays.length) stays.at(-1).nights += left;
  }
  const info = Object.hasOwn(cities, city) ? cities[city] : undefined;
  return {
    title: str(input.title, 200) || 'ทริปของเรา',
    city,
    cityLL: info?.ll ?? (coordinates(input.cityLL) ? input.cityLL : null),
    country: info?.cc ?? str(input.country, 60),
    cityAirport: /^[A-Z]{3}$/.test(input.cityAirport) ? input.cityAirport : info?.airport,
    currency: /^[A-Z]{3}$/.test(input.currency) ? input.currency : (info?.currency ?? 'THB'),
    startDate: input.startDate,
    endDate: isDate(input.endDate) ? input.endDate : dateAt(input.startDate, days - 1),
    days,
    members,
    arrive,
    depart,
    hasCar: input.hasCar !== false && (input.hasCar === true || [arrive?.by, depart?.by].includes('drive')),
    stay: stays.length ? { mode: 'booked', stays } : { mode: 'auto' },
    hotelArea: str(input.hotelArea),
    autonomy: input.autonomy === 'ask' ? 'ask' : 'auto',
    picks: {
      must: Array.isArray(input.picks?.must) ? input.picks.must.filter((p) => str(p?.name)).slice(0, 15) : [],
      avoid: Array.isArray(input.picks?.avoid) ? input.picks.avoid.slice(0, 30) : [],
    },
    pace: ['chill', 'normal', 'packed'].includes(input.pace) ? input.pace : 'normal',
    extra: str(input.extra, 1000),
  };
}
export const distance = (a, b) => {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};
export { checks, explain, total } from './rules.mjs';
export { applyEdits } from './edits.mjs';
