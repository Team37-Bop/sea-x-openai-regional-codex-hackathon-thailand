import { bindWorkspace, renderPeople } from './workspace-controls.js';
import { installSetupExtras, openPlaceSheet, chooseCandidates } from './setup-extras.js';
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
const modes = { undecided: 'ยังไม่เลือก', flight: 'เครื่องบิน', drive: 'ขับรถ', bus: 'รถบัส', train: 'รถไฟ' };
const travel = { red: 'รถแดง', walk: 'เดิน', car: 'รถรับจ้าง', own: 'รถส่วนตัว', van: 'รถตู้' };
const kind = {
  food: 'อาหาร',
  hotel: 'ที่พัก',
  nature: 'ธรรมชาติ',
  view: 'จุดชมวิว',
  sight: 'สถานที่เที่ยว',
  terminal: 'จุดเดินทางกลับ',
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
  document.querySelector('.actions').hidden = !plan || view !== 'plan';
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
  if (usageNote)
    usageNote.textContent = state.sample
      ? 'ทริปตัวอย่าง'
      : state.usage?.provider === 'openai'
        ? 'สร้างด้วย OpenAI'
        : state.usage?.provider === 'fake'
          ? 'ข้อมูลทดสอบ'
          : '';
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
      row.dataset.focused = String(stop.id === focusedStop);
      row.setAttribute('aria-label', stop.name + ' รายละเอียด');
      row.addEventListener('keydown', (event) => {
        if (event.target === row && [' ', 'Enter'].includes(event.key)) {
          event.preventDefault();
          place(stop);
        }
      });
      const time = node('time', stop.start);
      time.append(node('small', stop.end));
      const content = node('div');
      content.append(
        node('h3', stop.name),
        node('p', (kind[stop.kind] || 'กิจกรรม') + ' · ฿' + cash.format(stop.cost || 0) + ' / คน'),
      );
      const badge = forecast.badge(stop, state.selected, plan);
      if (badge) content.append(badge);
      const closure = (stop.closures || []).find((c) => (c?.date ?? c) === day.date);
      if (closure)
        content.append(node('p', 'ปิดวันที่เลือก' + (closure.why ? ' · ' + closure.why : ''), 'feedback'));
      content.append(button('รายละเอียด', () => place(stop)));
      if (stop.res?.todo || stop.res?.done || state.bookings[stop.id]) {
        const booked = state.bookings[stop.id]?.state;
        content.append(
          button(
            booked === 'move' ? 'ต้องโทรเลื่อน' : booked === 'done' ? 'จองแล้ว ✓' : 'ทำเครื่องหมายว่าจองแล้ว',
            () => {
              if (booked === 'done') delete state.bookings[stop.id];
              else state.bookings[stop.id] = { state: 'done', name: stop.name, time: stop.start };
              render();
            },
          ),
        );
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
    for (const problem of item.problems || []) row.append(node('p', problem));
    $('#checks-list').append(row);
  }
  $('#leg-label').textContent = day?.stops.some((stop) => stop.leg && !stop.leg.real)
    ? 'เส้นประเป็นเส้นทางประมาณ'
    : '';
  $('#reservations').replaceChildren();
  for (const [dir, route] of Object.entries(plan.flags?.transport ?? {})) {
    const chosen =
      route.chosenOption ||
      route.options?.find((option) => option.id === route.chosen) ||
      (typeof route.chosen === 'object' ? route.chosen : null);
    if (!chosen) continue;
    const area = node('article', null, 'alert');
    area.append(
      node('h3', dir === 'go' ? 'การเดินทางขาไป' : 'การเดินทางขากลับ'),
      node('p', [chosen.carrier, chosen.code, chosen.dep + '–' + chosen.arr].filter(Boolean).join(' · ')),
    );
    for (const option of route.options ?? []) {
      if (option.id === chosen.id) continue;
      area.append(
        button('เลือก ' + [option.carrier, option.code, option.dep].filter(Boolean).join(' '), () =>
          task(() =>
            adjust(
              'เปลี่ยน' +
                (modes[option.by] ?? 'การเดินทาง') +
                (dir === 'go' ? 'ขาไป' : 'ขากลับ') +
                'เป็น ' +
                [option.carrier, option.code, 'ออก', option.dep, 'ถึง', option.arr].filter(Boolean).join(' '),
            ),
          ),
        ),
      );
    }
    $('#reservations').append(area);
  }
  for (const cancel of state.cancellations)
    $('#reservations').append(
      node(
        'p',
        'ติดต่อยกเลิก · ' + [cancel.name, cancel.day, cancel.time, cancel.phone].filter(Boolean).join(' · '),
        'alert',
      ),
    );
  for (const booking of Object.values(state.bookings))
    if (booking.state === 'move') {
      $('#reservations').append(
        node(
          'p',
          'ต้องโทรเลื่อน: ' + booking.name + ' จาก ' + booking.time + ' เป็น ' + booking.next,
          'alert',
        ),
      );
    }
  const reservations = state.plan.days
    .flatMap((day) => day?.stops || [])
    .filter((stop) => stop.res?.todo || stop.res?.done || state.bookings[stop.id]);
  const todo =
    reservations.filter((stop) => state.bookings[stop.id]?.state !== 'done').length +
    state.cancellations.length;
  $('#booking-count').textContent = todo ? '(' + todo + ')' : '';
  if (todo)
    $('#itinerary').append(button('ดูรายการที่ต้องติดต่อ ' + todo + ' รายการ', () => switchView('book')));
  for (const stop of reservations) {
    const booked = state.bookings[stop.id]?.state === 'done';
    const row = node('article', null, 'alert');
    row.append(
      node('strong', stop.name),
      node('p', stop.start),
      button(booked ? 'จองแล้ว ✓ · ตั้งเป็นรอติดต่อ' : 'ทำเครื่องหมายว่าจองแล้ว', () => {
        if (booked) delete state.bookings[stop.id];
        else state.bookings[stop.id] = { state: 'done', name: stop.name, time: stop.start };
        render();
      }),
      button('สถานที่เต็ม · หาแห่งใหม่', () => {
        switchView('plan');
        task(() => adjust('ร้าน ' + stop.name + ' เต็ม ช่วยหาที่อื่นแทน'));
      }),
    );
    $('#reservations').append(row);
  }
  forecast.renderStrip($('#alerts'), plan, state.selected);
  renderTripIntegrations($('#reservations'), state);
  if (view === 'plan')
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
  focusedStop = stop.id;
  render();
  return openPlaceSheet({
    dialog: detail,
    content: detailContent,
    stop,
    city: state.plan.city,
    sample: state.sample === true,
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
  $(selector).addEventListener('click', () => setupDialog.showModal());
$('#close-setup').addEventListener('click', () => setupDialog.close());
for (const [dir, title, placeName] of [
  ['arrive', 'ขาไป', 'ออกจาก'],
  ['depart', 'ขากลับ', 'กลับไปที่'],
]) {
  const area = node('fieldset');
  area.append(
    node('legend', title),
    selectField('วิธีเดินทาง', dir + 'By', modes, 'undecided'),
    field(placeName, dir + 'Place', { maxLength: 90 }),
    field(dir === 'arrive' ? 'เวลาถึง' : 'เวลาออก', dir + 'Time', { type: 'time' }),
  );
  $('#directions').append(area);
}
const augmentSetup = installSetupExtras(setupForm, async () =>
  setupInput(await locate(setupForm.city.value.trim()).catch(() => null)),
);
let nextMember = 0;
function addMember(name = '') {
  if ($('#members').children.length >= 12) return;
  const row = node('div', null, 'member');
  row.dataset.id = 'member-' + ++nextMember;
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
}
function updateStay(reset = false) {
  const nights = tripLength() - 1;
  $('#stays').hidden = setupForm.stayMode.value !== 'booked';
  if ($('#stays').hidden) return;
  const area = $('#stay-rows');
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
setupForm.stayMode.addEventListener('change', () => updateStay(true));
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
  if (Object.hasOwn(presets, city)) {
    const [cc, currency, lat, lon] = presets[city];
    return { cc, currency, ll: [lat, lon] };
  }
  if (lookupCache.has(city)) return lookupCache.get(city);
  const response = await fetch('/api/city?q=' + encodeURIComponent(city));
  const found = response.ok ? await response.json() : null;
  if (found)
    found.currency =
      Object.values(presets).find((row) => row[0] === found.cc)?.[1] ??
      { US: 'USD', GB: 'GBP', MY: 'MYR', SG: 'SGD', CN: 'CNY', ID: 'IDR', AU: 'AUD', FR: 'EUR', DE: 'EUR' }[
        found.cc
      ] ??
      'THB';
  lookupCache.set(city, found);
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
function setupInput(found) {
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
      time: setupForm.elements[key + 'Time'].value,
    };
  const stays = [...$('#stay-rows').children].map((row) => ({
    name: row.querySelector('[name=stayName]').value.trim(),
    nights: Number(row.querySelector('[name=nights]').value),
  }));
  const nights = tripLength() - 1;
  const booked = setupForm.stayMode.value === 'booked';
  if (booked && nights) {
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
      name: read('person'),
      avoid: read('avoid'),
      maxWalkKm: read('walk'),
      budget: read('budget'),
      wants: read('wants')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      note: read('note'),
    };
  });
  if (!members.some((m) => m.name)) throw Error('ต้องมีสมาชิกที่ระบุชื่ออย่างน้อย 1 คน');
  return augmentSetup({
    city: setupForm.city.value.trim(),
    cityLL: found?.ll,
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
  preview = null;
  history.push(structuredClone(state));
  const nextStops = option.plan.days.flatMap((day) => day.stops);
  const bookings = { ...state.bookings };
  const cancellations = [...state.cancellations];
  for (const [id, booking] of Object.entries(bookings)) {
    const stop = nextStops.find((item) => item.id === id && item.name === booking.name);
    if (!stop) {
      const former = state.plan.days.find((d) => d.stops.some((s) => s.id === id));
      const old = former?.stops.find((s) => s.id === id);
      cancellations.push({ ...booking, day: former?.date, phone: old?.res?.phone || old?.phone });
      delete bookings[id];
    } else if (stop.start !== booking.time) bookings[id] = { ...booking, state: 'move', next: stop.start };
  }
  state = {
    ...state,
    plan: option.plan,
    setup: option.plan.setup,
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
  const input = { plan: pinnedPlan, setup: state.setup, command, day, demo: state.demo };
  if (
    state.sample &&
    !/ฝน|น้ำตก|ร้าน.*(?:เต็ม|ปิด)|(?:เต็ม|ปิด).*ร้าน|ดีเลย์|เที่ยวบิน.*(?:ช้า|เลื่อน)/.test(command)
  ) {
    status.textContent = 'ลองพิมพ์ ฝนตก ร้านปิด ร้านเต็ม เที่ยวบินดีเลย์ หรือตัดน้ำตกออก';
    return;
  }
  const result = state.sample
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
  for (const option of result.options) {
    const row = node('article', null, 'option');
    row.append(node('strong', option.key + ' · ' + option.title), node('p', option.line));
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
  }
  if (renderLineVote(area, state, result, (option) => applyOption(option, result.routes))) return;
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
    newTrip();
    state.localTripId = localTrip[1];
    presentSummary(saved.summary);
    render();
    forecast.refresh();
  });
else if (new URLSearchParams(location.search).has('demo')) task(demo);
else setupDialog.showModal();
