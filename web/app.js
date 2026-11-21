import { renderBookingTasks, reservationStatus, setReservationDone } from './booking-tasks.js';
import { describePlanChange, renderPlanReview, renderRepairOutcome } from './plan-review.js';
import { openPlaceSheet, closePlaceSheet, createStopMenu } from './place-details.js';
import { renderStopNote } from './stop-note.js';
import { attachLocationSuggestions, localSuggestions } from './location-suggest.js';
import { bindWorkspace, renderPeople } from './workspace-controls.js';
import { installSetupExtras, chooseCandidates } from './setup-extras.js';
import { createForecast } from './forecast.js';
import { coordinates, drawMap } from './map.js';
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
function withSuggestions(input, kind, onSelect) {
  attachLocationSuggestions(input, {
    kind,
    getContext: () => {
      if (kind === 'city') return {};
      const city = setupForm.city.value.trim();
      const center = lookupCache.get(city)?.ll ?? presets[city]?.slice(2);
      return { city, center };
    },
    onSelect: (item) => {
      selectedLocations.set(input, item);
      if (kind === 'city') lookupCache.set(item.name, item);
      onSelect?.(item);
    },
  });
}
withSuggestions(setupForm.city, 'city');
const history = [];
let state = { plan: null, routes: {}, setup: {}, selected: 0, demo: true, bookings: {}, cancellations: [] };
let busy = false;
let focusedStop;
let menuScope;
let original, preview, activePlanning, activeReplan;
let allDays = false,
  view = 'plan',
  readiness;
