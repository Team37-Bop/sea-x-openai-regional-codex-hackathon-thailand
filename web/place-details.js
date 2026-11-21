import { renderStopNote } from './stop-note.js';
import { loadPlaceImage, mediaUrl } from './setup-extras.js';
import { fetchStream, readEvents } from './stream.js';
import { samplePlaceInfo } from './sample-place-details.js';

const current = new WeakMap();
const cache = new Map();
const pendingResearch = new Map();
let nextMenu = 0;
const category = {
  sight: 'สถานที่เที่ยว',
  nature: 'ธรรมชาติ',
  view: 'จุดชมวิว',
  food: 'อาหาร',
  hotel: 'ที่พัก',
  stay: 'ที่พัก',
  market: 'ตลาด',
  temple: 'วัด',
  transit: 'จุดเดินทาง',
  terminal: 'จุดเดินทาง',
  activity: 'กิจกรรม',
};
const travel = {
  walk: 'เดิน',
  drive: 'รถยนต์',
  car: 'รถยนต์',
  red: 'รถแดง',
  van: 'รถตู้',
  own: 'รถส่วนตัว',
  transit: 'ขนส่งสาธารณะ',
};
const week = {
  sun: 'อาทิตย์',
  mon: 'จันทร์',
  tue: 'อังคาร',
  wed: 'พุธ',
  thu: 'พฤหัสบดี',
  fri: 'ศุกร์',
  sat: 'เสาร์',
};
const dates = new Intl.DateTimeFormat('th-TH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
const localAmount = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 });
const arr = (value) => (Array.isArray(value) ? value : []);
const money = (amount) =>
  typeof amount === 'number' && Number.isFinite(amount) ? '฿' + number.format(amount) : '';
