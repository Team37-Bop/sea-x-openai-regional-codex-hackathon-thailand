const $ = selector => document.querySelector(selector);
const setupForm = $('#setup-form');
const setupDialog = $('#setup-dialog');
const detail = $('#detail');
const status = $('#status');
const cash = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const calendar = new Intl.DateTimeFormat('th-TH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const presets = {
  'เชียงใหม่': ['TH', 'THB', 18.7883, 98.9853], 'กรุงเทพฯ': ['TH', 'THB', 13.7563, 100.5018],
  'ดานัง': ['VN', 'VND', 16.0544, 108.2022], 'โตเกียว': ['JP', 'JPY', 35.6762, 139.6503],
  'ไทเป': ['TW', 'TWD', 25.033, 121.5654], 'โซล': ['KR', 'KRW', 37.5665, 126.978],
};
const modes = { undecided: 'ยังไม่เลือก', flight: 'เครื่องบิน', drive: 'ขับรถ', bus: 'รถบัส', train: 'รถไฟ' };
const travel = { red: 'รถแดง', walk: 'เดิน', car: 'รถรับจ้าง', own: 'รถส่วนตัว', van: 'รถตู้' };
const kind = { food: 'อาหาร', hotel: 'ที่พัก', nature: 'ธรรมชาติ', view: 'จุดชมวิว', sight: 'สถานที่เที่ยว', terminal: 'จุดเดินทางกลับ' };
const dayMs = 86_400_000;
const ymd = time => new Date(time).toISOString().slice(0, 10);
const tripLength = () => Math.min(7, Math.max(1, Math.round((Date.parse(setupForm.endDate.value) - Date.parse(setupForm.startDate.value)) / dayMs) + 1 || 1));
const dateLabel = value => calendar.format(new Date(value + 'T00:00:00Z'));
const lookupCache = new Map();
const history = [];
let state = { plan: null, routes: {}, setup: {}, selected: 0, demo: true, bookings: {}, cancellations: [] };
let busy = false;
let map;
let layers;
let pendingVotes = null;
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
  if (typeof value === 'string') return ['url', 'page', 'href', 'model', 'id'].includes(key) ? value : value.replace(/Claude|Anthropic/gi, 'Bop');
  if (Array.isArray(value)) return value.map(item => clean(item, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
  return value;
}
async function api(path, payload, onDay) {
  const response = await fetch(path, payload === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) throw new Error('Bop ติดต่อบริการไม่ได้');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  let terminal;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += value;
    const rows = pending.split('\n');
    pending = rows.pop();
    for (const row of rows) {
      if (!row) continue;
      const event = clean(JSON.parse(row));
      if (event.type === 'step') status.textContent = event.text;
      if (event.type === 'day') onDay?.(event);
      if (['done', 'error'].includes(event.type)) terminal = event;
    }
  }
  if (!terminal) throw new Error('Bop ได้ข้อมูลไม่ครบ');
  if (terminal.type === 'error') throw Object.assign(new Error(terminal.message), { code: terminal.code });
  return terminal;
}
function setBusy(value) {
  busy = value;
  for (const selector of ['#demo', '#open-setup', '#hero-setup', '#weather', '#replan button']) $(selector).disabled = value;
  $('#undo').disabled = value || !history.length;
}
async function task(action) {
  if (busy) return;
  setBusy(true);
  try { await action(); }
  catch (error) { status.textContent = error.message || 'Bop ทำรายการไม่สำเร็จ'; }
  finally { setBusy(false); }
}
function showPhoto(photo, name) {
  if (typeof photo?.url !== 'string' || !photo.url.startsWith('https://')) return document.createDocumentFragment();
  const image = node('img');
  image.src = photo.url;
  image.alt = name;
  image.loading = 'lazy';
  const group = node('figure', null, 'place-photo');
  const credit = node('figcaption', photo.credit);
  group.append(image, credit);
  return group;
}
function formatDay(day) {
  return day?.date ? dateLabel(day.date) : '';
}
function renderMap(day) {
  if (!window.L || !day?.stops.length) {
    if (layers) layers.clearLayers();
    const fallback = $('#map-fallback');
    if (fallback) fallback.textContent = day?.stops.length ? 'เปิดแผนที่ไม่สำเร็จ' : 'ยังไม่มีจุดแวะ';
    return;
  }
  const L = window.L;
  if (!map) {
    $('#map').replaceChildren();
    map = L.map('map', { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layers = L.layerGroup().addTo(map);
  }
  layers.clearLayers();
  for (const [i, stop] of day.stops.entries()) {
    const marker = L.circleMarker(stop.ll, { radius: 8, color: '#fff', weight: 2, fillColor: '#214b39', fillOpacity: 1 }).addTo(layers);
    marker.bindTooltip(node('span', (i + 1) + '. ' + stop.name));
    if (i && stop.leg) {
      const geometry = state.routes[stop.leg.key] ?? [day.stops[i - 1].ll, stop.ll];
      L.polyline(geometry, { color: '#386b4a', weight: 4, dashArray: stop.leg.real ? null : '7 7' }).addTo(layers);
    }
  }
  map.fitBounds(L.latLngBounds(day.stops.map(stop => stop.ll)).pad(.16), { maxZoom: 14, animate: false });
}
function render() {
  const plan = state.plan;
  const day = plan?.days[state.selected];
  $('#tabs').replaceChildren();
  $('#itinerary').replaceChildren();
  $('#checks-list').replaceChildren();
  $('#totals').textContent = '';
  $('#checks-count').textContent = '';
  if (!plan) {
    $('#itinerary').append(node('p', 'ยังไม่มีแผนทริป', 'empty'));
    return;
  }
  $('#city-title').textContent = plan.city;
  $('#trip-summary').textContent = plan.days.length + ' วัน · เพื่อน ' + (state.setup.members?.length ?? 0) + ' คน';
  const stops = plan.days.flatMap(row => row?.stops ?? []);
  const total = stops.reduce((sum, stop) => sum + Number(stop.cost || 0) + Number(stop.leg?.cost || 0), 0);
  $('#totals').textContent = '฿' + cash.format(total) + ' / คน';
  for (let i = 0; i < plan.days.length; i++) {
    const tab = button('วันที่ ' + (i + 1), () => { state.selected = i; render(); });
    tab.setAttribute('aria-current', i === state.selected ? 'true' : 'false');
    $('#tabs').append(tab);
  }
  if (!day?.stops.length) $('#itinerary').append(node('p', day ? 'ยังไม่มีจุดแวะในวันนี้' : 'Bop กำลังจัดแผนวันนี้', 'empty'));
  else {
    const title = node('h3', day.title, 'day-title');
    title.append(node('small', formatDay(day)));
    $('#itinerary').append(title);
    for (const stop of day.stops) {
      if (stop.leg) $('#itinerary').append(node('p', (travel[stop.leg.mode] || 'เดินทาง') + ' · ' + stop.leg.min + ' นาที · ' + stop.leg.km.toFixed(1) + ' กม.' + (stop.leg.real ? '' : ' โดยประมาณ'), 'leg'));
      const row = node('article', null, 'stop');
      const time = node('time', stop.start);
      time.append(node('small', stop.end));
      const content = node('div');
      content.append(node('h3', stop.name), node('p', (kind[stop.kind] || 'กิจกรรม') + ' · ฿' + cash.format(stop.cost || 0) + ' / คน'));
      content.append(button('รายละเอียด', () => place(stop)));
      if (['food', 'hotel'].includes(stop.kind)) {
        const booked = state.bookings[stop.id]?.state;
        content.append(button(booked === 'move' ? 'ต้องโทรเลื่อน' : booked === 'done' ? 'จองแล้ว ✓' : 'ทำเครื่องหมายว่าจองแล้ว', () => {
          if (booked === 'done') delete state.bookings[stop.id];
          else state.bookings[stop.id] = { state: 'done', name: stop.name, time: stop.start };
          render();
        }));
      }
      row.append(time, content);
      $('#itinerary').append(row);
    }
  }
  const checks = plan.checks ?? [];
  if (checks.length) $('#checks-count').textContent = checks.filter(item => item.pass).length + ' / ' + checks.length + ' ผ่าน';
  for (const item of checks) {
    const row = node('div', null, 'check-row');
    row.append(node('b', item.pass ? '✓' : '!', item.pass ? '' : 'fail'), document.createTextNode(item.label));
    for (const problem of item.problems) row.append(node('p', problem));
    $('#checks-list').append(row);
  }
  $('#leg-label').textContent = day?.stops.some(stop => stop.leg && !stop.leg.real) ? 'เส้นประเป็นเส้นทางประมาณ' : '';
  $('#reservations').replaceChildren();
  for (const [dir, route] of Object.entries(plan.flags?.transport ?? {})) {
    const chosen = route.chosen;
    if (!chosen) continue;
    const area = node('article', null, 'alert');
    area.append(node('h3', dir === 'go' ? 'การเดินทางขาไป' : 'การเดินทางขากลับ'),
      node('p', [chosen.carrier, chosen.code, chosen.dep + '–' + chosen.arr].filter(Boolean).join(' · ')));
    for (const option of route.options ?? []) {
      if (option.id === chosen.id) continue;
      area.append(button('เลือก ' + [option.carrier, option.code, option.dep].filter(Boolean).join(' '), () =>
        task(() => adjust('เปลี่ยน' + (modes[option.by] ?? 'การเดินทาง') + (dir === 'go' ? 'ขาไป' : 'ขากลับ') + 'เป็น '
          + [option.carrier, option.code, 'ออก', option.dep, 'ถึง', option.arr].filter(Boolean).join(' ')))));
    }
    $('#reservations').append(area);
  }
  for (const cancel of state.cancellations) $('#reservations').append(node('p', 'ยกเลิกการจอง: ' + cancel.name, 'alert'));
  for (const booking of Object.values(state.bookings)) if (booking.state === 'move') {
    $('#reservations').append(node('p', 'ต้องโทรเลื่อน: ' + booking.name + ' จาก ' + booking.time + ' เป็น ' + booking.next, 'alert'));
  }
  renderMap(day);
}
window.addEventListener('load', () => { if (state.plan) render(); }, { once: true });
const detailContent = $('#detail-content');
$('#detail-close').addEventListener('click', () => detail.close());
async function place(stop) {
  detailContent.replaceChildren(node('h2', stop.name), node('p', (kind[stop.kind] || 'กิจกรรม') + ' · ' + stop.start + '–' + stop.end, 'muted'));
  if (!detail.open) detail.showModal();
  if (state.demo) { detailContent.append(node('p', 'จุดแวะในทริปตัวอย่าง', 'empty')); return; }
  try {
    const { info: place } = await api('/api/place-info', { stop: { id: stop.id, n: stop.name, k: stop.kind, ll: stop.ll }, city: state.plan.city });
    if (detailContent.querySelector('h2')?.textContent !== stop.name) return;
    for (const line of [place.summary, place.details?.what, place.details?.address, place.phone]) if (typeof line === 'string') detailContent.append(node('p', line));
    for (const photo of place.photos ?? []) detailContent.append(showPhoto(photo, stop.name));
    for (const dish of place.dishes ?? []) detailContent.append(node('p', dish.name + (dish.price == null ? '' : ' · ฿' + cash.format(dish.price))));
    for (const source of place.sources) {
      const link = node('a', source.title || source.url);
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      detailContent.append(node('br'), link);
    }
  } catch (error) { detailContent.append(node('p', error.message, 'muted')); }
}
async function demo() {
  const result = await api('/api/demo');
  history.length = 0;
  pendingVotes = null;
  $('#options').replaceChildren();
  $('#alerts').replaceChildren();
  state = { plan: result.plan, routes: result.routes, setup: result.plan.setup, selected: 0, demo: true, bookings: {}, cancellations: [] };
  status.textContent = 'กำลังดูทริปตัวอย่างเชียงใหม่';
  render();
}
$('#demo').addEventListener('click', () => task(demo));
for (const selector of ['#open-setup', '#hero-setup']) $(selector).addEventListener('click', () => setupDialog.showModal());
$('#close-setup').addEventListener('click', () => setupDialog.close());
for (const [dir, title, placeName] of [['arrive', 'ขาไป', 'ออกจาก'], ['depart', 'ขากลับ', 'กลับไปที่']]) {
  const area = node('fieldset');
  area.append(node('legend', title), selectField('วิธีเดินทาง', dir + 'By', modes, 'undecided'),
    field(placeName, dir + 'Place', { maxLength: 90 }), field(dir === 'arrive' ? 'เวลาถึง' : 'เวลาออก', dir + 'Time', { type: 'time' }));
  $('#directions').append(area);
}
let nextMember = 0;
function addMember(name = '') {
  if ($('#members').children.length >= 12) return;
  const row = node('div', null, 'member');
  row.dataset.id = 'member-' + ++nextMember;
  const info = node('div', null, 'fields');
  info.append(field('ชื่อ', 'person', { value: name, maxLength: 60 }), field('แพ้/ไม่ทาน', 'avoid', { maxLength: 120 }));
  const limits = node('div', null, 'fields');
  limits.append(field('งบต่อคน (บาท)', 'budget', { type: 'number', min: 1 }), field('เดินได้ (กม./วัน)', 'walk', { type: 'number', min: .1 }));
  limits.querySelector('[name=walk]').step = '.1';
  row.append(button('นำสมาชิกออก', () => { if ($('#members').children.length > 1) row.remove(); }),
    info, limits, field('อยากไปหรืออยากทำ (คั่นด้วยจุลภาค)', 'wants', { maxLength: 250 }), field('หมายเหตุ', 'note', { maxLength: 250 }));
  $('#members').append(row);
}
$('#add-member').addEventListener('click', () => addMember());
addMember();
function addStay(nights) {
  const row = node('div', null, 'stay-row');
  const fields = node('div', null, 'fields');
  fields.append(field('ชื่อหรือที่อยู่ที่พัก', 'stayName', { maxLength: 120 }), field('จำนวนคืน', 'nights', { type: 'number', value: nights, min: 0, max: 6 }));
  const dates = node('p', null, 'muted');
  row.append(fields, dates, button('นำที่พักออก', () => {
    if ($('#stay-rows').children.length < 2) return;
    const value = Number(row.querySelector('[name=nights]').value);
    row.remove();
    const last = $('#stay-rows').lastElementChild.querySelector('[name=nights]');
    last.value = Number(last.value) + value;
    updateStay();
  }));
  $('#stay-rows').append(row);
}
function updateStay(reset = false) {
  const nights = tripLength() - 1;
  $('#stays').hidden = setupForm.stayMode.value !== 'booked';
  if ($('#stays').hidden) return;
  const area = $('#stay-rows');
  if (!area.children.length) addStay(nights);
  if (!nights && area.children.length > 1) while (area.children.length > 1) area.lastElementChild.remove();
  if (reset && area.children.length === 1) area.firstElementChild.querySelector('[name=nights]').value = nights;
  let cursor = 0;
  for (const row of area.children) {
    const input = row.querySelector('[name=nights]');
    input.parentElement.hidden = !nights;
    input.min = nights ? '1' : '0';
    if (!nights) input.value = 0;
    row.querySelector('button').hidden = area.children.length === 1;
    const start = Date.parse(setupForm.startDate.value) + cursor * dayMs;
    cursor += Number(input.value);
    row.querySelector('p').textContent = nights && Number.isFinite(start) ? calendar.format(start) + ' → ' + calendar.format(Date.parse(setupForm.startDate.value) + cursor * dayMs) : '';
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
  const take = existing.findLast(input => Number(input.value) > 1);
  if (!hasSpace && take) take.value = Number(take.value) - 1;
  if (hasSpace || take) addStay(1);
  updateStay();
});
$('#stay-rows').addEventListener('input', () => updateStay());
setupForm.stayMode.addEventListener('change', () => updateStay(true));
const now = Date.now();
setupForm.startDate.value = ymd(now + dayMs);
setupForm.endDate.value = ymd(now + dayMs * 3);
for (const input of [setupForm.startDate, setupForm.endDate]) input.addEventListener('change', () => {
  setupForm.endDate.min = setupForm.startDate.value;
  if (setupForm.endDate.value < setupForm.startDate.value) setupForm.endDate.value = setupForm.startDate.value;
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
  if (found) found.currency = Object.values(presets).find(row => row[0] === found.cc)?.[1] ?? ({ US: 'USD', GB: 'GBP', MY: 'MYR', SG: 'SGD', CN: 'CNY', ID: 'IDR', AU: 'AUD', FR: 'EUR', DE: 'EUR' })[found.cc] ?? 'THB';
  lookupCache.set(city, found);
  return found;
}
setupForm.city.addEventListener('change', async () => {
  const city = setupForm.city.value.trim();
  const found = await locate(city).catch(() => null);
  if (setupForm.city.value.trim() === city) $('#city-result').textContent = found ? [found.cc, found.currency].filter(Boolean).join(' · ') : 'ยังไม่พบเมืองนี้บนแผนที่';
});
function setupInput(found) {
  const dirs = {};
  for (const [key, place] of [['arrive', 'from'], ['depart', 'to']]) dirs[key] = {
    by: setupForm.elements[key + 'By'].value, [place]: setupForm.elements[key + 'Place'].value, time: setupForm.elements[key + 'Time'].value,
  };
  const stays = [...$('#stay-rows').children].map(row => ({
    name: row.querySelector('[name=stayName]').value.trim(), nights: Number(row.querySelector('[name=nights]').value),
  }));
  const nights = tripLength() - 1;
  const booked = setupForm.stayMode.value === 'booked';
  if (booked && nights) {
    for (const [index, row] of stays.entries()) {
      if (!row.name) throw new Error('ใส่ชื่อหรือที่อยู่ที่พักแถว ' + (index + 1) + ' หรือเลือก “ให้ Bop แนะนำ”');
      if (!Number.isInteger(row.nights) || row.nights < 1) throw new Error('ที่พักแถว ' + (index + 1) + ' ต้องมีอย่างน้อย 1 คืน');
    }
    const sum = stays.reduce((count, row) => count + row.nights, 0);
    if (sum !== nights) throw new Error('จำนวนคืนรวม ' + sum + ' คืน ไม่ตรงกับทริป ' + nights + ' คืน แก้ให้รวมกันได้ ' + nights + ' คืน');
  }
  const members = [...$('#members').children].map(row => {
    const read = key => row.querySelector('[name=' + key + ']').value.trim();
    return { id: row.dataset.id, name: read('person'), avoid: read('avoid'), maxWalkKm: read('walk'),
      budget: read('budget'), wants: read('wants').split(',').map(item => item.trim()).filter(Boolean), note: read('note') };
  });
  return {
    city: setupForm.city.value.trim(), cityLL: found?.ll, country: found?.cc, currency: found?.currency,
    startDate: setupForm.startDate.value, endDate: setupForm.endDate.value, ...dirs,
    hasCar: setupForm.hasCar.checked || Object.values(dirs).some(dir => dir.by === 'drive'),
    stay: booked && stays.some(row => row.name) ? { mode: 'booked', stays } : { mode: 'auto' },
    members, pace: setupForm.pace.value, autonomy: setupForm.autonomy.value,
  };
}
async function askQuestions(questions) {
  const picks = { must: [], avoid: [] };
  for (const question of questions) {
    const result = await new Promise(resolve => {
      const collect = () => {
        for (const option of question.options) {
          const choice = detailContent.querySelector('[data-option="' + CSS.escape(option.id) + '"]').value;
          if (choice === 'yes') picks.must.push(option);
          if (choice === 'no') picks.avoid.push(option.id);
        }
      };
      const close = () => { collect(); resolve(false); };
      detailContent.replaceChildren(node('h2', question.title));
      for (const option of question.options) {
        const row = node('div', null, 'question-option');
        row.append(node('strong', option.name));
        if (option.photo) row.append(showPhoto(option.photo, option.name));
        if (option.why) row.append(node('p', option.why));
        const choice = selectField('คำตอบของกลุ่ม', 'answer', { unsure: 'ไม่แน่ใจ', yes: 'สนใจ', no: 'ไม่เอา' }, 'unsure');
        choice.querySelector('select').dataset.option = option.id;
        row.append(choice);
        detailContent.append(row);
      }
      detailContent.append(button('ถัดไป', () => {
        detail.removeEventListener('close', close);
        collect(); detail.close(); resolve(true);
      }, 'primary'), button('ให้ Bop เลือกที่เหลือเอง', () => detail.close()));
      detail.addEventListener('close', close, { once: true });
      detail.showModal();
    });
    if (!result) break;
  }
  return picks;
}
setupForm.addEventListener('submit', event => {
  event.preventDefault();
  $('#form-error').textContent = '';
  task(async () => {
    let input;
    try { input = setupInput(await locate(setupForm.city.value.trim()).catch(() => null)); }
    catch (error) { $('#form-error').textContent = error.message; return; }
    setupDialog.close();
    const previous = state;
    try {
      const health = await fetch('/api/health').then(response => response.json());
      if (!health.provider) {
        await demo();
        status.textContent = 'ยังไม่ได้เชื่อมต่อบริการวางแผน · เปิดทริปตัวอย่างเชียงใหม่แล้ว';
        return;
      }
      if (input.autonomy === 'ask') {
        const { questions } = await api('/api/plan/candidates', { setup: input });
        input.picks = await askQuestions(questions);
      }
      const progress = { plan: { city: input.city, days: Array(tripLength()).fill(null) }, routes: {}, setup: input, selected: 0, demo: false, bookings: {}, cancellations: [] };
      const result = await api('/api/plan', { setup: input }, event => {
        state = progress;
        progress.plan.days[event.index] = event.day;
        Object.assign(progress.routes, event.routes);
        render();
      });
      state = { ...progress, plan: result.plan, routes: result.routes, setup: result.plan.setup, demo: health.provider === 'fake' };
      history.length = 0;
      $('#options').replaceChildren();
      $('#alerts').replaceChildren();
      status.textContent = result.summary;
      render();
    } catch (error) { state = previous; render(); throw error; }
  });
});
function applyOption(option, routes) {
  history.push(structuredClone(state));
  const nextStops = option.plan.days.flatMap(day => day.stops);
  const bookings = { ...state.bookings };
  const cancellations = [...state.cancellations];
  for (const [id, booking] of Object.entries(bookings)) {
    const stop = nextStops.find(item => item.id === id && item.name === booking.name);
    if (!stop) { cancellations.push(booking); delete bookings[id]; }
    else if (stop.start !== booking.time) bookings[id] = { ...booking, state: 'move', next: stop.start };
  }
  state = { ...state, plan: option.plan, setup: option.plan.setup, routes: { ...state.routes, ...routes }, bookings, cancellations };
  pendingVotes = null;
  $('#options').replaceChildren();
  $('#alerts').replaceChildren();
  render();
}
async function adjust(command, day = state.selected) {
  if (!state.plan) return;
  const result = await api('/api/replan', { plan: state.plan, setup: state.setup, command, day, demo: state.demo });
  status.textContent = result.summary;
  if (!result.needs_vote) { applyOption(result.options[0], result.routes); return; }
  pendingVotes = result;
  const area = $('#options');
  area.replaceChildren(node('h3', 'โหวตแผนกับเพื่อน'));
  const ballot = {};
  for (const option of result.options) {
    const row = node('article', null, 'option');
    row.append(node('strong', option.key + ' · ' + option.title), node('p', option.line));
    area.append(row);
  }
  const selectedLabels = Object.fromEntries(result.options.map(option => [option.key, option.title]));
  for (const member of state.setup.members) {
    const voter = selectField(member.name, member.id, { '': 'ยังไม่ได้โหวต', ...selectedLabels }, '');
    voter.addEventListener('change', event => { ballot[member.id] = event.target.value; });
    area.append(voter);
  }
  const tie = selectField('ตัวเลือกกรณีคะแนนเสมอ (ผู้จัดทริป)', 'tie', { '': 'เลือกเมื่อคะแนนเสมอ', ...selectedLabels }, '');
  area.append(tie, button('ใช้ผลโหวต', () => {
    const counts = result.options.map(option => [option.key, Object.values(ballot).filter(vote => vote === option.key).length]).sort((a, b) => b[1] - a[1]);
    if (Object.values(ballot).filter(Boolean).length < state.setup.members.length) { status.textContent = 'รอสมาชิกโหวตให้ครบ'; return; }
    const key = counts[0][1] === counts[1][1] ? tie.querySelector('select').value : counts[0][0];
    const selected = pendingVotes?.options.find(option => option.key === key);
    if (selected) { applyOption(selected, result.routes); setBusy(false); }
    else status.textContent = 'คะแนนเสมอ ให้ผู้จัดทริปเลือก';
  }, 'primary'));
}
$('#replan').addEventListener('submit', event => {
  event.preventDefault();
  const command = $('#command').value.trim();
  if (command) task(() => adjust(command));
});
$('#undo').addEventListener('click', () => {
  if (!history.length) return;
  state = history.pop();
  $('#options').replaceChildren();
  $('#alerts').replaceChildren();
  status.textContent = 'ย้อนกลับเป็นแผนก่อนหน้าแล้ว';
  setBusy(false);
  render();
});
$('#weather').addEventListener('click', () => task(async () => {
  if (!state.plan) return;
  const result = await api('/api/weather-check', { plan: state.plan, setup: state.setup });
  const list = $('#alerts');
  list.replaceChildren();
  if (!result.alerts.length) {
    const message = { unavailable: 'ยังอ่านข้อมูลฝนไม่ได้', beyond_horizon: 'วันเดินทางอยู่นอกช่วงพยากรณ์' }[result.reason] || 'ไม่พบฝนที่กระทบจุดแวะกลางแจ้ง';
    list.append(node('p', message + ' · ข้อมูลอากาศ: Open-Meteo.com', 'alert'));
  }
  for (const alert of result.alerts) {
    const row = node('article', null, 'alert');
    const text = (alert.level === 'heavy' ? 'ฝนตกหนัก' : 'มีโอกาสฝน') + ' ' + alert.from + '–' + alert.to + ' วันที่ ' + (alert.day + 1) + ' ที่ ' + alert.n + ' (โอกาส ' + alert.prob + '% ~' + alert.mm + ' มม./ชม.)';
    row.append(node('p', text + (alert.trend ? ' · แนวโน้ม' : '') + ' · ข้อมูลอากาศ: Open-Meteo.com'),
      button('ให้ Bop ปรับแผน', () => task(() => adjust('พยากรณ์' + text + ' ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม', alert.day))),
      button('ปิด', () => row.remove()));
    list.append(row);
  }
}));
task(demo);
