import { renderBookingTasks, reservationStatus, setReservationDone } from './booking-tasks.js';
import { describePlanChange, renderPlanReview } from './plan-review.js';
import { openPlaceSheet, closePlaceSheet } from './place-details.js';
import { attachLocationSuggestions } from './location-suggest.js';
import { bindWorkspace, renderPeople } from './workspace-controls.js';
import { installSetupExtras, chooseCandidates } from './setup-extras.js';
import { createForecast } from './forecast.js';
import { drawMap } from './map.js';
import { readEvents } from './stream.js';
import {
  renderTripIntegrations,
  renderLineVote,
  canNotifyWeather,
  notifyWeather,
} from './trip-integrations.js';
const $ = (selector) => document.querySelector(selector);
const setupForm = $('#setup-form');
const setupDialog = $('#setup-dialog');
const detail = $('#detail');
const status = $('#status');
const cash = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const calendar = new Intl.DateTimeFormat('th-TH', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const presets = {
  เชียงใหม่: ['TH', 'THB', 18.7883, 98.9853],
  กรุงเทพฯ: ['TH', 'THB', 13.7563, 100.5018],
  ดานัง: ['VN', 'VND', 16.0544, 108.2022],
  โตเกียว: ['JP', 'JPY', 35.6762, 139.6503],
  ไทเป: ['TW', 'TWD', 25.033, 121.5654],
  โซล: ['KR', 'KRW', 37.5665, 126.978],
};
const modes = { undecided: 'ให้ Bop เลือกให้', flight: 'เครื่องบิน', drive: 'ขับรถ', bus: 'รถบัส', train: 'รถไฟ' };
const travel = { transit: 'ขนส่งสาธารณะ', red: 'รถแดง', walk: 'เดิน', car: 'รถรับจ้าง', own: 'รถส่วนตัว', van: 'รถตู้' };
const kind = {
  food: 'อาหาร',
  hotel: 'ที่พัก',
  nature: 'ธรรมชาติ',
  view: 'จุดชมวิว',
  sight: 'สถานที่เที่ยว',
  terminal: 'จุดเดินทางกลับ',
  transit: 'จุดเดินทาง',
  stay: 'ที่พัก',
  market: 'ตลาด',
};
const dayMs = 86_400_000;
const ymd = (time) => new Date(time).toISOString().slice(0, 10);
const tripLength = () =>
  Math.min(
    7,
    Math.max(
      1,
      Math.round((Date.parse(setupForm.endDate.value) - Date.parse(setupForm.startDate.value)) / dayMs) + 1 ||
        1,
    ),
  );
const dateLabel = (value) => calendar.format(new Date(value + 'T00:00:00Z'));
const lookupCache = new Map();
const selectedLocations = new WeakMap();
function savedLocation(input) {
  const hit = selectedLocations.get(input);
  return hit?.name === input.value.trim() ? hit : undefined;
}
function withSuggestions(input, kind, multiple = false) {
  attachLocationSuggestions(input, {
    kind,
    multiple,
    getContext: () => {
      if (kind === 'city') return {};
      const city = setupForm.city.value.trim();
      const center = lookupCache.get(city)?.ll ?? presets[city]?.slice(2);
      return { city, center };
    },
    onSelect: (item) => {
      selectedLocations.set(input, item);
      if (kind === 'city') lookupCache.set(item.name, item);
    },
  });
}
withSuggestions(setupForm.city, 'city');
const history = [];
let state = { plan: null, routes: {}, setup: {}, selected: 0, demo: true, bookings: {}, cancellations: [] };
let busy = false;
let focusedStop;
let original, preview, activePlanning, timer;
let allDays = false,
  view = 'plan',
  readiness;
function presentSummary(text) {
  const summary = $('#plan-summary');
  summary.hidden = !text;
  summary.open = false;
  summary.querySelector('p').textContent = text || '';
  status.textContent = '';
}
function updateTripLink() {
  if (state.localTripId) window.history.replaceState(null, '', '#trip=' + state.localTripId);
}
function newTrip() {
  closePlaceSheet($('#place-panel'), { restoreFocus: false });
  focusedStop = null;
  presentSummary('');
  forecast.reset();
  original = structuredClone(state);
  preview = null;
  pendingVotes = null;
  history.length = 0;
  view = 'plan';
  allDays = !state.demo;
  $('#options').replaceChildren();
  $('#alerts').replaceChildren();
}
async function checkHealth() {
  try {
    const reply = await fetch('/api/health', { signal: AbortSignal.timeout(10000) });
    if (!reply.ok) throw Error();
    readiness = await reply.json();
    $('#readiness').textContent = readiness.ai
      ? 'Bop พร้อมวางแผน'
      : 'ยังไม่ได้ตั้งค่าบริการ AI บนเซิร์ฟเวอร์ คุณลองทริปตัวอย่างได้';
  } catch {
    readiness = null;
    $('#readiness').textContent = 'ติดต่อ Bop ไม่ได้ คุณลองทริปตัวอย่างได้';
  }
  return readiness;
}
const hasLiveService = () => readiness?.ai === true && readiness.provider !== 'fake';
let pendingVotes = null;
const forecast = createForecast({
  getState: () => state,
  isBusy: () => busy || !!pendingVotes || !!preview,
  onChange: () => render(),
  onReplan: (command, day) => task(() => adjust(command, day)),
  canNotify: canNotifyWeather,
  notify: notifyWeather,
});
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function button(text, action, className = 'quiet') {
  const element = node('button', text, className);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}
function field(label, name, { type = 'text', value = '', min, max, maxLength, placeholder } = {}) {
  const wrap = node('label', label);
  const input = node('input');
  input.name = name;
  input.type = type;
  input.value = value;
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  if (maxLength) input.maxLength = maxLength;
  if (placeholder) input.placeholder = placeholder;
  wrap.append(input);
  return wrap;
}
function selectField(label, name, options, value) {
  const wrap = node('label', label);
  const select = node('select');
  select.name = name;
  for (const [key, title] of Object.entries(options)) {
    const option = node('option', title);
    option.value = key;
    select.append(option);
  }
  select.value = value;
  wrap.append(select);
  return wrap;
}
function clean(value, key = '') {
  if (typeof value === 'string')
    return ['url', 'page', 'href', 'model', 'id'].includes(key)
      ? value
      : value.replace(/Claude|Anthropic/gi, 'Bop');
  if (Array.isArray(value)) return value.map((item) => clean(item, key));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
  return value;
}
async function api(path, payload, onDay) {
  const signal = activePlanning?.signal;
  const response = await fetch(path, {
    signal,
    ...(payload === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  });
  const result = await readEvents(response, (event) => {
    signal?.throwIfAborted();
    if (event.type === 'step') status.textContent = clean(event.text || '');
    if (event.type === 'day') onDay?.(clean(event));
  });
  return clean(result);
}
function setBusy(value) {
  busy = value;
  for (const selector of ['#demo', '#open-setup', '#hero-setup', '#replan button'])
    $(selector).disabled = value;
  $('#undo').disabled = value || !history.length;
  $('#reset-plan').disabled = value || !original;
}
async function task(action) {
  if (busy) return;
  setBusy(true);
  try {
    await action();
  } catch (error) {
    status.textContent = error.message || 'Bop ทำรายการไม่สำเร็จ';
  } finally {
    setBusy(false);
  }
}
function formatDay(day) {
  return day?.date ? dateLabel(day.date) : '';
}
function render() {
  const plan = preview?.plan || state.plan;
  const day = plan?.days[state.selected];
  $('#views').hidden = !plan;
  $('#plan-panel').hidden = view !== 'plan';
  $('#book-panel').hidden = view !== 'book';
  document.querySelector('.command-panel').hidden = !plan;
  $('#plan-tab').setAttribute('aria-selected', String(view === 'plan'));
  $('#book-tab').setAttribute('aria-selected', String(view === 'book'));
  $('#whole-map').textContent = allDays ? 'ดูแผนที่ของวันที่เลือก' : 'ดูแผนที่ทั้งทริป';
  $('#tabs').replaceChildren();
  $('#itinerary').replaceChildren();
  $('#checks-list').replaceChildren();
  $('#totals').textContent = '';
  $('#checks-count').textContent = '';
  if (!plan) {
    $('#itinerary').append(node('p', 'ยังไม่มีแผนทริป', 'empty'));
    return;
  }
  renderPeople(state.setup, plan);
  const usageNote = $('#usage-note');
  if (usageNote) {
    usageNote.textContent = state.sample ? 'ทริปตัวอย่าง' : state.usage?.provider === 'fake' ? 'ข้อมูลทดสอบ' : '';
    usageNote.hidden = !usageNote.textContent;
  }
  $('#city-title').textContent = plan.city;
  $('#trip-summary').textContent =
    plan.days.length + ' วัน · เพื่อน ' + (state.setup.members?.length ?? 0) + ' คน';
  if (preview) $('#itinerary').append(node('p', 'กำลังดูตัวอย่างแผน · รอผลโหวต', 'preview-note'));
  const stops = plan.days.flatMap((row) => row?.stops ?? []);
  const total = stops.reduce((sum, stop) => sum + Number(stop.cost || 0) + Number(stop.leg?.cost || 0), 0);
  $('#totals').textContent = '฿' + cash.format(total) + ' / คน';
  for (let i = 0; i < plan.days.length; i++) {
    const tab = button('วันที่ ' + (i + 1), () => {
      focusedStop = null;
      state.selected = i;
      closePlaceSheet($('#place-panel'), { restoreFocus: false });
      allDays = false;
      render();
    });
    tab.setAttribute('aria-current', i === state.selected ? 'true' : 'false');
    $('#tabs').append(tab);
  }
  if (!day?.stops.length)
    $('#itinerary').append(node('p', day ? 'ยังไม่มีจุดแวะในวันนี้' : 'Bop กำลังจัดแผนวันนี้', 'empty'));
  else {
    const title = node('h3', day.title, 'day-title');
    const dayCost = day.stops.reduce((sum, stop) => sum + (stop.cost || 0) + (stop.leg?.cost || 0), 0);
    const walk = day.stops.reduce(
      (sum, stop) =>
        sum +
        Number(stop.walk || stop.walkKm || 0) +
        (stop.leg?.mode === 'walk' ? Number(stop.leg.km || 0) : 0),
      0,
    );
    title.append(
      node(
        'small',
        formatDay(day) + ' · เดิน ' + walk.toFixed(1) + ' กม. · ฿' + cash.format(dayCost) + ' / คน',
      ),
    );
    $('#itinerary').append(title);
    const changes = new Map((preview ? describePlanChange(state.plan, plan).changes : []).map(change => [change.id, change]));
    for (const stop of day.stops) {
      if (stop.leg)
        $('#itinerary').append(
          node(
            'p',
            (travel[stop.leg.mode] || 'เดินทาง') +
              ' · ' +
              stop.leg.min +
              ' นาที · ' +
              Number(stop.leg.km || 0).toFixed(1) +
              ' กม.' +
              (stop.leg.real ? ' · ตามถนนจริง' : ' · เส้นทางโดยประมาณ'),
            'leg',
          ),
        );
      const row = node('article', null, 'stop');
      row.tabIndex = 0;
      row.dataset.stopId = stop.id;
      row.addEventListener('click', (event) => {
        if (!event.target.closest('button, a, input')) place(stop);
      });
      row.dataset.focused = String(stop.id === focusedStop);
      row.setAttribute('aria-label', stop.name + ' รายละเอียด');
      row.addEventListener('keydown', (event) => {
        if (event.target === row && [' ', 'Enter'].includes(event.key)) {
          event.preventDefault();
          place(stop);
        }
      });
      const time = node('time', stop.start);
      if (stop.end && stop.end !== stop.start) time.append(node('small', stop.end));
      const content = node('div');
      const meta = node('div', null, 'stop-meta');
      const chip = (text, status) => {
        const item = node('span', text, 'stop-chip');
        if (status) item.dataset.status = status;
        meta.append(item);
      };
      const label = kind[stop.kind] || stop.kind || 'กิจกรรม';
      chip(label);
      if (Number.isFinite(stop.cost)) chip('฿' + cash.format(stop.cost) + ' / คน');
      const opening = Array.isArray(stop.open) ? stop.open.join('–') : stop.open;
      if (typeof opening === 'string' && opening.trim()) chip('เปิด ' + opening);
      const closure = (stop.closures || []).find(c => (c?.date ?? c) === day.date);
      if (closure) chip('ปิดวันที่เลือก' + (closure.why ? ' · ' + closure.why : ''), 'closed');
      const interested = state.setup.members?.find(person => stop.star && person.id === stop.star);
      if (interested) chip(interested.name + ' อยากไป', 'wish');
      if (stop.veg) chip('มีตัวเลือกมังสวิรัติ', 'done');
      const change = changes.get(stop.id);
      if (change?.kinds.includes('retimed')) time.append(node('del', change.before.start));
      if (change) {
        const added = change.kinds.includes('added');
        const note = node('small', added ? 'เพิ่มในแผน' : 'ปรับจากแผนเดิม', 'stop-change');
        note.dataset.status = added ? 'added' : 'moved';
        content.append(note);
      }
      content.append(node('h3', stop.name), meta);
      const badge = forecast.badge(stop, state.selected, plan);
      if (badge) content.append(badge);
      const actions = node('div', null, 'stop-actions');
      actions.append(button('รายละเอียด', () => place(stop)));
      if (stop.res?.todo || stop.res?.done || state.bookings[stop.id]) {
        const booked = reservationStatus(state, stop);
        const mark = button(booked === 'move' ? 'ต้องโทรเลื่อน' : booked === 'done' ? 'จองแล้ว ✓' : 'ทำเครื่องหมายว่าจองแล้ว', () => {
          setReservationDone(state, stop, booked !== 'done');
          render();
        });
        mark.dataset.status = booked;
        actions.append(mark);
      }
      content.append(actions);
      row.append(time, content);
      $('#itinerary').append(row);
    }
  }
  const checks = plan.checks ?? [];
  if (checks.length)
    $('#checks-count').textContent =
      checks.filter((item) => item.pass).length + ' / ' + checks.length + ' ผ่าน';
  for (const item of checks) {
    const row = node('div', null, 'check-row');
    row.append(
      node('b', item.pass ? '✓' : '!', item.pass ? '' : 'fail'),
      document.createTextNode(item.label),
    );
    if (item.member) row.append(node('small', item.member, 'rule-member'));
    for (const problem of item.problems || []) row.append(node('p', problem));
    $('#checks-list').append(row);
  }
  $('#leg-label').textContent = day?.stops.some((stop) => stop.leg && !stop.leg.real)
    ? 'เส้นประเป็นเส้นทางประมาณ'
    : '';
  const todo = renderBookingTasks($('#reservations'), state, {
    run: task,
    rerender: render,
    adjust: (command, day) => {
      switchView('plan');
      return adjust(command, day);
    },
  });
  $('#booking-count').textContent = todo ? '(' + todo + ')' : '';
  if (todo) $('#itinerary').append(button('ดูรายการที่ต้องติดต่อ ' + todo + ' รายการ', () => switchView('book')));
  forecast.renderStrip($('#alerts'), plan, state.selected);
  renderTripIntegrations($('#reservations'), state);
  drawMap(
      allDays ? plan.days : [day],
      { ...state.routes, ...preview?.routes },
      place,
      preview && !allDays ? state.plan.days[state.selected] : null,
      focusedStop,
    );
}
window.addEventListener(
  'load',
  () => {
    if (state.plan) render();
  },
  { once: true },
);
function switchView(next) {
  if (view !== next) closePlaceSheet($('#place-panel'), { restoreFocus: false });
  view = next;
  render();
}
for (const key of ['plan', 'book']) $('#' + key + '-tab').onclick = () => switchView(key);
$('#views').onkeydown = (event) => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    switchView(view === 'plan' ? 'book' : 'plan');
    $('#' + view + '-tab').focus();
  }
};
$('#tabs').onkeydown = (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const next =
    (state.selected + (event.key === 'ArrowRight' ? 1 : -1) + state.plan.days.length) %
    state.plan.days.length;
  $('#tabs').children[next].click();
  $('#tabs').children[next].focus();
};
$('#whole-map').onclick = () => {
  allDays = !allDays;
  $('#whole-map').textContent = allDays ? 'ดูแผนที่ของวันที่เลือก' : 'ดูแผนที่ทั้งทริป';
  render();
};
$('#reset-plan').onclick = () => {
  if (original && !busy) {
    state = structuredClone(original);
    updateTripLink();
    newTrip();
    allDays = false;
    render();
    status.textContent = 'กลับไปยังแผนแรกแล้ว';
  }
};
const detailContent = $('#detail-content');
$('#detail-close').addEventListener('click', () => detail.close());
function place(stop) {
  const plan = preview?.plan || state.plan;
  const index = plan.days.findIndex(day => day?.stops?.some(item => item.id === stop.id));
  if (index >= 0) state.selected = index;
  if (view !== 'plan') view = 'plan';
  focusedStop = stop.id;
  render();
  document.querySelector('.stop[data-focused="true"]')?.scrollIntoView({ block: 'nearest' });
  return openPlaceSheet({
    panel: $('#place-panel'),
    content: $('#place-panel-content'),
    stop,
    city: plan.city,
    day: plan.days[state.selected],
    setup: state.setup,
    stay: plan.flags?.stay,
    bookingStatus: state.bookings[stop.id]?.state,
    opener: [...document.querySelectorAll('[data-stop-id]')].find(row => row.dataset.stopId === stop.id),
    sample: state.sample === true,
    liveResearch: hasLiveService(),
  });
}
async function demo() {
  let result;
  try {
    result = await api('/api/demo');
  } catch {
    const reply = await fetch('/assets/sample.json');
    if (!reply.ok) throw new Error('เปิดทริปตัวอย่างไม่ได้');
    result = await reply.json();
  }
  setupDialog.close();
  if (location.hash.startsWith('#trip=')) window.history.replaceState(null, '', location.pathname + '?demo');
  history.length = 0;
  pendingVotes = null;
  $('#options').replaceChildren();
  $('#alerts').replaceChildren();
  state = {
    plan: result.plan,
    routes: result.routes,
    setup: result.plan.setup,
    selected: 0,
    demo: true,
    sample: true,
    bookings: {},
    cancellations: [],
  };
  newTrip();
  status.textContent = 'กำลังดูทริปตัวอย่างเชียงใหม่';
  render();
}
$('#setup-demo').onclick = () => task(demo);
$('#demo').addEventListener('click', () => task(demo));
for (const selector of ['#open-setup', '#hero-setup'])
  $(selector).addEventListener('click', () => {
    if (state.plan && editingSetup !== state.setup) restoreForm(state.setup, state.plan.flags);
    setupDialog.showModal();
  });
