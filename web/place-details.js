import { mediaUrl } from './setup-extras.js';
import { readEvents } from './stream.js';
import { samplePlaceInfo } from './sample-place-details.js';

const current = new WeakMap();
const cache = new Map();
const category = { sight: 'สถานที่เที่ยว', nature: 'ธรรมชาติ', view: 'จุดชมวิว', food: 'อาหาร', hotel: 'ที่พัก', stay: 'ที่พัก', market: 'ตลาด', temple: 'วัด', transit: 'จุดเดินทาง', terminal: 'จุดเดินทาง', activity: 'กิจกรรม' };
const travel = { walk: 'เดิน', drive: 'รถยนต์', car: 'รถยนต์', red: 'รถแดง', van: 'รถตู้', own: 'รถส่วนตัว', transit: 'ขนส่งสาธารณะ' };
const week = { sun: 'อาทิตย์', mon: 'จันทร์', tue: 'อังคาร', wed: 'พุธ', thu: 'พฤหัสบดี', fri: 'ศุกร์', sat: 'เสาร์' };
const dates = new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
const arr = value => Array.isArray(value) ? value : [];
const money = amount => typeof amount === 'number' && Number.isFinite(amount) ? '฿' + number.format(amount) : '';
function plain(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\(\s*\[[^\]]+\]\(https?:\/\/[^\s)]+\)\s*\)/gi, '')
    .replace(/!?\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/gi, '$1')
    .replace(/Claude|Anthropic/gi, 'Bop').trim();
}
function el(tag, value, className) {
  const element = document.createElement(tag);
  if (value) element.textContent = value;
  if (className) element.className = className;
  return element;
}
function link(label, target) {
  const href = mediaUrl(target);
  if (!href) return null;
  const a = el('a', plain(label) || new URL(href).hostname);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function click(label, fn, style) {
  const button = el('button', label, style);
  button.type = 'button';
  button.addEventListener('click', fn);
  return button;
}
function section(title, body, className = '') {
  const part = el('section', '', 'pd-section ' + className);
  part.append(el('h3', title), body);
  return part;
}
function items(values) {
  const ul = el('ul', '', 'pd-list');
  for (const value of arr(values).map(plain).filter(Boolean)) ul.append(el('li', value));
  return ul.childElementCount ? ul : null;
}
function facts(entries) {
  const dl = el('dl', '', 'pd-facts');
  for (const [key, value] of entries) {
    if (value == null || value === '') continue;
    const dd = el('dd');
    dd.append(value);
    dl.append(el('dt', key), dd);
  }
  return dl.childElementCount ? dl : null;
}
function mapLink(stop, city) {
  const ll = stop.ll;
  const valid = Array.isArray(ll) && ll.length === 2 && ll.every(Number.isFinite)
    && Math.abs(ll[0]) <= 90 && Math.abs(ll[1]) <= 180 && ll.some(Boolean);
  const query = valid ? ll.join(',') : [plain(stop.query || stop.n || stop.name), plain(city)].filter(Boolean).join(' ');
  return query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : null;
}
function formatRange(value) {
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join('–');
  return plain(value);
}
export function plannedVisit({ stop, day, setup, stay, bookingStatus }) {
  const name = plain(stop.n || stop.name);
  const from = stop.t0 || stop.start, to = stop.t1 || stop.end;
  const time = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '') ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  const duration = time(to) - time(from);
  const date = new Date((day?.date || '') + 'T00:00:00Z');
  const dateText = Number.isFinite(+date) ? dates.format(date) : plain(day?.label);
  const latched = arr(stop.closures).find(item => (typeof item === 'string' ? item : item.date) === day?.date);
  const dayHours = stop.days?.hours || stop.hours;
  const hours = Object.entries(dayHours && typeof dayHours === 'object' ? dayHours : {})
    .flatMap(([key, value]) => {
      const weekday = week[key] ?? week[Object.keys(week)[Number(key)]];
      const range = formatRange(value);
      return weekday && range ? [weekday + ' ' + range] : [];
    }).join(' · ');
  const kind = plain(stop.k || stop.kind);
  const meal = Boolean(stop.meal) || /food|restaurant|ร้านอาหาร|คาเฟ่|อาหาร/i.test(kind);
  const lodging = /hotel|stay|ที่พัก|โรงแรม/i.test(kind);
  const booking = typeof bookingStatus === 'object' ? bookingStatus?.state : bookingStatus;
  const wish = arr(setup?.members).filter(m => (stop.star && m.id === stop.star)
    || arr(m.wants).some(want => typeof want === 'string' && want.trim() && name.includes(want.trim()))).map(m => m.name).join(', ');
  const leg = stop.leg;
  const legMode = leg?.mode ?? leg?.m;
  const previous = day?.stops?.[day.stops.findIndex(s => s.id === stop.id) - 1];
  const legText = leg && previous ? [travel[legMode] || 'เดินทาง', 'จาก' + plain(previous.n || previous.name),
    Number.isFinite(leg.min) ? number.format(leg.min) + ' นาที' : '', Number.isFinite(leg.km) ? number.format(leg.km) + ' กม.' : ''].filter(Boolean).join(' · ') : '';
  return {
    name, kind: category[kind] || kind || 'กิจกรรม', meal, lodging,
    date: dateText, window: [from, to === from ? '' : to].filter(Boolean).join('–'),
    duration: duration > 0 ? duration + ' นาที' : '', cost: money(stop.cost), note: plain(stop.note),
    booking: ({ done: 'จองแล้ว', move: 'ต้องติดต่อเลื่อนเวลา', todo: 'ต้องติดต่อจอง' })[booking] ||
      (stop.res?.done ? 'จองแล้ว' : stop.res?.todo ? 'ต้องติดต่อจอง' : stop.walkin ? 'เข้าร้านแบบ walk-in ได้' : ''),
    phone: plain(stop.res?.phone), open: formatRange(stop.open), hours, wish, legText,
    closure: latched ? 'ปิดในวันที่วางแผน' + (plain(latched.why) ? ' · ' + plain(latched.why) : '') : '',
    why: lodging ? plain(stay?.why) : '',
  };
}
function gallery(photos, name) {
  const figures = document.createDocumentFragment();
  let count = 0;
  for (const photo of arr(photos).slice(0, 4)) {
    const src = mediaUrl(photo?.thumb) || mediaUrl(photo?.url);
    if (!src) continue;
    const figure = el('figure'), img = el('img');
    img.src = src;
    img.loading = count ? 'lazy' : 'eager';
    img.referrerPolicy = 'no-referrer';
    img.alt = plain(photo.alt) || name;
    const caption = el('figcaption');
    if (photo.match === 'likely') caption.append('รูปจากเว็บ · ');
    const credit = plain(photo.credit) || 'ที่มาของภาพ';
    caption.append(link(credit, photo.page) ?? credit);
    const licence = link('สัญญาอนุญาต', photo.license);
    if (licence) caption.append(' · ', licence);
    figure.append(img, caption);
    img.addEventListener('error', () => {
      figure.hidden = true;
      const strip = figure.parentElement;
      if (strip && !strip.querySelector('figure:not([hidden])')) strip.hidden = true;
    }, { once: true });
    figures.append(figure);
    count++;
  }
  if (!count) return null;
  const strip = el('div', '', 'pd-gallery');
  strip.setAttribute('aria-label', 'ภาพของ' + name);
  if (count > 1) strip.tabIndex = 0;
  strip.append(figures);
  return strip;
}
function contact(phone) {
  if (!phone) return '';
  if (!/^[+\d() .-]{6,24}$/.test(phone)) return phone;
  const a = el('a', phone);
  a.href = 'tel:' + phone.replace(/[^\d+]/g, '');
  return a;
}
function paintInfo(host, visit, stop, info, sample) {
  const parts = [];
  const images = gallery(info.photos, visit.name);
  if (images) parts.push(images);
  const description = plain(info.details?.what || info.what || info.summary);
  if (description && description !== visit.note && description !== 'ยังไม่มีข้อมูล') parts.push(el('p', description, 'pd-lead'));
  const highlights = items(info.details?.highlights || info.highlights);
  if (highlights) parts.push(section('จุดที่น่าสนใจ', highlights));
  const details = facts([
    ['เวลาเปิด', plain(info.details?.hours || info.hours) || visit.open],
    ['เวลารายวัน', visit.hours], ['วันเดินทาง', visit.closure],
    ['ราคาที่ค้นพบ', plain(info.details?.price || info.priceRange)],
    ['ที่อยู่', plain(info.details?.address)], ['คะแนนรีวิว', plain(info.details?.rating)],
    ['การจอง', [plain(info.details?.booking), visit.booking].filter(Boolean).join(' · ')],
    ['ติดต่อ', contact(plain(info.phone) || visit.phone)],
  ]);
  if (details) parts.push(section('ข้อมูลสำหรับการไปเยือน', details));
  const dishes = arr(info.dishes);
  if (visit.meal && dishes.length) {
    const menu = el('ul', '', 'pd-menu');
    for (const dish of dishes) {
      if (!plain(dish?.name)) continue;
      const row = el('li');
      row.append(el('strong', plain(dish.name)));
      if (Number.isFinite(dish.price)) row.append(el('span', money(dish.price)));
      if (dish.priceLocal?.currency && Number.isFinite(dish.priceLocal.amount)) row.append(el('small', number.format(dish.priceLocal.amount) + ' ' + dish.priceLocal.currency));
      if (dish.veg || plain(dish.why)) row.append(el('small', [dish.veg ? 'มังสวิรัติ' : '', plain(dish.why)].filter(Boolean).join(' · ')));
      menu.append(row);
    }
    if (menu.childElementCount) parts.push(section(sample ? 'ไอเดียมื้ออาหารในเดโม' : 'เมนูแนะนำ', menu));
  }
  if (visit.why) parts.push(section('เหตุผลที่เลือกที่พักนี้', el('p', visit.why)));
  const tips = items(info.tips);
  if (tips) parts.push(section('ก่อนออกเดินทาง', tips));
  const sources = el('div', '', 'pd-links'), urls = new Set();
  const planSource = stop.src?.checked === 'web' ? [stop.src] : [];
  for (const source of [...planSource, ...arr(info.sources)]) {
    const a = link(source?.title, source?.url);
    if (a && !urls.has(a.href)) { urls.add(a.href); sources.append(a); }
  }
  if (sources.childElementCount) parts.push(section('แหล่งข้อมูล', sources));
  host.replaceChildren(...parts);
}
function header(container, context, visit) {
  const head = el('header', '', 'pd-heading');
  const text = el('div');
  text.append(el('p', [visit.kind, context.city].filter(Boolean).join(' · '), 'pd-kicker'), el('h2', visit.name));
  const close = click('ปิด', () => context.dialog.close(), 'pd-close');
  close.setAttribute('aria-label', 'ปิดรายละเอียดสถานที่');
  head.append(text, close);
  const plan = el('div', '', 'pd-plan');
  plan.append(el('p', visit.date, 'pd-date'));
  const fields = facts([['เวลาในแผน', [visit.window, visit.duration].filter(Boolean).join(' · ')],
    ['งบตามแผน', visit.cost ? visit.cost + ' / คน' : ''], ['เดินทางมาจากจุดก่อน', visit.legText],
    ['คนที่อยากไป', visit.wish]]);
  if (fields) plan.append(fields);
  if (visit.note) plan.append(el('p', visit.note, 'pd-note'));
  if (visit.closure) plan.append(el('p', visit.closure, 'pd-warning'));
  const map = link('เปิดตำแหน่งใน Google Maps ↗', mapLink(context.stop, context.city));
  if (map) plan.append(map);
  const results = el('div', '', 'pd-results'), live = el('div', '', 'pd-live');
  live.setAttribute('role', 'status');
  container.replaceChildren(head, plan, results, live);
  return { results, live, close };
}
export async function openPlaceSheet(context) {
  const { dialog, content, stop, city, sample } = context;
  const previous = current.get(dialog);
  previous?.controller.abort();
  const controller = new AbortController(), { signal } = controller;
  const origin = context.opener || previous?.origin || document.activeElement;
  current.set(dialog, { controller, origin });
  const visit = plannedVisit(context);
  const { results, live, close } = header(content, context, visit);
  const local = sample ? samplePlaceInfo(city, visit.name) : {};
  const key = JSON.stringify([city, stop.id, visit.name, stop.ll, stop.query]);
  const cached = (!sample || context.liveResearch) && cache.get(key);
  const initial = cached?.expires > Date.now() ? cached.info : null;
  paintInfo(results, visit, stop, initial || local, sample && !initial);
  dialog.classList.add('place-reader');
  dialog.setAttribute('aria-label', 'รายละเอียด ' + visit.name);
  const teardown = () => {
    controller.abort();
    current.delete(dialog);
    dialog.classList.remove('place-reader');
    dialog.setAttribute('aria-label', 'รายละเอียดทริป');
    const replacement = [...document.querySelectorAll('[data-stop-id]')].find(row => row.dataset.stopId === stop.id);
    const target = origin?.isConnected && origin !== document.body ? origin : replacement;
    target?.focus({ preventScroll: true });
  };
  dialog.addEventListener('close', teardown, { once: true, signal });
  const compact = matchMedia('(max-width: 760px)');
  if (!dialog.open) {
    if (compact.matches) dialog.showModal();
    else dialog.show();
  }
  dialog.scrollTop = 0;
  close.focus({ preventScroll: true });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }, { signal });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.open) { event.preventDefault(); dialog.close(); }
  }, { signal });
  if ((sample && !context.liveResearch) || initial) return;
  async function research() {
    live.textContent = 'กำลังค้นรายละเอียดและรูปสถานที่…';
    try {
      const response = await fetch('/api/place-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ city, stop: { id: stop.id, n: visit.name, k: visit.meal ? 'food' : stop.k || stop.kind,
          ll: stop.ll, note: stop.note, query: stop.query, aliases: stop.aliases, place: stop.place } }),
      });
      const terminal = await readEvents(response, event => {
        if (event.type === 'step' && !signal.aborted) live.textContent = plain(event.text);
      });
      if (signal.aborted) return;
      if (!terminal?.info) throw new Error('ยังไม่มีข้อมูลสถานที่เพิ่มเติม');
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { info: terminal.info, expires: Date.now() + 30 * 60_000 });
      paintInfo(results, visit, stop, terminal.info, false);
      live.textContent = terminal.info.confidence === 'web' ? 'รายละเอียดจากแหล่งข้อมูลที่ระบุ' : 'รายละเอียดเพิ่มเติมเป็นข้อมูลประมาณ';
    } catch (error) {
      if (signal.aborted) return;
      live.replaceChildren(el('p', plain(error.message) || 'ค้นรายละเอียดเพิ่มเติมไม่สำเร็จ'), click('ลองค้นอีกครั้ง', research, 'quiet'));
    }
  }
  await research();
}
