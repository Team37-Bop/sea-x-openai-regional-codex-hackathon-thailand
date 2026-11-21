const dayMs = 86_400_000;
export const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const clock = value => {
  value = Math.min(1439, Math.max(0, Math.round(value)));
  return [Math.floor(value / 60), value % 60].map(number => String(number).padStart(2, '0')).join(':');
};
export const dateAt = (date, offset) => new Date(Date.parse(date) + offset * dayMs).toISOString().slice(0, 10);
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && dateAt(value, 0) === value;
export const coordinates = ll => Array.isArray(ll) && ll.length === 2 && ll.every(Number.isFinite)
  && Math.abs(ll[0]) <= 90 && Math.abs(ll[1]) <= 180 && ll.some(Boolean);
const str = (value, size = 120) => typeof value === 'string' ? value.trim().slice(0, size) : '';
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export const bad = message => Object.assign(new Error(message), { code: 'bad_request' });
export const estimate = () => ({ url: '', title: '', checked: 'estimate' });
export const cities = {
  'เชียงใหม่': { ll: [18.7883, 98.9853], cc: 'TH', currency: 'THB', airport: 'CNX' },
  'กรุงเทพฯ': { ll: [13.7563, 100.5018], cc: 'TH', currency: 'THB', airport: 'BKK' },
  'ดานัง': { ll: [16.0544, 108.2022], cc: 'VN', currency: 'VND', airport: 'DAD' },
  'โตเกียว': { ll: [35.6762, 139.6503], cc: 'JP', currency: 'JPY', airport: 'HND' },
  'ไทเป': { ll: [25.033, 121.5654], cc: 'TW', currency: 'TWD', airport: 'TPE' },
  'โซล': { ll: [37.5665, 126.978], cc: 'KR', currency: 'KRW', airport: 'ICN' },
};
const modes = ['flight', 'drive', 'bus', 'train', 'undecided'];
export function direction(value, place) {
  value ??= {};
  const time = validTime(value.time) ? value.time : '';
  const choice = value.choice;
  const by = modes.includes(value.by) ? value.by : time ? 'flight' : 'undecided';
  return {
    by, [place]: str(value[place]), time, auto: value.auto === true,
    ...(choice && str(choice.carrier) && validTime(choice.dep) && validTime(choice.arr)
      ? { choice: { ...transportOption(choice, '', new Set()), id: str(choice.id) } } : {}),
  };
}
export function normalize(input) {
  if (!isDate(input?.startDate)) throw bad('Bop ต้องการวันเริ่มเดินทางที่ถูกต้อง');
  const city = str(input.city);
  if (!city) throw bad('กรุณาระบุเมืองปลายทาง');
  if (!Array.isArray(input.members) || !input.members.length) throw bad('ต้องมีสมาชิกอย่างน้อย 1 คน');
  const days = Math.min(7, Math.max(1, isDate(input.endDate)
    ? Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / dayMs) + 1
    : Math.floor(positive(input.days) ?? 1)));
  const ids = new Set();
  const members = input.members.slice(0, 12).map((member, index) => {
    member ??= {};
    const base = str(member.id, 40).toLowerCase().replace(/[^\w-]+/g, '-') || 'member-' + (index + 1);
    let id = base;
    for (let n = 2; ids.has(id); n++) id = base + '-' + n;
    ids.add(id);
    return {
      id, name: str(member.name, 60) || 'สมาชิก ' + (index + 1),
      avoid: str(member.avoid) || (member.veg ? 'มังสวิรัติ' : ''), note: str(member.note, 250),
      maxWalkKm: positive(member.maxWalkKm), budget: positive(member.budget),
      wants: Array.isArray(member.wants) ? member.wants.slice(0, 5).map(want => str(want)).filter(Boolean) : [],
    };
  });
  const arrive = direction(input.arrive, 'from');
  const depart = direction(input.depart, 'to');
  const legacyName = str(input.stay?.name || input.hotelArea);
  const requested = input.stay?.stays ?? [{ name: legacyName, nights: days - 1 }];
  let left = days - 1;
  const stays = [];
  if (input.stay?.mode === 'booked' || (!input.stay && legacyName)) {
    for (const row of Array.isArray(requested) ? requested : []) {
      const name = str(row?.name);
      if (!name) continue;
      if (!left && (days > 1 || stays.length)) break;
      const nights = Math.min(left, Math.max(1, Math.floor(positive(row.nights) ?? 1)));
      stays.push({ name, nights });
      left -= nights;
    }
    if (stays.length) stays.at(-1).nights += left;
  }
  return {
    city, cityLL: cities[city]?.ll ?? (coordinates(input.cityLL) ? input.cityLL : null),
    country: cities[city]?.cc ?? (/^[A-Z]{2}$/.test(input.country) ? input.country : ''),
    currency: cities[city]?.currency ?? (/^[A-Z]{3}$/.test(input.currency) ? input.currency : 'THB'),
    startDate: input.startDate, endDate: dateAt(input.startDate, days - 1), days, members, arrive, depart,
    hasCar: input.hasCar !== false && (input.hasCar === true || [arrive.by, depart.by].includes('drive')),
    stay: stays.length ? { mode: 'booked', stays } : { mode: 'auto' },
    autonomy: input.autonomy === 'ask' ? 'ask' : 'auto', picks: input.picks ?? {},
    pace: ['chill', 'normal', 'packed'].includes(input.pace) ? input.pace : 'normal', extra: str(input.extra, 500),
  };
}
export function source(value, verified) {
  return value && verified.has(value.url)
    ? { url: value.url, title: str(value.title), checked: 'web' } : estimate();
}
export function transportOption(value, id, verified) {
  if (!value || !validTime(value.dep) || !validTime(value.arr) || !str(value.carrier)) return null;
  const src = source(value.src, verified);
  return {
    id, by: modes.includes(value.by) ? value.by : 'flight', carrier: str(value.carrier),
    code: str(value.code, 20), from: str(value.from), to: str(value.to), dep: value.dep, arr: value.arr,
    price: positive(value.price), bag: str(value.bag), src, checked: src.checked,
    recommended: value.recommended === true, why: str(value.why),
  };
}
export const distance = (a, b) => {
  const rad = degrees => degrees * Math.PI / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2
    + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const money = stop => (stop.cost || 0) + (stop.leg?.cost || 0);
export const total = plan => plan.days.flatMap(day => day.stops).reduce((amount, stop) => amount + money(stop), 0);
export function checks(plan, setup) {
  const rows = [];
  const add = (id, label, problems) => rows.push({ id, label, pass: !problems.length, problems });
  for (const member of setup.members) {
    add(member.id + '/budget', member.name + ' · งบต่อคน', member.budget && total(plan) > member.budget
      ? ['เกินงบ ฿' + Math.round(total(plan) - member.budget)] : []);
    add(member.id + '/walk', member.name + ' · ระยะเดิน', plan.days.flatMap((day, index) => {
      const walking = day.stops.reduce((sum, stop) => sum + (stop.leg?.mode === 'walk' ? stop.leg.km : 0), 0);
      return member.maxWalkKm && walking > member.maxWalkKm ? ['วันที่ ' + (index + 1) + ' เดิน ' + walking.toFixed(1) + ' กม.'] : [];
    }));
    add(member.id + '/food', member.name + ' · อาหาร', member.avoid ? plan.days.flatMap(day => day.stops
      .filter(stop => stop.kind === 'food' && !stop.diet?.includes(member.avoid)).map(stop => 'ตรวจสอบอาหารที่ ' + stop.name)) : []);
  }
  add('hours', 'เวลาเปิดและวันหยุด', plan.days.flatMap(day => day.stops.flatMap(stop => {
    const weekday = new Date(day.date + 'T00:00:00Z').getUTCDay();
    const hours = stop.hours?.[weekday] ?? stop.hours?.default;
    return stop.closedDays?.includes(weekday) || stop.closures?.includes(day.date)
      || (Array.isArray(hours) && (stop.start < hours[0] || stop.end > hours[1])) ? [stop.name] : [];
  })));
  add('departure', 'เผื่อเวลาเดินทางกลับ', setup.depart.time && plan.days.at(-1)?.stops.some(stop =>
    stop.end > clock(minutes(setup.depart.time) - (setup.depart.by === 'flight' ? 90 : 40))) ? ['กิจกรรมท้ายทริปใกล้เวลาออกเดินทาง'] : []);
  add('meals', 'เวลาอาหาร', plan.days.flatMap((day, index) => day.stops.length > 2
    && !day.stops.some(stop => stop.kind === 'food') ? ['วันที่ ' + (index + 1) + ' ยังไม่มีจุดกินข้าว'] : []));
  add('driving', 'การใช้รถส่วนตัว', !setup.hasCar && plan.days.some(day => day.stops.some(stop => stop.leg?.mode === 'own'))
    ? ['ยังไม่ได้ระบุรถส่วนตัว'] : []);
  return rows;
}
export function applyEdits(plan, edits) {
  const next = structuredClone(plan);
  next.flags ??= {};
  const errors = [];
  for (const edit of edits ?? []) {
    if (edit.op === 'flag') {
      if (['transport', 'stay', 'arrivalSuggested'].includes(edit.key)) next.flags[edit.key] = edit.value;
      continue;
    }
    const day = next.days.find(row => row.stops.some(stop => stop.id === edit.id));
    const index = day?.stops.findIndex(stop => stop.id === edit.id);
    if (!day) { errors.push('ไม่พบ ' + edit.id); continue; }
    const stop = day.stops[index];
    if (['replace', 'remove'].includes(edit.op) && stop.res?.done) {
      errors.push('จองแล้ว: ' + stop.name);
      continue;
    }
    if (edit.op === 'remove') day.stops.splice(index, 1);
    if (edit.op === 'replace' && edit.stop) {
      const replacement = { ...stop, ...edit.stop, id: stop.id };
      if (edit.stop.name && edit.stop.name !== stop.name && !coordinates(edit.stop.ll)) delete replacement.ll;
      day.stops.splice(index, 1, replacement);
    }
    if (edit.op === 'insert' && edit.stop) day.stops.splice(index + 1, 0, { ...edit.stop, id: stop.id + '-' + day.stops.length });
  }
  return { plan: next, errors };
}