$('#close-setup').addEventListener('click', () => setupDialog.close());
for (const [dir, title, placeName] of [
  ['arrive', 'ขาไป', 'ออกจาก'],
  ['depart', 'ขากลับ', 'กลับไปที่'],
]) {
  const area = node('fieldset', null, 'travel-leg');
  const options = node('div', null, 'travel-modes');
  for (const [value, label] of Object.entries(modes)) {
    const option = node('label', null, 'travel-mode');
    const radio = node('input');
    radio.type = 'radio';
    radio.name = dir + 'By';
    radio.value = value;
    radio.checked = value === 'undecided';
    option.append(radio, document.createTextNode(label));
    options.append(option);
  }
  const fields = node('div', null, 'travel-leg-fields');
  fields.append(
    field(placeName, dir + 'Place', { maxLength: 90 }),
    field(dir === 'arrive' ? 'เวลาถึง' : 'เวลาออก', dir + 'Time', { type: 'time' }),
  );
  area.append(node('legend', title), options, fields);
  $('#directions').append(area);
  withSuggestions(setupForm.elements[dir + 'Place'], 'transport');
}
const augmentSetup = installSetupExtras(setupForm, async () =>
  setupInput(await locate(setupForm.city.value.trim()).catch(() => null), true),
);
let nextMember = 0;
let editingSetup;
function addMember(name = '') {
  if ($('#members').children.length >= 12) return;
  const row = node('div', null, 'member');
  do { row.dataset.id = 'member-' + ++nextMember; } while ([...$('#members').children].some(member => member.dataset.id === row.dataset.id));
  const info = node('div', null, 'fields');
  info.append(
    field('ชื่อ', 'person', { value: name, maxLength: 60 }),
    field('แพ้/ไม่ทาน', 'avoid', { maxLength: 120 }),
  );
  const limits = node('div', null, 'fields');
  limits.append(
    field('งบต่อคน (บาท)', 'budget', { type: 'number', min: 1 }),
    field('เดินได้ (กม./วัน)', 'walk', { type: 'number', min: 0.1 }),
  );
  limits.querySelector('[name=walk]').step = '.1';
  row.append(
    button('นำสมาชิกออก', () => {
      if ($('#members').children.length > 1) row.remove();
    }),
    info,
    limits,
    field('อยากไปหรืออยากทำ (คั่นด้วยจุลภาค)', 'wants', { maxLength: 250 }),
    field('หมายเหตุ', 'note', { maxLength: 250 }),
  );
  $('#members').append(row);
  withSuggestions(row.querySelector('[name=wants]'), 'place', true);
  return row;
}
$('#add-member').addEventListener('click', () => addMember());
addMember();
function addStay(nights) {
  const row = node('div', null, 'stay-row');
  const fields = node('div', null, 'fields');
  fields.append(
    field('ชื่อหรือที่อยู่ที่พัก', 'stayName', { maxLength: 120 }),
    field('จำนวนคืน', 'nights', { type: 'number', value: nights, min: 0, max: 6 }),
  );
  const dates = node('p', null, 'muted');
  row.append(
    fields,
    dates,
    button('นำที่พักออก', () => {
      if ($('#stay-rows').children.length < 2) return;
      const value = Number(row.querySelector('[name=nights]').value);
      row.remove();
      const last = $('#stay-rows').lastElementChild.querySelector('[name=nights]');
      last.value = Number(last.value) + value;
      updateStay();
    }),
  );
  $('#stay-rows').append(row);
  withSuggestions(row.querySelector('[name=stayName]'), 'stay');
  return row;
}
function updateStay(reset = false) {
  const nights = tripLength() - 1;
  const booked = setupForm.elements.stayMode.value === 'booked';
  $('#stay-area').hidden = booked;
  $('#stays').hidden = !booked;
  $('#stays').disabled = !booked;
  const area = $('#stay-rows');
  if (!booked && !area.children.length) return;
  if (!area.children.length) addStay(nights);
  if (!nights && area.children.length > 1) while (area.children.length > 1) area.lastElementChild.remove();
  if (reset && area.children.length === 1)
    area.firstElementChild.querySelector('[name=nights]').value = nights;
  let cursor = 0;
  for (const row of area.children) {
    const input = row.querySelector('[name=nights]');
    input.parentElement.hidden = !nights;
    input.min = nights ? '1' : '0';
    if (!nights) input.value = 0;
    row.querySelector('button').hidden = area.children.length === 1;
    const start = Date.parse(setupForm.startDate.value) + cursor * dayMs;
    cursor += Number(input.value);
    row.querySelector('p').textContent =
      nights && Number.isFinite(start)
        ? calendar.format(start) +
          ' → ' +
          calendar.format(Date.parse(setupForm.startDate.value) + cursor * dayMs)
        : '';
  }
  $('#add-stay').hidden = !nights;
  $('#add-stay').disabled = area.children.length >= nights;
  $('#stay-total').textContent = nights ? 'รวม ' + cursor + ' / ' + nights + ' คืน' : '';
  $('#stay-total').classList.toggle('feedback', cursor !== nights);
}
$('#add-stay').addEventListener('click', () => {
  const area = $('#stay-rows');
  const existing = [...area.querySelectorAll('[name=nights]')];
  const hasSpace = existing.reduce((sum, input) => sum + Number(input.value), 0) < tripLength() - 1;
  const take = existing.findLast((input) => Number(input.value) > 1);
  if (!hasSpace && take) take.value = Number(take.value) - 1;
  if (hasSpace || take) addStay(1);
  updateStay();
});
$('#stay-rows').addEventListener('input', () => updateStay());
$('#stay-mode').addEventListener('change', () => updateStay());
const now = Date.now();
setupForm.startDate.value = ymd(now + dayMs);
setupForm.endDate.value = ymd(now + dayMs * 3);
for (const input of [setupForm.startDate, setupForm.endDate])
  input.addEventListener('change', () => {
    setupForm.endDate.min = setupForm.startDate.value;
    if (setupForm.endDate.value < setupForm.startDate.value)
      setupForm.endDate.value = setupForm.startDate.value;
    updateStay(true);
  });