function plain(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\(\s*\[[^\]]+\]\(https?:\/\/[^\s)]+\)\s*\)/gi, '')
    .replace(/!?\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/gi, '$1')
    .replace(/Claude|Anthropic/gi, 'Bop')
    .trim();
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
    const pair = el('div', '', 'pd-fact');
    pair.append(el('dt', key), dd);
    dl.append(pair);
  }
  return dl.childElementCount ? dl : null;
}
function mapLink(stop, city) {
  const ll = stop.ll;
  const valid =
    Array.isArray(ll) &&
    ll.length === 2 &&
    ll.every(Number.isFinite) &&
    Math.abs(ll[0]) <= 90 &&
    Math.abs(ll[1]) <= 180 &&
    ll.some(Boolean);
  const query = valid
    ? ll.join(',')
    : [plain(stop.query || stop.n || stop.name), plain(city)].filter(Boolean).join(' ');
  return query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : null;
}
function formatRange(value) {
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join('–');
  return plain(value);
}
function isMeal(stop) {
  return Boolean(stop.meal) || /food|restaurant|ร้านอาหาร|คาเฟ่|อาหาร/i.test(stop.k || stop.kind || '');
}
export function plannedVisit({ stop, day, setup, stay, bookingStatus }) {
  const name = plain(stop.n || stop.name);
  const from = stop.t0 || stop.start,
    to = stop.t1 || stop.end;
  const time = (value) =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '')
      ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
      : NaN;
  const duration = time(to) - time(from);
  const date = new Date((day?.date || '') + 'T00:00:00Z');
  const dateText = Number.isFinite(+date) ? dates.format(date) : plain(day?.label);
  const latched = arr(stop.closures).find(
    (item) => (typeof item === 'string' ? item : item.date) === day?.date,
  );
  const dayHours = stop.days?.hours || stop.hours;
  const hours = Object.entries(dayHours && typeof dayHours === 'object' ? dayHours : {})
    .flatMap(([key, value]) => {
      const weekday = week[key] ?? week[Object.keys(week)[Number(key)]];
      const range = formatRange(value);
      return weekday && range ? [weekday + ' ' + range] : [];
    })
    .join(' · ');
  const kind = plain(stop.k || stop.kind);
  const meal = isMeal(stop);
  const lodging = /hotel|stay|ที่พัก|โรงแรม/i.test(kind);
  const booking = typeof bookingStatus === 'object' ? bookingStatus?.state : bookingStatus;
  const wish = arr(setup?.members)
    .filter(
      (m) =>
        (stop.star && m.id === stop.star) ||
        arr(m.wants).some((want) => typeof want === 'string' && want.trim() && name.includes(want.trim())),
    )
    .map((m) => m.name)
    .join(', ');
  const leg = stop.leg;
  const legMode = leg?.mode ?? leg?.m;
  const previous = day?.stops?.[day.stops.findIndex((s) => s.id === stop.id) - 1];
  const legText =
    leg && previous
      ? [
          travel[legMode] || 'เดินทาง',
          'จาก' + plain(previous.n || previous.name),
          Number.isFinite(leg.min) ? number.format(leg.min) + ' นาที' : '',
          Number.isFinite(leg.km) ? number.format(leg.km) + ' กม.' : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
  return {
    name,
    kind: category[kind] || kind || 'กิจกรรม',
    meal,
    lodging,
    date: dateText,
    window: [from, to === from ? '' : to].filter(Boolean).join('–'),
    duration: duration > 0 ? duration + ' นาที' : '',
    cost: money(stop.cost),
    note: plain(stop.note),
    booking:
      { done: 'จองแล้ว', move: 'ต้องติดต่อเลื่อนเวลา', todo: 'ต้องติดต่อจอง' }[booking] ||
      (stop.res?.done
        ? 'จองแล้ว'
        : stop.res?.todo
          ? 'ต้องติดต่อจอง'
          : stop.walkin
            ? 'เข้าร้านแบบ walk-in ได้'
            : ''),
    phone: plain(stop.res?.phone),
    open: formatRange(stop.open),
    hours,
    wish,
    legText,
    closure: latched ? 'ปิดในวันที่วางแผน' + (plain(latched.why) ? ' · ' + plain(latched.why) : '') : '',
    why: lodging ? plain(stay?.why) : '',
  };
}
function gallery(photos, name) {
  const figures = document.createDocumentFragment();
  let count = 0;
  for (const photo of arr(photos).slice(0, 4)) {
    if (!mediaUrl(photo?.thumb) && !mediaUrl(photo?.url)) continue;
    const figure = el('figure'),
      img = el('img');
    figure.hidden = true;
    img.loading = 'eager';
    img.alt = plain(photo.alt) || name;
    const caption = el('figcaption');
    if (photo.match === 'likely') caption.append('รูปจากเว็บ · ');
    const credit = plain(photo.credit) || 'ที่มาของภาพ';
    caption.append(link(credit, photo.page) ?? credit);
    const licence = link('สัญญาอนุญาต', photo.license);
    if (licence) caption.append(' · ', licence);
    figure.append(img, caption);
    loadPlaceImage(img, photo, () => {
      figure.hidden = true;
      const strip = figure.parentElement;
      if (strip && !strip.querySelector('figure:not([hidden])')) strip.hidden = true;
    });
    img.addEventListener('load', () => {
      figure.hidden = false;
      figure.parentElement.hidden = false;
    }, { once: true });
    figures.append(figure);
    count++;
  }
  if (!count) return null;
  const strip = el('div', '', 'pd-gallery');
  strip.hidden = true;
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
function dishList(dishes) {
  const menu = el('ul', '', 'pd-menu');
  for (const dish of arr(dishes)) {
    if (!plain(dish?.name)) continue;
    const row = el('li');
    row.append(el('strong', plain(dish.name)));
    if (Number.isFinite(dish.price)) row.append(el('span', money(dish.price)));
    else if (!Number.isFinite(dish.priceLocal?.amount)) row.append(el('small', 'ยังไม่พบราคาต่อจาน'));
    if (dish.priceLocal?.currency && Number.isFinite(dish.priceLocal.amount))
      row.append(el('small', localAmount.format(dish.priceLocal.amount) + ' ' + dish.priceLocal.currency));
    if (dish.veg || plain(dish.why))
      row.append(el('small', [dish.veg ? 'มังสวิรัติ' : '', plain(dish.why)].filter(Boolean).join(' · ')));
    menu.append(row);
  }
  return menu.childElementCount ? menu : null;
}
function menuSection(info, sample) {
  const dishes = dishList(info.dishes);
  const body = dishes || el('p', sample ? 'ยังไม่มีเมนูตัวอย่างของร้านนี้' : 'ยังไม่พบเมนูแนะนำของร้านนี้');
  const menu = section(sample ? 'ไอเดียมื้ออาหารในเดโม' : 'เมนูแนะนำ', body, 'pd-dishes');
  const source = link('ดูเมนูจากเว็บไซต์ของร้าน', info.menuSource);
  if (source) menu.append(source);
  return menu;
}
function sourceSection(info, stop) {
  const sources = el('div', '', 'pd-links');
  const urls = new Set();
  const planSource = stop.src?.checked === 'web' ? [stop.src] : [];
  for (const source of [...planSource, ...arr(info.sources)]) {
    const a = link(source?.title, source?.url);
    if (!a) continue;
    const url = new URL(a.href);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    if (urls.has(url.href)) continue;
    urls.add(url.href);
    sources.append(a);
  }
  return sources.childElementCount ? section('แหล่งข้อมูล', sources) : null;
}
function paintInfo({ results, photos }, visit, stop, info, sample) {
  const parts = [];
  const images = gallery(info.photos, visit.name);
  photos.replaceChildren(...(images ? [images] : []));
  const description = plain(info.details?.what || info.what || info.summary);
  if (description && description !== visit.note && description !== 'ยังไม่มีข้อมูล')
    parts.push(el('p', description, 'pd-lead'));
  if (visit.meal && (sample || info.dishes)) parts.push(menuSection(info, sample));
  const highlights = items(info.details?.highlights || info.highlights);
  if (highlights) parts.push(section('จุดที่น่าสนใจ', highlights));
  const details = facts([
    ['เวลาเปิด', plain(info.details?.hours || info.hours) || visit.open],
    ['เวลารายวัน', visit.hours],
    ['วันเดินทาง', visit.closure],
    ['ราคาที่ค้นพบ', plain(info.details?.price || info.priceRange)],
    ['ที่อยู่', plain(info.details?.address)],
    ['คะแนนรีวิว', plain(info.details?.rating)],
    ['การจอง', [plain(info.details?.booking), visit.booking].filter(Boolean).join(' · ')],
    ['ติดต่อ', contact(plain(info.phone) || visit.phone)],
  ]);
  if (details) parts.push(section('ข้อมูลสำหรับการไปเยือน', details));
  if (visit.why) parts.push(section('เหตุผลที่เลือกที่พักนี้', el('p', visit.why)));
  const tips = items(info.tips);
  if (tips) parts.push(section('ก่อนออกเดินทาง', tips));
  const sources = sourceSection(info, stop);
  if (sources) parts.push(sources);
  results.replaceChildren(...parts);
}
function header(container, context, visit) {
  const head = el('header', '', 'pd-heading');
  const text = el('div');
  text.append(
    el('p', [visit.kind, context.city].filter(Boolean).join(' · '), 'pd-kicker'),
    el('h2', visit.name),
  );
  text.querySelector('h2').id = 'place-title';
  const close = click('ปิด', () => closePlaceSheet(context.panel), 'pd-close');
  close.setAttribute('aria-label', 'ปิดรายละเอียดสถานที่');
  head.append(text, close);
  const plan = el('div', '', 'pd-plan');
  if (visit.date) plan.append(el('p', visit.date, 'pd-date'));
  const schedule = el('div', '', 'pd-schedule');
  for (const [label, value] of [
    ['เวลาในแผน', visit.window],
    ['ระยะเวลา', visit.duration],
    ['งบตามแผน', visit.cost ? visit.cost + ' / คน' : ''],
  ]) {
    if (!value) continue;
    const item = el('span', value);
    item.setAttribute('aria-label', label + ' ' + value);
    schedule.append(item);
  }
  if (schedule.childElementCount) plan.append(schedule);
  const fields = facts([
    ['การเดินทาง', visit.legText],
    ['คนที่อยากไป', visit.wish],
  ]);
  if (fields) plan.append(fields);
  const note = renderStopNote(context.stop.note, 'pd-note');
  if (note) plan.append(note);
  if (visit.closure) plan.append(el('p', visit.closure, 'pd-warning'));
  const map = link('เปิดตำแหน่งใน Google Maps ↗', mapLink(context.stop, context.city));
  if (map) plan.append(map);
  const photos = el('div', '', 'pd-photos');
  const results = el('div', '', 'pd-results'),
    live = el('div', '', 'pd-live');
  live.setAttribute('role', 'status');
  container.replaceChildren(head, photos, plan, results, live);
  return { photos, results, live, close };
}
function initialResearch({ city, stop, day, sample, liveResearch }) {
  const name = plain(stop.n || stop.name);
  const key = JSON.stringify([city, stop.id, name, stop.ll, stop.query, stop.src?.url, day?.date]);
  const offline = sample && !liveResearch;
  const saved = !offline && cache.get(key);
  return {
    key,
    initial: saved?.expires > Date.now() ? saved.info : null,
    local: sample ? samplePlaceInfo(city, name) : {},
    offline,
  };
}
async function fetchPlaceInfo({ city, stop, day }, signal, onStep) {
  const response = await fetchStream('/api/place-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      city,
      stop: {
        id: stop.id, n: plain(stop.n || stop.name), k: isMeal(stop) ? 'food' : stop.k || stop.kind,
        ll: stop.ll, note: stop.note, query: stop.query, aliases: stop.aliases, place: stop.place,
        meal: stop.meal, date: day?.date, src: stop.src,
      },
    }),
  });
  const result = await readEvents(response, (event) => {
    if (event.type === 'step' && !signal.aborted) onStep(plain(event.text));
  });
  signal.throwIfAborted();
  if (!result?.info) throw new Error('ยังไม่มีข้อมูลสถานที่เพิ่มเติม');
  return result.info;
}
async function researchPlace(context, key, signal, onStep) {
  signal.throwIfAborted();
  let request = pendingResearch.get(key);
  if (!request) {
    const controller = new AbortController();
    const listeners = new Set();
    const promise = fetchPlaceInfo(context, controller.signal, (text) => {
      for (const notify of listeners) notify(text);
    }).then((info) => {
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { info, expires: Date.now() + 30 * 60_000 });
      return info;
    }).finally(() => {
      if (pendingResearch.get(key) === request) pendingResearch.delete(key);
    });
    request = { controller, listeners, promise };
    pendingResearch.set(key, request);
  }
  request.listeners.add(onStep);
  const release = () => {
    request.listeners.delete(onStep);
    if (!request.listeners.size && pendingResearch.get(key) === request) {
      pendingResearch.delete(key);
      request.controller.abort();
    }
  };
  signal.addEventListener('abort', release, { once: true });
  try {
    return await request.promise;
  } finally {
    signal.removeEventListener('abort', release);
    release();
  }
}
export function createStopMenu(context) {
  const { stop, signal } = context;
  if (!isMeal(stop)) return null;
  const menu = el('div', '', 'stop-menu');
  const body = el('div', '', 'stop-menu-body');
  body.id = 'stop-menu-' + ++nextMenu;
  body.hidden = true;
  const toggle = click('ดูเมนูแนะนำ', () => {
    body.hidden = !body.hidden;
    toggle.textContent = body.hidden ? 'ดูเมนูแนะนำ' : 'ซ่อนเมนูแนะนำ';
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    if (body.hidden) controller?.abort();
    else void load();
  }, 'stop-menu-toggle');
  toggle.setAttribute('aria-controls', body.id);
  toggle.setAttribute('aria-expanded', 'false');
  menu.addEventListener('click', (event) => event.stopPropagation());
  menu.append(toggle, body);
  let controller;
  const show = (info, sample) => {
    body.replaceChildren();
    if (plain(info.summary) && info.summary !== 'ยังไม่มีข้อมูล') body.append(el('p', plain(info.summary)));
    const details = [plain(info.priceRange), plain(info.hours), plain(info.phone)].filter(Boolean);
    if (details.length) body.append(el('p', details.join(' · ')));
    body.append(menuSection(info, sample));
    const tips = items(info.tips);
    if (tips) body.append(section('ก่อนออกเดินทาง', tips));
    const sources = sourceSection(info, stop);
    if (sources) body.append(sources);
    if (sample) body.append(el('small', 'เมนูตัวอย่าง'));
    else if (!info.menuSource && info.confidence !== 'web') body.append(el('small', 'ข้อมูลเมนูโดยประมาณ'));
  };
  async function load() {
    if (signal?.aborted) return;
    const { key, initial, local, offline } = initialResearch(context);
    if (initial || offline) return show(initial || local, !initial);
    controller?.abort();
    controller = new AbortController();
    const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const status = el('p', 'กำลังค้นเมนูแนะนำ…');
    status.setAttribute('role', 'status');
    body.replaceChildren(status);
    try {
      const info = await researchPlace(context, key, active, (text) => { status.textContent = text; });
      if (!active.aborted) show(info, false);
    } catch (error) {
      if (active.aborted) return;
      status.textContent = plain(error.message) || 'ค้นเมนูไม่สำเร็จ';
      const retry = click('ลองค้นอีกครั้ง', () => {
        toggle.focus();
        void load();
      }, 'quiet');
      body.append(retry);
    }
  }
  return menu;
}
export function closePlaceSheet(panel, { restoreFocus = true } = {}) {
  if (!panel || panel.hidden) return;
  const active = current.get(panel);
  active?.controller.abort();
  current.delete(panel);
  panel.hidden = true;
  panel.querySelector('#place-panel-content')?.replaceChildren();
  if (!restoreFocus || !active) return;
  const row = [...document.querySelectorAll('[data-stop-id]')].find(
    (item) => item.dataset.stopId === active.id,
  );
  const origin = active.origin;
  const focus = origin?.isConnected && origin !== document.body ? origin : row?.querySelector('.stop-open') || row;
  focus?.focus();
}
export async function openPlaceSheet(context) {
  const { panel, content, stop, sample } = context;
  const previous = current.get(panel);
  previous?.controller.abort();
  const controller = new AbortController(),
    { signal } = controller;
  const origin = context.opener || document.activeElement;
  current.set(panel, { controller, origin, id: stop.id });
  const visit = plannedVisit(context);
  const reader = header(content, context, visit);
  const { live, close } = reader;
  const { key, initial, local, offline } = initialResearch(context);
  paintInfo(reader, visit, stop, initial || local, sample && !initial);
  panel.hidden = false;
  panel.scrollTop = 0;
  close.focus({ preventScroll: true });
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        closePlaceSheet(panel);
      }
    },
    { signal },
  );
  if (offline || initial) return;
  async function research() {
    content.querySelector('.pd-heading').after(live);
    live.textContent = 'กำลังค้นรายละเอียดและรูปสถานที่…';
    try {
      const info = await researchPlace(context, key, signal, (text) => { live.textContent = text; });
      if (signal.aborted) return;
      paintInfo(reader, visit, stop, info, false);
      content.append(live);
      live.textContent =
        info.confidence === 'web'
          ? 'รายละเอียดจากแหล่งข้อมูลที่ระบุ'
          : 'รายละเอียดเพิ่มเติมเป็นข้อมูลประมาณ';
    } catch (error) {
      if (signal.aborted) return;
      live.replaceChildren(
        el('p', plain(error.message) || 'ค้นรายละเอียดเพิ่มเติมไม่สำเร็จ'),
        click('ลองค้นอีกครั้ง', research, 'quiet'),
      );
    }
  }
  await research();
}
