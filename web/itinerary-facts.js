const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const thaiWeekdays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const dayMs = 86_400_000;

export function visitDate(day, index, setup) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(day?.date) && Number.isFinite(Date.parse(day.date))) return day.date;
  const start = Date.parse(setup?.startDate);
  return Number.isFinite(start) ? new Date(start + index * dayMs).toISOString().slice(0, 10) : '';
}

function weekList(values) {
  const entries = Array.isArray(values) ? values : values == null ? [] : [values];
  return [...new Set(entries.map((value) => {
    if (/^[0-6]$/.test(String(value))) return Number(value);
    return weekdays.indexOf(String(value).toLowerCase().slice(0, 3));
  }).filter((value) => value >= 0))];
}

const clockTime = (value) => typeof value === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$|^24:00$/.test(value.trim());
const minutes = (text) => Number(text.split(':')[0]) * 60 + Number(text.split(':')[1]);

export function visitAvailability(stop, date) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const only = weekList(stop.days?.only), closed = weekList(stop.days?.closed ?? stop.closedDays);
  const names = (list) => list.map((n) => thaiWeekdays[n]).join('/');
  const weekRule = only.length ? 'เปิดเฉพาะวัน' + names(only) : closed.length ? 'ปิดวัน' + names(closed) : '';
  const closures = Array.isArray(stop.closures) ? stop.closures : [];
  const closure = closures.find((item) => (item?.date ?? item) === date);
  const raw = stop.days?.hours?.[weekdays[weekday]] ?? stop.hours?.[weekday] ?? stop.hours?.default ?? stop.open;
  let reason = '';
  if (Number.isInteger(weekday)) {
    if (only.length && !only.includes(weekday)) reason = weekRule;
    else if (closed.includes(weekday)) reason = 'ปิดวัน' + thaiWeekdays[weekday];
    else if (/^(?:closed|ปิด)$/i.test(String(raw).trim())) reason = 'ปิดวัน' + thaiWeekdays[weekday];
  }
  if (closure) reason = [reason, 'ปิดวันที่ ' + date + (closure.why ? ' (' + closure.why + ')' : '')].filter(Boolean).join(' · ');
  const text = Array.isArray(raw) ? raw.join(' ') : raw;
  const times = typeof text === 'string' ? text.match(/\d{1,2}:\d{2}/g) || [] : [];
  const intervals = [];
  for (let i = 0; i + 1 < times.length; i += 2)
    if (clockTime(times[i]) && clockTime(times[i + 1])) intervals.push([times[i], times[i + 1]]);
  const start = stop.t0 ?? stop.start, end = stop.t1 ?? stop.end;
  const outsideHours = intervals.length > 0 && clockTime(start) && clockTime(end) && !intervals.some(([from, until]) => {
    const open = minutes(from);
    let close = minutes(until), arrival = minutes(start), departure = minutes(end);
    if (departure < arrival) departure += 1440;
    if (close < open) {
      close += 1440;
      if (arrival < open) { arrival += 1440; departure += 1440; }
    }
    return arrival >= open && departure <= close;
  });
  return { weekday, weekRule, reason, hours: intervals.map((pair) => pair.join('–')).join(', '), outsideHours };
}

export function foodRestriction(member) {
  return member.avoid || (member.veg ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : '');
}
export function hasSuitableMeal(stop, member) {
  const diet = Array.isArray(stop.diet) ? stop.diet.some((item) => typeof item === 'string' && item.trim()) : Boolean(stop.diet);
  if (diet) return true;
  const restriction = foodRestriction(member).trim();
  // A vegetarian option alone does not establish suitability for an allergy or a vegan meal.
  return Boolean(stop.veg && /^(?:(?:กิน|ทาน)?มังสวิรัติ|vegetarian|เนื้อสัตว์\s*\(กินมังสวิรัติ\))$/i.test(restriction));
}
export function stopFacts(stop, members = [], booking) {
  const facts = [];
  const meal = stop.meal || (stop.k ?? stop.kind) === 'food';
  const diners = meal ? members.filter(foodRestriction) : [];
  if (diners.length) {
    const missing = diners.filter((m) => !hasSuitableMeal(stop, m)).map((m) => m.name);
    facts.push(missing.length ? ['ยังไม่ยืนยันเมนูสำหรับ' + missing.join(', '), 'warn'] : ['ระบุเมนูที่ตรงข้อจำกัดของกลุ่มแล้ว', 'done']);
  }
  if (stop.veg) facts.push(['มีตัวเลือกมังสวิรัติ', 'done']);
  if (meal && stop.walkin && !stop.res?.todo && !stop.res?.done && !booking) facts.push(['เข้าร้านได้โดยไม่ต้องจอง']);
  if (stop.dress) facts.push(['แต่งกายสุภาพ']);
  if (stop.outdoor) facts.push(['กลางแจ้ง']);
  return facts;
}

export function legFacts(leg) {
  const rest = leg.rest || leg.breaks || [];
  const places = (Array.isArray(rest) ? rest : [rest])
    .map((v) => typeof v === 'string' ? v : v?.name || v?.n || v?.text)
    .filter((v) => typeof v === 'string' && v.trim());
  return [typeof leg.why === 'string' && leg.why.trim(), places.length && 'แวะพักที่ ' + places.join(' · ')].filter(Boolean);
}