async function locate(city) {
  if (!city) return null;
  if (lookupCache.has(city)) return lookupCache.get(city);
  if (Object.hasOwn(presets, city)) {
    const [cc, currency, lat, lon] = presets[city];
    return { cc, currency, ll: [lat, lon] };
  }
  const response = await fetch('/api/city?q=' + encodeURIComponent(city));
  const found = response.ok ? await response.json() : null;
  if (found)
    found.currency =
      Object.values(presets).find((row) => row[0] === found.cc)?.[1] ??
      { US: 'USD', GB: 'GBP', MY: 'MYR', SG: 'SGD', CN: 'CNY', ID: 'IDR', AU: 'AUD', FR: 'EUR', DE: 'EUR' }[
        found.cc
      ] ??
      'THB';
  if (found) lookupCache.set(city, found);
  return found;
}
setupForm.city.addEventListener('change', async () => {
  const city = setupForm.city.value.trim();
  const found = await locate(city).catch(() => null);
  if (setupForm.city.value.trim() === city)
    $('#city-result').textContent = found
      ? [found.cc, found.currency].filter(Boolean).join(' · ')
      : 'ยังไม่พบเมืองนี้บนแผนที่';
});
function restoreForm(setup, flags) {
  editingSetup = setup;
  for (const name of ['city', 'startDate', 'endDate', 'pace', 'autonomy']) {
    if (setup[name]) setupForm.elements[name].value = setup[name];
  }
  setupForm.endDate.min = setup.startDate;
  setupForm.hasCar.checked = Boolean(setup.hasCar);
  setupForm.stayMode.value = setup.stay?.mode === 'booked' ? 'booked' : 'auto';
  if (setup.cityLL) lookupCache.set(setup.city, {
    name: setup.city, ll: setup.cityLL, cc: setup.country, currency: setup.currency, airport: setup.cityAirport,
  });
  $('#city-result').textContent = [setup.country, setup.currency].filter(Boolean).join(' · ');
  $('#members').replaceChildren();
  for (const member of setup.members || []) {
    const row = addMember(member.name);
    if (member.id) row.dataset.id = member.id;
    if (member.role) row.dataset.role = member.role;
    for (const [key, value] of Object.entries({
      budget: member.budget, walk: member.maxWalkKm, avoid: member.avoid, note: member.note, wants: member.wants?.join(', '),
    })) row.querySelector('[name=' + key + ']').value = value ?? '';
  }
  if (!$('#members').children.length) addMember();
  $('#stay-rows').replaceChildren();
  for (const stay of setup.stay?.stays || []) {
    const input = addStay(stay.nights).querySelector('[name=stayName]');
    input.value = stay.name;
    if (stay.ll) selectedLocations.set(input, { name: stay.name, ll: stay.ll });
  }
  updateStay();
  augmentSetup.restore(setup, flags);
  $('#form-error').textContent = '';
  setupForm.dispatchEvent(new Event('input', { bubbles: true }));
}
function setupInput(found, transportOnly = false) {
  const nightsBetween = (Date.parse(setupForm.endDate.value) - Date.parse(setupForm.startDate.value)) / dayMs;
  if (!setupForm.city.value.trim()) throw Error('ระบุเมืองปลายทาง');
  if (!Number.isFinite(nightsBetween) || nightsBetween < 0 || nightsBetween >= 7)
    throw Error('เลือกวันเดินทางระหว่าง 1 ถึง 7 วัน');
  const dirs = {};
  for (const [key, place] of [
    ['arrive', 'from'],
    ['depart', 'to'],
  ])
    dirs[key] = {
      by: setupForm.elements[key + 'By'].value,
      [place]: setupForm.elements[key + 'Place'].value,
      placeLL: savedLocation(setupForm.elements[key + 'Place'])?.ll,
      time: setupForm.elements[key + 'Time'].value,
    };
  const stays = [...$('#stay-rows').children].map((row) => ({
    name: row.querySelector('[name=stayName]').value.trim(),
    nights: Number(row.querySelector('[name=nights]').value),
    ll: savedLocation(row.querySelector('[name=stayName]'))?.ll,
  }));
  const nights = tripLength() - 1;
  const booked = setupForm.stayMode.value === 'booked';
  if (!transportOnly && booked && nights) {
    for (const [index, row] of stays.entries()) {
      if (!row.name)
        throw new Error('ใส่ชื่อหรือที่อยู่ที่พักแถว ' + (index + 1) + ' หรือเลือก “ให้ Bop แนะนำ”');
      if (!Number.isInteger(row.nights) || row.nights < 1)
        throw new Error('ที่พักแถว ' + (index + 1) + ' ต้องมีอย่างน้อย 1 คืน');
    }
    const sum = stays.reduce((count, row) => count + row.nights, 0);
    if (sum !== nights)
      throw new Error(
        'จำนวนคืนรวม ' + sum + ' คืน ไม่ตรงกับทริป ' + nights + ' คืน แก้ให้รวมกันได้ ' + nights + ' คืน',
      );
  }
  const members = [...$('#members').children].map((row) => {
    const read = (key) => row.querySelector('[name=' + key + ']').value.trim();
    return {
      id: row.dataset.id,
      role: row.dataset.role,
      name: read('person'),
      avoid: read('avoid'),
      maxWalkKm: read('walk'),
      budget: read('budget'),
      wants: read('wants')
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      note: read('note'),
    };
  });
  if (transportOnly) members.forEach((m, i) => { m.name ||= 'สมาชิก ' + (i + 1); });
  if (!members.some((m) => m.name)) throw Error('ต้องมีสมาชิกที่ระบุชื่ออย่างน้อย 1 คน');
  return augmentSetup({
    city: setupForm.city.value.trim(),
    cityLL: found?.ll,
    cityAirport: found?.airport,
    country: found?.cc,
    currency: found?.currency,
    startDate: setupForm.startDate.value,
    endDate: setupForm.endDate.value,
    ...dirs,
    hasCar: setupForm.hasCar.checked || Object.values(dirs).some((dir) => dir.by === 'drive'),
    stay: booked && stays.some((row) => row.name) ? { mode: 'booked', stays } : { mode: 'auto' },
    members,
    pace: setupForm.pace.value,
    autonomy: setupForm.autonomy.value,
  });
}
setupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  $('#form-error').textContent = '';
  task(async () => {
    let input;
    try {
      input = setupInput(await locate(setupForm.city.value.trim()).catch(() => null));
    } catch (error) {
      $('#form-error').textContent = error.message;
      $('#form-error').scrollIntoView({ block: 'center' });
      return;
    }
    setupDialog.close();
    const previous = state;
    try {
      const health = await checkHealth();
      if (!health?.ai) {
        setupDialog.showModal();
        return;
      }
      activePlanning = new AbortController();
      status.textContent = 'กำลังอ่านข้อมูลทริปและความต้องการของสมาชิก…';
      $('#cancel-plan').hidden = false;
      const start = Date.now();
      timer = setInterval(() => {
        $('#cancel-plan').textContent =
          'กลับไปแก้ข้อมูลทริป · ' + Math.floor((Date.now() - start) / 1000) + ' วินาที';
      }, 1000);
      if (input.autonomy === 'ask') {
        const found = await api('/api/plan/candidates', { setup: input });
        input.picks = await chooseCandidates({
          dialog: detail,
          content: detailContent,
          result: found,
          partySize: input.members.length,
          signal: activePlanning.signal,
        });
        activePlanning.signal.throwIfAborted();
      }
      const progress = {
        plan: { city: input.city, days: Array(tripLength()).fill(null) },
        routes: {},
        setup: input,
        selected: 0,
        demo: false,
        bookings: {},
        cancellations: [],
      };
      const result = await api('/api/plan', { setup: input }, (event) => {
        state = progress;
        progress.plan.days[event.index] = event.day;
        Object.assign(progress.routes, event.routes);
        render();
      });
      if (!result.plan?.days?.length || !result.plan.days.every((day) => Array.isArray(day?.stops)))
        throw new Error('Bop ส่งแผนไม่ครบ กรุณาลองใหม่');
      state = {
        ...progress,
        plan: result.plan,
        routes: result.routes,
        setup: result.plan.setup,
        demo: false,
        usage: result.usage,
      };
      state.localTripId = result.localTripId;
      updateTripLink();
      newTrip();
      $('#options').replaceChildren();
      $('#alerts').replaceChildren();
      presentSummary(result.summary);
      render();
      forecast.refresh();
    } catch (error) {
      state = previous;
      render();
      if (!setupDialog.open) setupDialog.showModal();
      if (activePlanning?.signal.aborted) {
        status.textContent = 'กลับมาแก้ข้อมูลทริปแล้ว';
        return;
      }
      $('#form-error').textContent = error.message;
      $('#form-error').scrollIntoView({ block: 'center' });
      throw error;
    } finally {
      clearInterval(timer);
      activePlanning = null;
      $('#cancel-plan').hidden = true;
    }
  });
});
$('#cancel-plan').onclick = () => {
  activePlanning?.abort();
  if (detail.open) detail.close();
};
function applyOption(option, routes) {
  closePlaceSheet($('#place-panel'), { restoreFocus: false });
  preview = null;
  history.push(structuredClone(state));
  const nextStops = option.plan.days.flatMap((day) => day.stops);
  const bookings = { ...state.bookings };
  const cancellations = [...state.cancellations];
  for (const day of state.plan.days) {
    for (const stop of day.stops) {
      if (stop.res?.done && !bookings[stop.id]) bookings[stop.id] = {
        state: 'done', name: stop.name, time: stop.start, day: day.date, phone: stop.res?.phone || stop.phone,
      };
    }
  }
  for (const [id, booking] of Object.entries(bookings)) {
    const stop = nextStops.find((item) => item.id === id && item.name === booking.name);
    if (!stop) {
      const former = state.plan.days.find((d) => d.stops.some((s) => s.id === id));
      const old = former?.stops.find((s) => s.id === id);
      cancellations.push({ ...booking, day: booking.day || former?.date, phone: booking.phone || old?.res?.phone || old?.phone });
      delete bookings[id];
    } else {
      const newDay = option.plan.days.find(day => day.stops.includes(stop))?.date;
      if (stop.start !== booking.time || (booking.day && newDay !== booking.day)) {
        bookings[id] = { ...booking, state: 'move', next: stop.start };
      } else if (booking.state === 'move') bookings[id] = { ...booking, state: 'done' };
    }
  }
  state = {
    ...state,
    plan: option.plan,
    setup: option.plan.setup,
    ...(option.usage?.provider && option.usage.provider !== 'fake' ? { demo: false, sample: false, usage: option.usage } : {}),
    routes: { ...state.routes, ...routes },
    bookings,
    cancellations,
  };
  pendingVotes = null;
  $('#options').replaceChildren();
  $('#alerts').replaceChildren();
  state.localTripId = option.localTripId || state.localTripId;
  updateTripLink();
  presentSummary(option.line);
  status.textContent = option.title;
  render();
  forecast.refresh();
}
async function adjust(command, day = state.selected) {
  if (!state.plan) return;
  const pinnedPlan = structuredClone(state.plan);
  for (const stop of pinnedPlan.days.flatMap((d) => d.stops))
    if (state.bookings[stop.id]?.state === 'done') stop.res = { ...stop.res, done: true };
  const offlineSample = state.sample && !hasLiveService();
  const input = { plan: pinnedPlan, setup: state.setup, command, day, demo: Boolean(offlineSample) };
  status.textContent = 'กำลังปรับแผนตามคำขอของคุณ…';
  if (
    offlineSample &&
    !/ฝน|น้ำตก|ร้าน.*(?:เต็ม|ปิด)|(?:เต็ม|ปิด).*ร้าน|ดีเลย์|เที่ยวบิน.*(?:ช้า|เลื่อน)/.test(command)
  ) {
    status.textContent = 'ลองพิมพ์ ฝนตก ร้านปิด ร้านเต็ม เที่ยวบินดีเลย์ หรือตัดน้ำตกออก';
    return;
  }
  const result = offlineSample
    ? await (
        await import('/assets/sample-replan.js')
      ).replan(input, {
        signal: new AbortController().signal,
        step: (text) => {
          status.textContent = text;
        },
        usage: {},
        emit() {},
      })
    : await api('/api/replan', input);
  for (const option of result.options || []) option.usage = result.usage;
  status.textContent = result.summary;
  if (!result.needs_vote) {
    applyOption(result.options[0], result.routes);
    return;
  }
  pendingVotes = result;
  preview = { plan: result.options[0].plan, routes: result.routes };
  state.selected = result.day ?? state.selected;
  render();
  const area = $('#options');
  area.replaceChildren(node('h3', 'โหวตแผนกับเพื่อน'));
  const ballot = {};
  const localActions = [];
  for (const option of result.options) {
    const row = node('article', null, 'option');
    row.append(node('strong', option.key + ' · ' + option.title));
    renderPlanReview(row, state.plan, option);
    row.append(
      button('ดูตัวอย่าง', () => {
        preview = { plan: option.plan, routes: result.routes };
        state.selected = result.day ?? state.selected;
        render();
      }),
      button('ดูแผนปัจจุบัน', () => {
        preview = null;
        render();
      }),
    );
    area.append(row);
    localActions.push(() => row.append(button('ใช้แผน ' + option.key, () => {
      applyOption(option, result.routes);
      setBusy(false);
    }, 'primary')));
  }
  if (renderLineVote(area, state, result, (option) => applyOption(option, result.routes))) return;
  for (const show of localActions) show();
  area.append(button('คงแผนเดิม', () => {
    pendingVotes = preview = null;
    area.replaceChildren();
    render();
    status.textContent = 'ใช้กำหนดการเดิม';
  }));
  const selectedLabels = Object.fromEntries(result.options.map((option) => [option.key, option.title]));
  for (const member of state.setup.members) {
    const voter = selectField(member.name, member.id, { '': 'ยังไม่ได้โหวต', ...selectedLabels }, '');
    voter.addEventListener('change', (event) => {
      ballot[member.id] = event.target.value;
    });
    area.append(voter);
  }
  const tie = selectField(
    'ตัวเลือกกรณีคะแนนเสมอ (ผู้จัดทริป)',
    'tie',
    { '': 'เลือกเมื่อคะแนนเสมอ', ...selectedLabels },
    '',
  );
  area.append(
    tie,
    button(
      'ใช้ผลโหวต',
      () => {
        const counts = result.options
          .map((option) => [option.key, Object.values(ballot).filter((vote) => vote === option.key).length])
          .sort((a, b) => b[1] - a[1]);
        if (Object.values(ballot).filter(Boolean).length < state.setup.members.length) {
          status.textContent = 'รอสมาชิกโหวตให้ครบ';
          return;
        }
        const key = counts[0][1] === counts[1][1] ? tie.querySelector('select').value : counts[0][0];
        const selected = pendingVotes?.options.find((option) => option.key === key);
        if (selected) {
          applyOption(selected, result.routes);
          setBusy(false);
        } else status.textContent = 'คะแนนเสมอ ให้ผู้จัดทริปเลือก';
      },
      'primary',
    ),
  );
}
$('#replan').addEventListener('submit', (event) => {
  event.preventDefault();
  const command = $('#command').value.trim();
  if (command) task(() => adjust(command));
});
$('#undo').addEventListener('click', () => {
  if (!history.length) return;
  closePlaceSheet($('#place-panel'), { restoreFocus: false });
  state = history.pop();
  updateTripLink();
  preview = null;
  pendingVotes = null;
  forecast.refresh();
  $('#options').replaceChildren();
  $('#alerts').replaceChildren();
  status.textContent = 'ย้อนกลับเป็นแผนก่อนหน้าแล้ว';
  setBusy(false);
  render();
});
bindWorkspace(setupForm);
render();
checkHealth();
fetch('/api/config').catch(() => {});
const localTrip = /^#trip=([0-9a-f-]{36})$/.exec(location.hash);
if (localTrip)
  task(async () => {
    const response = await fetch('/api/local-trips/' + localTrip[1]);
    if (!response.ok) {
      setupDialog.showModal();
      throw Error('ลิงก์เดโม่หมดอายุแล้ว เริ่มสร้างทริปใหม่ได้');
    }
    const saved = await response.json();
    state = {
      plan: saved.plan,
      setup: saved.plan.setup,
      routes: saved.routes,
      selected: 0,
      demo: false,
      usage: saved.usage,
      bookings: {},
      cancellations: [],
    };
    state.localTripId = localTrip[1];
    newTrip();
    presentSummary(saved.summary);
    render();
    forecast.refresh();
  });
else if (new URLSearchParams(location.search).has('demo')) task(demo);
else setupDialog.showModal();