function presentSummary(text) {
  const summary = $('#plan-summary');
  summary.hidden = !text;
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
  clearChat();
  $('#command').value = '';
  $('#alerts').replaceChildren();
}
async function checkHealth(signal) {
  try {
    const timeout = AbortSignal.timeout(10000);
    const reply = await fetch('/api/health', { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!reply.ok) throw Error();
    readiness = await reply.json();
    $('#readiness').textContent = readiness.ai
      ? 'Bop พร้อมวางแผน'
      : 'ยังไม่ได้ตั้งค่าบริการ AI บนเซิร์ฟเวอร์';
  } catch {
    signal?.throwIfAborted();
    readiness = null;
    $('#readiness').textContent = 'ติดต่อ Bop ไม่ได้';
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
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, key === 'setup' && k === 'title' ? v : clean(v, k)]));
  return value;
}
async function api(path, payload, onDay, { signal = activePlanning?.signal, onStep, onMap } = {}) {
  const response = await fetch(path, {
    signal,
    ...(payload === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  });
  const result = await readEvents(response, (event) => {
    signal?.throwIfAborted();
    if (event.type === 'step') {
      const text = clean(event.text || '');
      if (onStep) onStep(text);
      else status.textContent = text;
    }
    if (event.type === 'day') onDay?.(clean(event));
    if (event.type === 'map') onMap?.(clean(event));
  });
  return clean(result);
}
function setBusy(value) {
  busy = value;
  for (const selector of ['#open-setup', '#hero-setup', '#replan button'])
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
function itineraryDate(day, index, setup) {
  const recorded = Date.parse(day?.date);
  if (Number.isFinite(recorded)) return calendar.format(recorded);
  const start = Date.parse(setup?.startDate);
  return Number.isFinite(start) ? calendar.format(start + index * dayMs) : 'วันที่ ' + (index + 1);
}
function dayTotals(day) {
  const stops = day?.stops || [];
  const cost = stops.reduce((sum, stop) => sum + Number(stop.cost || 0) + Number(stop.leg?.cost || 0), 0);
  const walk = stops.reduce((sum, stop) => sum + Number(stop.walk || stop.walkKm || 0) +
    (stop.leg?.mode === 'walk' ? Number(stop.leg.km || 0) : 0), 0);
  return 'เดิน ' + walk.toFixed(1) + ' กม. · ฿' + cash.format(cost);
}
function render() {
  const plan = preview?.plan || state.plan;
  if (plan?.days.length) state.selected = Math.max(0, Math.min(state.selected, plan.days.length - 1));
  const day = plan?.days[state.selected];
  const menuDay = view === 'plan' && !preview ? day : null;
  const liveResearch = hasLiveService();
  if (menuScope?.day !== menuDay || menuScope?.liveResearch !== liveResearch) {
    menuScope?.controller.abort();
    menuScope = { day: menuDay, liveResearch, controller: new AbortController(), menus: new Map() };
  }
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
  $('#plan-repair').replaceChildren();
  if (!preview) renderRepairOutcome($('#plan-repair'), plan?.repairOutcome);
  $('#totals').textContent = '';
  $('#checks-count').textContent = '';
  if (!plan) {
    $('#itinerary').append(node('p', 'ยังไม่มีแผนทริป', 'empty'));
    return;
  }
  renderPeople(state.setup, plan);
  const usageNote = $('#usage-note');
  if (usageNote) {
    usageNote.textContent = state.usage?.provider === 'fake' ? 'ข้อมูลทดสอบ' : '';
    usageNote.hidden = !usageNote.textContent;
  }
  const tripTitle = state.setup.title || plan.city;
  $('#city-title').textContent = tripTitle;
  $('#trip-summary').textContent = [
    tripTitle !== plan.city ? plan.city : '',
    plan.days.length + ' วัน',
    'เพื่อน ' + (state.setup.members?.length ?? 0) + ' คน',
  ].filter(Boolean).join(' · ');
  if (preview) $('#itinerary').append(node('p', 'กำลังดูตัวอย่างแผน · รอผลโหวต', 'preview-note'));
  const stops = plan.days.flatMap((row) => row?.stops ?? []);
  const total = stops.reduce((sum, stop) => sum + Number(stop.cost || 0) + Number(stop.leg?.cost || 0), 0);
  $('#totals').textContent = '฿' + cash.format(total) + ' / คน';
  for (let i = 0; i < plan.days.length; i++) {
    const tabDay = plan.days[i];
    const tab = button(itineraryDate(tabDay, i, plan.setup || state.setup), () => {
      focusedStop = null;
      state.selected = i;
      closePlaceSheet($('#place-panel'), { restoreFocus: false });
      allDays = false;
      render();
    });
    tab.setAttribute('aria-current', i === state.selected ? 'true' : 'false');
    if (tabDay) tab.append(node('small', dayTotals(tabDay)));
    $('#tabs').append(tab);
  }
  if (!day?.stops.length)
    $('#itinerary').append(node('p', day ? 'ยังไม่มีจุดแวะในวันนี้' : 'Bop กำลังจัดแผนวันนี้', 'empty'));
  else {
    const title = node('h3', day.title, 'day-title');
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
      row.dataset.stopId = stop.id;
      row.dataset.focused = String(stop.id === focusedStop);
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
      const heading = node('h3');
      const openStop = button(stop.name, () => place(stop), 'stop-open');
      openStop.setAttribute('aria-label', stop.name + ' ' + stop.start + ' ดูรายละเอียดสถานที่');
      openStop.setAttribute('aria-controls', 'place-panel');
      if (stop.id === focusedStop) openStop.setAttribute('aria-current', 'true');
      heading.append(openStop);
      content.append(heading, meta);
      const badge = forecast.badge(stop, state.selected, plan);
      if (badge) content.append(badge);
      const note = renderStopNote(stop.note, 'stop-note');
      if (note) content.append(note);
      const actions = node('div', null, 'stop-actions');
      if (stop.res?.todo || stop.res?.done || state.bookings[stop.id]) {
        const booked = reservationStatus(state, stop);
        const mark = button(booked === 'move' ? 'ต้องโทรเลื่อน' : booked === 'done' ? 'จองแล้ว ✓' : 'ทำเครื่องหมายว่าจองแล้ว', () => {
          setReservationDone(state, stop, booked !== 'done');
          render();
        });
        mark.dataset.status = booked;
        actions.append(mark);
      }
      if (actions.childElementCount) content.append(actions);
      if (menuDay) {
        if (!menuScope.menus.has(stop.id))
          menuScope.menus.set(stop.id, createStopMenu({
            city: plan.city, stop, sample: state.sample === true, liveResearch, signal: menuScope.controller.signal,
          }));
        const menu = menuScope.menus.get(stop.id);
        if (menu) content.append(menu);
      }
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
  if ($('#planning-progress').hidden) drawMap(
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
  const count = $('#tabs').children.length;
  if (!count) return;
  const next = (state.selected + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
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
    opener: document.querySelector('.stop[data-focused="true"] .stop-open'),
    sample: state.sample === true,
    liveResearch: hasLiveService(),
  });
}
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
const memberWishReaders = new WeakMap();
function addWishEditor(row, savedWishes) {
  const editor = node('div', null, 'wish-editor');
  const label = node('label', 'อยากไปหรืออยากทำ');
  const limitNotice = node('small', null, 'muted');
  limitNotice.setAttribute('role', 'status');
  limitNotice.hidden = true;
  const list = node('ul', null, 'wish-list');
  list.setAttribute('aria-label', 'รายการที่อยากไปหรืออยากทำ');
  const entry = node('div', null, 'wish-entry');
  const input = node('input');
  input.type = 'text';
  input.name = 'wants';
  input.id = row.dataset.id + '-wish';
  label.htmlFor = input.id;
  const add = button('เพิ่ม', () => commit(pending()));
  entry.append(input, add);
  editor.append(label, list, entry, limitNotice);

  const limit = 5;
  const pending = () => input.value.split(/[,，]/).map((wish) => wish.trim()).filter(Boolean);
  function validate(wishes) {
    const remaining = limit - list.children.length;
    let message = '';
    if (wishes.length > remaining) message = 'เพิ่มได้อีก ' + remaining + ' รายการ';
    else if (wishes.some((wish) => wish.length > 120)) message = 'แต่ละรายการยาวได้ไม่เกิน 120 ตัวอักษร';
    input.setCustomValidity(message);
  }
  function refresh() {
    const size = list.children.length;
    const wishes = pending();
    const full = size === limit;
    input.disabled = full;
    input.placeholder = 'เช่น เดินตลาดเช้า';
    add.disabled = full || !wishes.length;
    entry.hidden = full;
    limitNotice.hidden = !full;
    limitNotice.textContent = full ? 'ครบ 5 รายการแล้ว ลบรายการเดิมเพื่อเพิ่มรายการใหม่' : '';
    list.hidden = !size;
    validate(wishes);
  }
  function appendWish(wish) {
    const item = node('li');
    const remove = button('×', () => {
      item.remove();
      refresh();
      input.focus();
    }, 'wish-remove');
    remove.setAttribute('aria-label', 'ลบ ' + wish);
    item.append(node('span', wish), remove);
    list.append(item);
  }
  function commit(wishes) {
    validate(wishes);
    if (!wishes.length || !input.reportValidity()) return;
    wishes.forEach(appendWish);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (input.disabled) list.lastElementChild.querySelector('button').focus();
    else input.focus();
  }
  for (const wish of savedWishes.slice(0, limit)) appendWish(wish);
  withSuggestions(input, 'place', (item) => commit([item.name]));
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    commit(pending());
  });
  refresh();
  memberWishReaders.set(row, () => {
    if (!input.checkValidity()) throw Error(input.validationMessage);
    return Array.from(list.children, (item) => item.firstElementChild.textContent).concat(pending());
  });
  return editor;
}
function addMember(name = '', wants = []) {
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
    addWishEditor(row, wants),
    field('หมายเหตุ', 'note', { maxLength: 250 }),
  );
  $('#members').append(row);
  return row;
}
$('#add-member').addEventListener('click', () => addMember());
addMember('ผู้จัดทริป');
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
async function locate(city, signal) {
  if (!city) return null;
  if (lookupCache.has(city)) return lookupCache.get(city);
  if (Object.hasOwn(presets, city)) {
    const [cc, currency, lat, lon] = presets[city];
    return { cc, currency, ll: [lat, lon] };
  }
  const response = await fetch('/api/city?q=' + encodeURIComponent(city), { signal });
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
  setupForm.elements.tripTitle.value = setup.title || '';
  for (const name of ['city', 'startDate', 'endDate']) {
    if (setup[name]) setupForm.elements[name].value = setup[name];
  }
  setupForm.elements.pace.value = ['chill', 'packed'].includes(setup.pace) ? setup.pace : 'normal';
  setupForm.elements.autonomy.value = setup.autonomy === 'ask' ? 'ask' : 'auto';
  setupForm.endDate.min = setup.startDate;
  setupForm.hasCar.checked = Boolean(setup.hasCar);
  setupForm.stayMode.value = setup.stay?.mode === 'booked' ? 'booked' : 'auto';
  if (setup.cityLL) lookupCache.set(setup.city, {
    name: setup.city, ll: setup.cityLL, cc: setup.country, currency: setup.currency, airport: setup.cityAirport,
  });
  $('#city-result').textContent = [setup.country, setup.currency].filter(Boolean).join(' · ');
  $('#members').replaceChildren();
  for (const member of setup.members || []) {
    const row = addMember(member.name, Array.isArray(member.wants) ? member.wants : []);
    if (member.id) row.dataset.id = member.id;
    if (member.role) row.dataset.role = member.role;
    for (const [key, value] of Object.entries({
      budget: member.budget, walk: member.maxWalkKm, avoid: member.avoid, note: member.note,
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
      wants: memberWishReaders.get(row)(),
      note: read('note'),
    };
  });
  if (transportOnly) members.forEach((m, i) => { m.name ||= 'สมาชิก ' + (i + 1); });
  if (!members.some((m) => m.name)) throw Error('ต้องมีสมาชิกที่ระบุชื่ออย่างน้อย 1 คน');
  return augmentSetup({
    title: setupForm.elements.tripTitle.value.trim() || setupForm.city.value.trim(),
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
const planningPanel = $('#planning-progress');
function finishTrace(list, state = 'done') {
  const current = list.lastElementChild;
  if (current?.dataset.state !== 'active') return;
  current.dataset.state = state;
  current.removeAttribute('aria-current');
}
function appendTrace(list, text) {
  if (typeof text !== 'string' || !text.trim()) return;
  if (list.lastElementChild?.dataset.state === 'active' && list.lastElementChild.textContent === text) return;
  const following = list.scrollHeight - list.scrollTop - list.clientHeight < 20;
  finishTrace(list);
  const step = node('li');
  step.dataset.state = 'active';
  step.setAttribute('aria-current', 'step');
  const mark = node('span', null, 'trace-mark');
  mark.setAttribute('aria-hidden', 'true');
  step.append(mark, document.createTextNode(text));
  list.append(step);
  if (following) list.scrollTop = list.scrollHeight;
}
function showPlanning(show) {
  planningPanel.hidden = !show;
  $('.trip-board').classList.toggle('planning-map', show);
  $('.trip-bar').inert = show;
  if (!show) {
    finishTrace($('#planning-steps'), activePlanning?.signal.aborted ? 'stopped' : 'done');
    $('#planning-phase').removeAttribute('data-waiting');
    $('#planning-retry').onclick = null;
    $('#planning-auto').onclick = null;
    $('#map-title').textContent = 'แผนที่ทริป';
  }
}
function planningPhase(phase, title, discoveryFailed = false) {
  const failed = phase === 'error';
  $('#cancel-plan').hidden = failed;
  $('#planning-edit').hidden = $('#planning-retry').hidden = !failed;
  $('#planning-auto').hidden = !discoveryFailed;
  finishTrace($('#planning-steps'), phase === 'error' ? 'stopped' : 'done');
  planningPanel.dataset.phase = phase;
  $('#planning-phase').toggleAttribute('data-waiting', ['preparing', 'candidates', 'planning'].includes(phase));
  $('#planning-phase').textContent = title;
}
function editPlanningDraft() {
  if (activePlanning) {
    activePlanning.abort();
    return;
  }
  showPlanning(false);
  render();
  if (!setupDialog.open) setupDialog.showModal();
  $('#setup-title').focus();
}
$('#cancel-plan').onclick = editPlanningDraft;
$('#planning-edit').onclick = editPlanningDraft;

async function generateTrip(input) {
  const ctrl = new AbortController();
  activePlanning = ctrl;
  const signal = ctrl.signal;
  const totalDays = Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / dayMs) + 1;
  const ready = new Map();
  const drafts = new Map();
  const routes = {};
  let showingDraftMap = !state.plan;
  const known = lookupCache.get(input.city) || localSuggestions(input.city, { kind: 'city' }).find((hit) => hit.name === input.city);
  input.cityLL ||= known?.ll || presets[input.city]?.slice(2);
  const draftMap = (days, openCandidate, caption = input.city) => {
    showingDraftMap = true;
    $('#map-title').textContent = caption;
    drawMap(days, routes, openCandidate, undefined, undefined, { cityLL: input.cityLL });
  };
  const onStep = (text) => {
    if (activePlanning !== ctrl || signal.aborted || typeof text !== 'string' || !text.trim()) return;
    $('#planning-phase').removeAttribute('data-waiting');
    appendTrace($('#planning-steps'), text);
  };
  const showDays = () => {
    $('#planning-day-count').textContent = 'จัดแล้ว ' + ready.size + ' จาก ' + totalDays + ' วัน';
    $('#planning-day-meter').value = ready.size;
    const list = $('#planning-days');
    list.replaceChildren();
    for (const [index, day] of [...ready].sort(([a], [b]) => a - b)) {
      const row = node('li', 'วันที่ ' + (index + 1) + (day.title ? ' · ' + day.title : ''));
      row.value = index + 1;
      const places = day.stops.slice(0, 3).map((stop) => stop.name || stop.n).filter(Boolean);
      if (places.length) row.append(node('small', places.join(' · ')));
      list.append(row);
    }
  };
  if (setupDialog.open) setupDialog.close();
  status.textContent = '';
  $('#planning-context').textContent = input.title || input.city;
  $('#planning-steps').replaceChildren();
  $('#planning-day-meter').max = totalDays;
  $('#planning-day-progress').hidden = true;
  $('#planning-error').hidden = true;
  planningPhase('preparing', 'กำลังเตรียมทริป');
  showDays();
  showPlanning(true);
  closePlaceSheet($('#place-panel'), { restoreFocus: false });
  if (showingDraftMap) draftMap([]);
  else {
    $('#map-title').textContent = state.plan.city;
    drawMap(allDays ? state.plan.days : [state.plan.days[state.selected]], state.routes, undefined, undefined, focusedStop);
  }
  window.scrollTo(0, 0);
  $('#planning-phase').focus({ preventScroll: true });
  try {
    const lookup = input.cityLL ? Promise.resolve(known) : locate(input.city, signal).catch(() => null);
    const [health] = await Promise.all([checkHealth(signal), lookup.then((found) => {
      signal.throwIfAborted();
      if (found) {
        input.cityLL = found.ll;
        input.country ||= found.cc;
        input.currency ||= found.currency;
        input.cityAirport ||= found.airport;
        if (!state.plan) draftMap([]);
      }
    })]);
    signal.throwIfAborted();
    if (!health?.ai) throw Error($('#readiness').textContent);
    if (input.autonomy === 'ask' && !input.picks) {
      planningPhase('candidates', 'กำลังค้นหาร้านอาหารและที่เที่ยวให้เลือก');
      const found = await api('/api/plan/candidates', { setup: input }, undefined, { signal, onStep });
      signal.throwIfAborted();
      input.picks = await chooseCandidates({
        dialog: $('#planning-survey'), result: found, partySize: input.members.length, signal,
        reopen: $('#planning-reopen'),
        onQuestion(question, openCandidate) {
          planningPhase('choosing', 'เลือกสถานที่สำหรับทริป');
          const stops = question.options.filter((place) => coordinates(place.ll));
          if (stops.length || showingDraftMap) draftMap([{ stops }], openCandidate, input.city + ' · ตัวเลือกสถานที่');
        },
      });
      signal.throwIfAborted();
      if (showingDraftMap) {
        const selected = input.picks.must.filter((place) => coordinates(place.ll));
        draftMap([{ stops: selected }], undefined, selected.length ? input.city + ' · สถานที่ที่เลือก' : input.city);
      }
    }
    planningPhase('planning', 'กำลังจัดแผนรายวัน');
    $('#planning-day-progress').hidden = false;
    const updateMap = (event) => {
      if (signal.aborted || activePlanning !== ctrl || !Number.isInteger(event.index) ||
          event.index < 0 || event.index >= totalDays || !Array.isArray(event.day?.stops)) return;
      if (event.type === 'day') {
        ready.set(event.index, event.day);
        showDays();
      } else if (ready.has(event.index)) return;
      drafts.set(event.index, event.day);
      Object.assign(routes, event.routes);
      const days = Array.from({ length: totalDays }, (_, i) => drafts.get(i));
      if (days.some((day) => day?.stops.some((stop) => !stop.place?.fallback && coordinates(stop.ll)))) {
        draftMap(days);
      }
    };
    const result = await api('/api/plan', { setup: input }, updateMap, { signal, onStep, onMap: updateMap });
    signal.throwIfAborted();
    if (!Array.isArray(result.plan?.days) || result.plan.days.length !== totalDays ||
        !result.plan.days.every((day) => Array.isArray(day?.stops)))
      throw Error('Bop ส่งแผนไม่ครบ กรุณาลองใหม่');
    state = {
      plan: result.plan, routes: result.routes, setup: result.plan.setup,
      selected: 0, demo: false, bookings: {}, cancellations: [], usage: result.usage,
      localTripId: result.localTripId,
    };
    showPlanning(false);
    updateTripLink();
    newTrip();
    presentSummary(result.summary);
    render();
    $('#plan-tab').focus({ preventScroll: true });
    forecast.refresh();
  } catch (error) {
    if (signal.aborted) {
      showPlanning(false);
      render();
      if (!setupDialog.open) setupDialog.showModal();
      $('#setup-title').focus();
    } else {
      const discoveryFailed = planningPanel.dataset.phase === 'candidates';
      planningPhase('error', discoveryFailed ? 'หาตัวเลือกไม่สำเร็จ' : 'สร้างแผนทริปไม่สำเร็จ', discoveryFailed);
      $('#planning-error').textContent = error.message || 'กรุณาลองอีกครั้ง';
      $('#planning-error').hidden = false;
      $('#planning-retry').onclick = () => task(() => generateTrip(input));
      if (discoveryFailed) $('#planning-auto').onclick = () => task(() => generateTrip({ ...input, autonomy: 'auto' }));
      $('#planning-retry').focus({ preventScroll: true });
    }
  } finally {
    if (activePlanning === ctrl) activePlanning = null;
  }
}
setupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  $('#form-error').textContent = '';
  task(async () => {
    let input;
    try {
      input = setupInput(savedLocation(setupForm.city));
    } catch (error) {
      $('#form-error').textContent = error.message;
      $('#form-error').scrollIntoView({ block: 'center' });
      return;
    }
    await generateTrip(input);
  });
});
function clearChat() {
  activeReplan?.abort();
  activeReplan = null;
  $('#chat-response').hidden = true;
  $('#chat-steps').replaceChildren();
  $('#chat-retry').onclick = null;
  $('#chat-result').hidden = true;
  $('#chat-result').open = false;
  $('#chat-review').replaceChildren();
  $('#options').replaceChildren();
}
function chatState(phase, title, detail = '') {
  const response = $('#chat-response');
  response.dataset.state = phase;
  response.hidden = false;
  $('#chat-state').textContent = title;
  $('#chat-description').textContent = detail;
  $('#chat-description').hidden = !detail;
  $('#chat-cancel').hidden = phase !== 'running';
  $('#chat-dismiss').hidden = phase === 'running' || phase === 'decision';
  $('#chat-retry').hidden = phase !== 'error';
  $('#chat-state').toggleAttribute('data-waiting', phase === 'running' && !$('#chat-steps').childElementCount);
  if (phase !== 'running') finishTrace($('#chat-steps'), ['error', 'cancelled'].includes(phase) ? 'stopped' : 'done');
  response.scrollTop = 0;
}
function chatStep(text) {
  if (typeof text !== 'string' || !text.trim()) return;
  $('#chat-state').removeAttribute('data-waiting');
  appendTrace($('#chat-steps'), text);
}
$('#chat-cancel').onclick = () => activeReplan?.abort();
$('#chat-dismiss').onclick = () => {
  clearChat();
  $('#command').focus();
};
function applyOption(option, routes, summary = '') {
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
  const details = [...new Set([option.title, summary || option.head])].filter(Boolean);
  chatState('applied', 'ปรับแผนแล้ว', details.join(' · '));
  renderPlanReview($('#chat-review'), history.at(-1).plan, option);
  renderRepairOutcome($('#chat-review'), option.plan.repairOutcome);
  $('#chat-result').hidden = false;
  if (document.activeElement !== $('#command')) $('#chat-state').focus({ preventScroll: true });
  render();
  forecast.refresh();
}
async function adjust(command, day = state.selected) {
  if (!state.plan) return;
  const hadPreview = Boolean(preview);
  clearChat();
  preview = pendingVotes = null;
  if (hadPreview) render();
  status.textContent = '';
  $('#chat-command').textContent = command;
  chatState('running', 'Bop กำลังปรับแผน…');
  $('#chat-response').scrollIntoView({ block: 'nearest' });
  const pinnedPlan = structuredClone(state.plan);
  for (const stop of pinnedPlan.days.flatMap((d) => d.stops))
    if (state.bookings[stop.id]?.state === 'done') stop.res = { ...stop.res, done: true };
  const input = { plan: pinnedPlan, setup: state.setup, command, day };
  const ctrl = new AbortController();
  activeReplan = ctrl;
  const onStep = (text) => {
    if (activeReplan === ctrl && !ctrl.signal.aborted) chatStep(text);
  };
  let result;
  try {
    result = await api('/api/replan', input, undefined, { signal: ctrl.signal, onStep });
    ctrl.signal.throwIfAborted();
    if (!Array.isArray(result.options) || !result.options.length ||
        !result.options.every((option) => option?.plan?.days?.length && option.plan.days.every((d) => Array.isArray(d?.stops)))) {
      throw Error('ยังไม่ได้รับแผนที่สมบูรณ์');
    }
  } catch (error) {
    if (activeReplan !== ctrl) return;
    if (ctrl.signal.aborted) chatState('cancelled', 'ยกเลิกคำขอแล้ว');
    else {
      chatState('error', 'ปรับแผนไม่สำเร็จ', clean(error.message) || 'กรุณาลองอีกครั้ง');
      $('#chat-retry').onclick = () => task(() => adjust(command, day));
    }
    return;
  } finally {
    if (activeReplan === ctrl) activeReplan = null;
  }
  for (const option of result.options) option.usage = result.usage;
  if (!result.needs_vote) {
    applyOption(result.options[0], result.routes, result.summary);
    return;
  }
  pendingVotes = result;
  preview = { plan: result.options[0].plan, routes: result.routes };
  state.selected = result.day ?? state.selected;
  render();
  chatState('decision', 'อยากใช้แผนไหน?', result.vote_reason || result.summary);
  const area = $('#options');
  const choices = node('div', null, 'chat-choices');
  area.replaceChildren(choices);
  if (document.activeElement !== $('#command')) $('#chat-state').focus({ preventScroll: true });
  function showPreview(option) {
    preview = option ? { plan: option.plan, routes: result.routes } : null;
    state.selected = result.day ?? state.selected;
    for (const control of choices.querySelectorAll('[data-preview]')) {
      control.setAttribute('aria-pressed', String(control.dataset.preview === option?.key));
    }
    render();
  }
  const ballot = {};
  const localActions = [];
  for (const option of result.options) {
    const row = node('article', null, 'option');
    const heading = node('h3', option.key + ' · ' + option.title);
    row.append(heading);
    if (option.head && option.head !== option.title) row.append(node('p', option.head));
    const actions = node('div', null, 'inline');
    const compare = button('ดูตัวอย่าง', () => showPreview(option));
    compare.dataset.preview = option.key;
    compare.setAttribute('aria-pressed', String(option === result.options[0]));
    actions.append(compare);
    row.append(actions);
    renderPlanReview(row, state.plan, option);
    renderRepairOutcome(row, option.plan.repairOutcome);
    choices.append(row);
    localActions.push(() => actions.append(button('ใช้แผน ' + option.key, () => {
      applyOption(option, result.routes);
      setBusy(false);
    }, 'primary')));
  }
  area.append(button('ดูแผนปัจจุบัน', () => showPreview(null)));
  if (renderLineVote(area, state, result, (option) => applyOption(option, result.routes))) return;
  for (const show of localActions) show();
  area.append(button('คงแผนเดิม', () => {
    pendingVotes = preview = null;
    area.replaceChildren();
    render();
    chatState('kept', 'ใช้กำหนดการเดิม');
    $('#chat-state').focus({ preventScroll: true });
  }));
  area.append(node('h3', 'โหวตแผนกับเพื่อน'));
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
          voteStatus.textContent = 'รอสมาชิกโหวตให้ครบ';
          return;
        }
        const key = counts[0][1] === counts[1][1] ? tie.querySelector('select').value : counts[0][0];
        const selected = pendingVotes?.options.find((option) => option.key === key);
        if (selected) {
          applyOption(selected, result.routes);
          setBusy(false);
        } else voteStatus.textContent = 'คะแนนเสมอ ให้ผู้จัดทริปเลือก';
      },
      'primary',
    ),
  );
  const voteStatus = node('p', '', 'feedback');
  voteStatus.setAttribute('role', 'status');
  area.append(voteStatus);
}
$('#replan').addEventListener('submit', (event) => {
  event.preventDefault();
  const command = $('#command').value.trim();
  if (command && !busy) {
    $('#command').value = '';
    task(() => adjust(command));
  }
});
$('#undo').addEventListener('click', () => {
  if (!history.length) return;
  closePlaceSheet($('#place-panel'), { restoreFocus: false });
  state = history.pop();
  updateTripLink();
  preview = null;
  pendingVotes = null;
  forecast.refresh();
  clearChat();
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
      throw Error('ไม่พบลิงก์ทริปนี้แล้ว เริ่มสร้างทริปใหม่ได้');
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
else setupDialog.showModal();
