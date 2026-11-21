import { appendTrace } from './operation-trace.js';
import { renderStopNote, splitStopNote } from './stop-note.js';
import { visitCoordinates } from './map.js';
import { legLabels, legMode, isScheduledService } from './leg-modes.js';
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
  const ll = visitCoordinates(stop);
  const query = ll
    ? [ll[1], ll[0]].join(',')
    : [plain(stop.query || stop.n || stop.name), plain(city)].filter(Boolean).join(' ');
  return query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : null;
}
function paintPlaceLocation(container, stop, city) {
  const located = Boolean(visitCoordinates(stop));
  container.replaceChildren();
  if (!located) container.append(el('p', 'ยังไม่มีพิกัดที่ยืนยันสำหรับจุดแวะนี้', 'pd-warning'));
  const map = link(located ? 'เปิดตำแหน่งใน Google Maps ↗' : 'ค้นหาชื่อใน Google Maps ↗', mapLink(stop, city));
  if (map) container.append(map);
}
export function refreshPlaceLocation(panel, stop, city, day) {
  const wrap = panel.querySelector('.pd-map-location');
  if (panel.hidden || current.get(panel)?.id !== stop.id || !wrap) return;
  const hadMapFocus = wrap.contains(document.activeElement);
  paintPlaceLocation(wrap, stop, city);
  if (hadMapFocus) wrap.querySelector('a')?.focus({preventScroll:true});
  const arrival = panel.querySelector('[data-place-leg]');
  if (arrival) arrival.textContent = plannedVisit({stop, day}).legText;
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
  const mode = legMode(leg?.mode ?? leg?.m);
  const previous = day?.stops?.[day.stops.findIndex((s) => s.id === stop.id) - 1];
  const unknownLeg = leg?.unlocated || !visitCoordinates(stop) || !visitCoordinates(previous);
  const legText =
    leg && previous
      ? [
          legLabels[mode] || ((leg?.mode ?? leg?.m) === 'drive' ? 'รถยนต์' : 'เดินทาง'),
          'จาก' + plain(previous.n || previous.name),
          Number.isFinite(leg.min) && (!unknownLeg || leg.min > 0) ? number.format(leg.min) + ' นาที' : '',
          unknownLeg ? 'ยังไม่ทราบระยะทาง' : Number.isFinite(leg.km) ? number.format(leg.km) + ' กม.' : '',
          !unknownLeg && isScheduledService(mode) ? 'เส้นทางโดยประมาณ' : '',
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
    why: lodging ? splitStopNote(stay?.why).text : '',
  };
}
function renderPhotos(host, photos, name, complete = false) {
  const candidates = arr(photos).filter(photo => mediaUrl(photo?.url) || mediaUrl(photo?.thumb)).slice(0, 4);
  let strip = host.querySelector('.pd-gallery');
  if (!strip && candidates.length) {
    strip = el('div', '', 'pd-gallery');
    strip.setAttribute('aria-label', 'ภาพของ' + name);
    host.append(strip);
  }
  function updateStatus() {
    let empty = host.querySelector('.pd-photo-empty');
    const figures = [...host.querySelectorAll('figure')];
    const unavailable = host.dataset.complete === 'true' && figures.every(f => f.dataset.state === 'failed');
    if (unavailable && !empty) host.append(el('small', 'ยังไม่พบภาพของสถานที่นี้ที่แสดงได้', 'pd-photo-empty'));
    if (!unavailable && empty) empty.remove();
  }
  host.dataset.complete = String(complete);
  for (const photo of candidates) {
    const key = mediaUrl(photo.url) || mediaUrl(photo.thumb);
    let figure = [...strip.children].find(f => f.dataset.photo === key);
    if (!figure) {
      figure = el('figure');
      figure.dataset.photo = key;
      figure.dataset.state = 'loading';
      figure.hidden = true;
      const img = el('img');
      img.loading = 'eager';
      img.alt = plain(photo.alt) || name;
      const caption = el('figcaption');
      if (photo.match === 'likely') caption.append('รูปจากเว็บ · ');
      const credit = plain(photo.credit) || 'ที่มาของภาพ';
      caption.append(link(credit, photo.page) ?? credit);
      const licence = link('สัญญาอนุญาต', photo.license);
      if (licence) caption.append(' · ', licence);
      figure.append(img, caption);
      img.addEventListener('load', () => {
        figure.dataset.state = 'loaded';
        figure.hidden = false;
        updateStatus();
      }, { once: true });
      loadPlaceImage(img, photo, () => { figure.dataset.state = 'failed'; updateStatus(); });
    }
    strip.append(figure);
  }
  if (strip && candidates.length > 1) strip.tabIndex = 0;
  updateStatus();
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
  const source = link('ดูหน้าเมนูที่เผยแพร่', info.menuSource);
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
function paintInfo({ results }, visit, stop, info, sample) {
  const parts = [];
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
  if (visit.legText) fields.querySelector('dd').dataset.placeLeg = '';
  if (fields) plan.append(fields);
  const note = renderStopNote(context.stop.note, 'pd-note', context.stop.src);
  if (note) plan.append(note);
  if (visit.closure) plan.append(el('p', visit.closure, 'pd-warning'));
  const location = el('div', '', 'pd-map-location');
  paintPlaceLocation(location, context.stop, context.city);
  plan.append(location);
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
async function fetchPlaceInfo({ city, stop, day }, signal, onEvent) {
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
    if (!signal.aborted && (event.type === 'step' || event.type === 'photos')) onEvent(event);
  });
  signal.throwIfAborted();
  if (!result?.info) throw new Error('ยังไม่มีข้อมูลสถานที่เพิ่มเติม');
  return result.info;
}
async function researchPlace(context, key, signal, onEvent) {
  signal.throwIfAborted();
  let request = pendingResearch.get(key);
  if (!request) {
    const controller = new AbortController();
    const listeners = new Set();
    const steps = [];
    let photos;
    const promise = fetchPlaceInfo(context, controller.signal, (event) => {
      if (event.type === 'photos') photos = event;
      else if (event.text !== steps.at(-1)?.text) {
        steps.push(event);
        if (steps.length > 20) steps.shift();
      }
      for (const notify of listeners) notify(event);
    }).then((info) => {
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { info, expires: Date.now() + (info.photos?.length ? 30 : 1) * 60_000 });
      return info;
    }).finally(() => {
      if (pendingResearch.get(key) === request) pendingResearch.delete(key);
    });
    request = { controller, listeners, promise, replay(notify) { steps.forEach(notify); if (photos) notify(photos); } };
    pendingResearch.set(key, request);
  }
  request.listeners.add(onEvent);
  request.replay(onEvent);
  const release = () => {
    request.listeners.delete(onEvent);
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
    const status = el('p', 'กำลังค้นเมนูแนะนำ…', 'bop-working');
    status.setAttribute('role', 'status');
    body.replaceChildren(status);
    try {
      const info = await researchPlace(context, key, active, (event) => { if (event.type === 'step') status.textContent = plain(event.text); });
      if (!active.aborted) show(info, false);
    } catch (error) {
      if (active.aborted) return;
      status.classList.remove('bop-working');
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
  renderPhotos(reader.photos, (initial || local).photos, visit.name, !!initial);
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
    const trace = el('ol', '', 'operation-trace');
    trace.setAttribute('aria-label', 'ขั้นตอนค้นข้อมูลสถานที่');
    const preview = el('div', '', 'pd-placeholder');
    preview.setAttribute('aria-hidden', 'true');
    preview.append(el('i'), el('i'), el('i'));
    live.removeAttribute('role');
    live.dataset.loading = 'true';
    reader.results.setAttribute('aria-busy', 'true');
    const headline = el('strong', 'Bop กำลังหาข้อมูลและรูป');
    trace.setAttribute('aria-live', 'polite');
    trace.setAttribute('aria-relevant', 'additions');
    live.replaceChildren(headline, trace, preview);
    appendTrace(trace, 'กำลังค้นรายละเอียดสถานที่');
    try {
      const info = await researchPlace(context, key, signal, (event) => {
        if (signal.aborted) return;
        if (event.type === 'photos') {
          renderPhotos(reader.photos, event.photos, visit.name);
        } else {
          const text = plain(event.text).replace(/^Bop กำลังค้นรายละเอียดสถานที่$/, 'กำลังค้นรายละเอียดสถานที่');
          appendTrace(trace, text);
        }
      });
      if (signal.aborted) return;
      renderPhotos(reader.photos, info.photos, visit.name, true);
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
    } finally {
      if (!signal.aborted) {
        delete live.dataset.loading;
        reader.results.removeAttribute('aria-busy');
        live.setAttribute('role', 'status');
      }
    }
  }
  await research();
}
