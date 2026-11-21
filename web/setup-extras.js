import { fetchStream, readEvents } from './stream.js';
import { resolveTransportEndpoints, localTransport } from './transport-endpoints.js';

const money = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const travel = { flight: 'เครื่องบิน', bus: 'รถบัส', train: 'รถไฟ', drive: 'รถยนต์' };
function plain(value) {
  return typeof value === 'string'
    ? value
        .replace(/!?\[([^\]]*)\]\((?:<?https?:\/\/)[^)]*\)/gi, '$1')
        .replace(/<(https?:\/\/[^>]+)>/gi, '$1')
        .replace(/Claude|Anthropic/gi, 'Bop')
        .trim()
    : '';
}
export function mediaUrl(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const wrapped = /^!?\[[^\]]*\]\(\s*<?(https:\/\/[^\s>]+?)>?(?:\s+["'][^"']*["'])?\s*\)$/i.exec(text);
  const raw = wrapped?.[1] ?? text.replace(/^<([^<>]+)>$/, '$1');
  try {
    if (!/^https:\/\//i.test(raw) || /[\u0000-\u0020\\]/.test(raw)) return '';
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password && url.href.length < 2000)
      return url.href;
  } catch {
    /* Invalid link. */
  }
  return '';
}
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(label, act, style = 'quiet') {
  const item = element('button', label, style);
  item.type = 'button';
  item.addEventListener('click', act);
  return item;
}
function link(url, title) {
  const href = mediaUrl(url);
  if (!href) return null;
  const item = element('a', plain(title) || new URL(href).hostname);
  item.href = href;
  item.target = '_blank';
  item.rel = 'noopener noreferrer';
  return item;
}
export function loadPlaceImage(image, photo, onFailure) {
  const original = mediaUrl(photo?.url);
  const preferred = mediaUrl(photo?.thumb) || original;
  image.addEventListener('error', () => {
    if (original && image.src !== original) image.src = original;
    else onFailure();
  });
  image.referrerPolicy = 'no-referrer';
  image.src = preferred;
}
function photoFigure(photo, name) {
  const url = mediaUrl(photo?.url);
  if (!url) return null;
  const figure = element('figure', null, 'place-photo');
  const image = element('img');
  image.alt = plain(name);
  image.loading = 'eager';
  loadPlaceImage(image, photo, () => { figure.hidden = true; });
  const credit = element('figcaption');
  if (photo.match === 'likely')
    credit.append(element('span', 'รูปจากเว็บ', 'photo-badge'), document.createTextNode(' · '));
  const label = plain(photo.credit) || 'เครดิตภาพ';
  credit.append(link(photo.page, label) ?? document.createTextNode(label));
  figure.append(image, credit);
  return figure;
}
async function post(path, payload, signal, onStep = () => {}) {
  const response = await fetchStream(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return readEvents(response, (event) => {
    if (event.type === 'step') onStep(plain(event.text));
  });
}
function addField(labelText, input) {
  const label = element('label', labelText);
  label.append(input);
  return label;
}
function textField(name, title, maxLength) {
  const input = element('input');
  input.name = name;
  input.maxLength = maxLength;
  return addField(title, input);
}
export function installSetupExtras(form, readSetup) {
  const noteField = textField('extra', 'รายละเอียดเพิ่มเติมของทริป', 1000);
  form.querySelector('#form-error').before(noteField);
  const airportByCity = {
    เชียงใหม่: 'CNX',
    กรุงเทพฯ: 'BKK',
    ดานัง: 'DAD',
    โตเกียว: 'HND',
    ไทเป: 'TPE',
    โซล: 'ICN',
  };
  const legs = {};
  for (const [name, dir] of [
    ['arrive', 'go'],
    ['depart', 'back'],
  ]) {
    const byName = name + 'By';
    const by = form.elements[byName],
      time = form.elements[name + 'Time'];
    const fieldset = time.closest('fieldset');
    const auto = element('input');
    auto.type = 'checkbox';
    auto.name = name + 'Auto';
    const autoLabel = element('label', null, 'checkbox');
    const autoText = document.createTextNode('');
    autoLabel.append(auto, autoText);
    const hint = element('p', null, 'muted');
    const list = element('div', null, 'transport-options');
    const feedback = element('p', null, 'muted');
    feedback.setAttribute('role', 'status');
    const place = form.elements[name + 'Place'];
    const destination = name === 'arrive' ? 'from' : 'to';
    const directionLabel = dir === 'go' ? 'ขาไป' : 'ขากลับ';
    const leg = { auto, choice: null, ctrl: null, original: null, placeLL: null, endpointDefault: !place.value.trim() };
    legs[name] = leg;
    const signature = () =>
      JSON.stringify([
        form.elements.city.value,
        form.elements.startDate.value,
        form.elements.endDate.value,
        by.value,
        place.value,
        time.value,
        auto.checked,
        by.value === 'drive' ? 0 : form.querySelectorAll('#members .member').length,
      ]);
    const outbound = dir === 'go';
    const labelsByMode = {
      undecided: [outbound ? 'เมืองต้นทาง' : 'เมืองที่เดินทางกลับ', 'เช่น กรุงเทพฯ'],
      flight: [outbound ? 'สนามบินต้นทาง' : 'สนามบินปลายทางขากลับ', 'เช่น DMK'],
      bus: [outbound ? 'ต้นทางรถบัส' : 'ปลายทางรถบัสขากลับ', 'เช่น หมอชิต'],
      train: [outbound ? 'สถานีรถไฟต้นทาง' : 'สถานีรถไฟปลายทางขากลับ', 'เช่น สถานีกลางกรุงเทพอภิวัฒน์'],
      drive: [outbound ? 'จุดเริ่มขับรถ' : 'จุดหมายขากลับ', 'เช่น กรุงเทพฯ'],
    };
    function updateControls() {
      const mode = by.value;
      const service = { flight: 'เที่ยวบิน', bus: 'เที่ยวรถบัส', train: 'เที่ยวรถไฟ' }[mode];
      const automatic = mode === 'undecided' || (service && auto.checked);
      const [placeLabel, example] = labelsByMode[mode];
      place.closest('label').firstChild.textContent = placeLabel;
      place.setAttribute('aria-label', placeLabel);
      place.placeholder = example;
      autoLabel.hidden = auto.disabled = !service;
      autoText.textContent = service ? 'ให้ Bop ช่วยหา' + service : '';
      time.closest('label').hidden = time.disabled = Boolean(automatic);
      search.hidden = mode !== 'drive' && !(service && auto.checked);
      search.textContent = (mode === 'drive' ? 'คำนวณเวลาขับรถ' : 'ดูตัวเลือก' + (service || '')) + directionLabel;
      const local = localTransport({ city: form.elements.city.value, [name]: { [destination]: place.value } }, dir);
      const defaultNote = leg.endpointDefault && place.value
        ? (outbound ? 'ต้นทางเริ่มต้น ' : 'ปลายทางขากลับเริ่มต้น ') + place.value + ' · เปลี่ยนได้' : '';
      const guidance = local
        ? 'Bop จะเผื่อเวลาเดินทางในเมือง'
        : mode === 'undecided' ? 'Bop จะเทียบวิธีเดินทางให้ตอนจัดแผน'
        : service && auto.checked ? 'เลือก' + service + 'ตอนนี้ หรือให้ Bop เลือกให้ตอนจัดแผน' : '';
      hint.textContent = [defaultNote, guidance].filter(Boolean).join(' · ');
      hint.hidden = !hint.textContent;
    }
    function clear(restore = false, edited = '') {
      leg.ctrl?.abort();
      leg.ctrl = null;
      if (restore && leg.original) {
        if (edited !== time.name && time.value === leg.original.appliedTime) time.value = leg.original.time;
        if (edited !== byName && by.value === leg.original.appliedBy) by.value = leg.original.by;
      }
      leg.choice = leg.original = null;
      list.replaceChildren();
      feedback.classList.remove('bop-working');
      feedback.textContent = '';
      search.disabled = false;
      updateControls();
    }
    function dayOffset(value) {
      if (!value) return '';
      return value < 0 ? ' (ก่อนหน้า ' + Math.abs(value) + ' วัน)' : ' (ถัดไป ' + value + ' วัน)';
    }
    function showDrive(drive) {
      if (
        !drive ||
        !Number.isFinite(drive.km) ||
        !Number.isFinite(drive.minutes) ||
        !drive.dep ||
        !drive.arr
      ) {
        throw Error('ยังไม่ได้รับเวลาเดินทาง ลองคำนวณอีกครั้ง');
      }
      feedback.textContent = [
        'ระยะทาง ' + drive.km.toLocaleString('th-TH', { maximumFractionDigits: 1 }) + ' กม.',
        drive.minutes + ' นาที',
        drive.approx ? 'เส้นทางโดยประมาณ' : 'เส้นทางถนนจริง',
      ].join(' · ');
      const anchor = dir === 'go' ? drive.arr : drive.dep;
      const label = dir === 'go' ? 'ใช้เวลาถึง ' : 'ใช้เวลาออก ';
      const use = button(label + anchor, () => {
        time.value = anchor;
        auto.checked = false;
        use.disabled = true;
        use.textContent = (dir === 'go' ? 'ตั้งเวลาถึง ' : 'ตั้งเวลาออก ') + anchor + ' แล้ว';
      });
      list.append(
        element(
          'p',
          'ออก ' +
            drive.dep +
            dayOffset(drive.depDayOffset) +
            ' → ถึง ' +
            drive.arr +
            dayOffset(drive.arrDayOffset),
        ),
        element('p', 'ยังไม่รวมเวลาพักและสภาพจราจรปัจจุบัน', 'muted'),
        use,
      );
    }
    function showOptions(options) {
      feedback.textContent = options.length
        ? 'เลือกการเดินทางจาก ' + options.length + ' ตัวเลือก'
        : 'ไม่พบตัวเลือก ลองเปลี่ยนจุดเดินทางหรือเวลา';
      if (!options.length) return;
      const group = element('fieldset');
      group.append(element('legend', 'เลือก' + directionLabel));
      const oldTime = time.value,
        oldBy = by.value;
      for (const [i, option] of options.entries()) {
        const input = element('input');
        input.type = 'radio';
        input.name = name + 'Choice';
        input.value = String(i);
        const row = element('label', null, 'transport-choice');
        const nameText = [travel[option.by], plain(option.carrier), plain(option.code)]
          .filter(Boolean)
          .join(' ');
        const price =
          option.price != null && Number.isFinite(Number(option.price))
            ? '฿' + money.format(option.price) + ' / คน'
            : 'ไม่มีข้อมูลราคา';
        const evidence =
          option.checked === 'live'
            ? 'ราคาจากสายการบิน'
            : option.checked === 'web'
              ? 'ตรวจจากเว็บ'
              : 'ราคาโดยประมาณ';
        row.append(
          input,
          document.createTextNode(
            ' ' + nameText + ' · ' + option.dep + '–' + option.arr + (option.recommended ? ' · แนะนำ' : ''),
          ),
          element(
            'small',
            [price, evidence, option.bag, option.test && 'โหมดทดสอบ'].filter(Boolean).join(' · '),
          ),
        );
        if (option.why) row.append(element('small', plain(option.why)));
        input.addEventListener('change', () => {
          if (!input.checked) return;
          const appliedTime = dir === 'go' ? option.arr : option.dep;
          leg.original = { time: oldTime, by: oldBy, appliedTime, appliedBy: option.by };
          leg.choice = option;
          by.value = option.by;
          time.value = appliedTime;
          feedback.textContent = 'เลือก ' + nameText + ' · ' + option.dep + '–' + option.arr;
          updateControls();
        });
        group.append(row);
        const page = option.src?.checked === 'web' && link(option.src.url, option.src.title || 'แหล่งข้อมูล');
        if (page) group.append(page);
      }
      list.append(
        group,
        button('ล้างตัวเลือก', () => clear(true)),
      );
    }
    const search = button('', async () => {
      clear(true);
      if (!place.value.trim()) {
        feedback.textContent = 'ระบุ' + labelsByMode[by.value][0] + 'ก่อนค้นหา';
        place.focus();
        return;
      }
      const ctrl = new AbortController();
      leg.ctrl = ctrl;
      const started = signature();
      const driving = by.value === 'drive';
      const onStep = (text) => {
        if (leg.ctrl === ctrl) feedback.textContent = text;
      };
      feedback.textContent = driving ? 'กำลังคำนวณเส้นทางขับรถ…' : 'กำลังค้นหาตัวเลือกการเดินทาง…';
      feedback.classList.add('bop-working');
      search.disabled = true;
      try {
        const setup = await readSetup();
        ctrl.signal.throwIfAborted();
        if (driving) {
          const result = await post(
            '/api/drive-preview',
            {
              dir,
              city: setup.city,
              cityLL: setup.cityLL,
              place: place.value.trim(),
              placeLL: setup[name]?.placeLL || leg.placeLL,
              time: time.value,
            },
            ctrl.signal,
            onStep,
          );
          if (leg.ctrl === ctrl && signature() === started) showDrive(result.drive);
        } else {
          const result = await post('/api/transport-options', { setup, dir }, ctrl.signal, onStep);
          if (leg.ctrl === ctrl && signature() === started) {
            showOptions(
              (Array.isArray(result.options) ? result.options : []).filter(
                (o) => o?.carrier && o.dep && o.arr,
              ),
            );
          }
        }
      } catch (error) {
        if (!ctrl.signal.aborted) feedback.textContent = plain(error.message) || 'ค้นหาการเดินทางไม่สำเร็จ';
      } finally {
        if (leg.ctrl === ctrl) {
          search.disabled = false;
          feedback.classList.remove('bop-working');
        }
      }
    });
    fieldset.append(autoLabel, hint, search, feedback, list);
    updateControls();
    const inputFields = new Set(['city', 'startDate', 'endDate', place.name, byName, time.name, auto.name]);
    form.addEventListener('input', (event) => {
      const field = event.target.name;
      if (!inputFields.has(field)) return;
      if (field === place.name) {
        leg.placeLL = null;
        leg.endpointDefault = !place.value.trim();
      }
      if (field === byName) {
        time.value = '';
        auto.checked = by.value !== 'drive' && by.value !== 'undecided';
      }
      clear(true, field);
    });
    leg.clear = clear;
    leg.updateControls = updateControls;
    let hydrating = false;
    const members = new MutationObserver(() => {
      if (!hydrating && by.value !== 'drive') clear(true);
    });
    members.observe(form.querySelector('#members'), { childList: true });
    form.closest('dialog')?.addEventListener('close', () => {
      leg.ctrl?.abort();
    });
    leg.restore = (saved = {}, plannedRoute) => {
      // Hydration can replace every traveler synchronously before its observer fires.
      hydrating = true;
      members.takeRecords();
      queueMicrotask(() => {
        members.takeRecords();
        hydrating = false;
      });
      clear();
      const legacyChoice = plannedRoute && !plannedRoute.requestedBy && !saved.auto && (
        plannedRoute.options?.find((item) => item.id === plannedRoute.chosen) ||
        plannedRoute.chosenOption ||
        (typeof plannedRoute.chosen === 'object' && plannedRoute.chosen)
      );
      const picked = saved.choice || legacyChoice;
      const choice = picked?.carrier && picked.dep && picked.arr ? picked : null;
      const preferred = saved.choice?.by || plannedRoute?.requestedBy || saved.by || choice?.by;
      by.value = Object.hasOwn(labelsByMode, preferred) ? preferred : saved.time ? 'flight' : 'undecided';
      time.value = saved.time || (dir === 'go' ? choice?.arr : choice?.dep) || '';
      place.value = saved[destination] || choice?.[destination] || '';
      leg.endpointDefault = saved.endpointDefault === true || !place.value.trim();
      auto.checked = Boolean(choice || saved.auto || plannedRoute?.requestedBy || !time.value);
      leg.placeLL = Array.isArray(saved.placeLL) ? [...saved.placeLL] : null;
      if (choice && by.value !== 'drive') {
        leg.choice = structuredClone(choice);
        feedback.textContent =
          'เลือกไว้ · ' +
          [plain(choice.carrier), plain(choice.code), choice.dep + '–' + choice.arr]
            .filter(Boolean)
            .join(' ');
        list.append(button('ล้างตัวเลือก', () => clear()));
      }
      updateControls();
    };
  }
  function syncEndpoints(editing) {
    const draft = { city: form.elements.city.value };
    for (const [name, key] of [['arrive', 'from'], ['depart', 'to']]) {
      draft[name] = {
        by: form.elements[name + 'By'].value,
        [key]: legs[name].endpointDefault ? '' : form.elements[name + 'Place'].value,
      };
    }
    const resolved = resolveTransportEndpoints(draft);
    for (const [name, key] of [['arrive', 'from'], ['depart', 'to']]) {
      const input = form.elements[name + 'Place'];
      const leg = legs[name];
      if (leg.endpointDefault && input !== editing && input.value !== resolved[name][key]) {
        input.value = resolved[name][key];
        leg.placeLL = null;
        if (name === 'depart' && ['arriveBy', 'arrivePlace'].includes(editing?.name)) leg.clear(true);
      }
      leg.updateControls();
    }
  }
  form.addEventListener('input', ({ target }) => {
    if (['city', 'arriveBy', 'departBy', 'arrivePlace', 'departPlace'].includes(target.name))
      syncEndpoints(target);
  });
  for (const name of ['arrive', 'depart'])
    form.elements[name + 'Place'].addEventListener('blur', () => syncEndpoints());
  syncEndpoints();
  const augment = (setup) => {
    const decorated = {
      ...setup,
      extra: form.elements.extra.value.trim(),
      hotelArea: form.elements.hotelArea.value.trim(),
    };
    const airport = airportByCity[setup.city];
    if (airport) decorated.cityAirport = airport;
    for (const [name, leg] of Object.entries(legs)) {
      if (!setup[name]) continue;
      decorated[name] = {
        ...setup[name],
        ...(leg.endpointDefault ? { endpointDefault: true } : {}),
        time: form.elements[name + 'Time'].disabled && !leg.choice ? '' : setup[name].time,
        auto: setup[name].by === 'undecided' || (!leg.auto.disabled && leg.auto.checked),
        ...(leg.placeLL ? { placeLL: leg.placeLL } : {}),
        ...(leg.choice ? { choice: leg.choice } : {}),
      };
    }
    decorated.members = setup.members
      .filter((m) => m?.name?.trim())
      .map((m) => {
        const item = { ...m };
        for (const key of ['budget', 'maxWalkKm']) {
          const n = Number(item[key]);
          if (n > 0 && Number.isFinite(n)) item[key] = n;
          else delete item[key];
        }
        return item;
      });
    if (decorated.members.length && !decorated.members.some((m) => m.role === 'organizer'))
      decorated.members[0].role = 'organizer';
    return resolveTransportEndpoints(decorated);
  };
  augment.restore = (setup = {}, flags = {}) => {
    form.elements.hotelArea.value = setup.hotelArea || '';
    form.elements.extra.value = setup.extra || '';
    legs.arrive.restore(setup.arrive, flags.transport?.go);
    legs.depart.restore(setup.depart, flags.transport?.back);
    syncEndpoints();
  };
  return augment;
}
export function candidateQuestions(result) {
  // Earlier lodging questions offered neighborhoods. Only a property can anchor a stay.
  const hotels = options => options.filter(option => option?.kind === 'hotel' && plain(option.name));
  const order = { stay: 0, food: 1, sight: 2 };
  const surveyOrder = questions => questions.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
  if (Array.isArray(result?.questions))
    return surveyOrder(result.questions.filter(q => Array.isArray(q?.options))
      .map(q => q.kind === 'stay' ? { ...q, options: hotels(q.options) } : q)
      .filter(q => q.options.some(o => o?.name)));
  const grouped = new Map();
  for (const option of Array.isArray(result?.candidates) ? result.candidates : []) {
    if (!option?.name || option.kind === 'stay') continue;
    const kind = option.kind === 'hotel' ? 'stay' : option.kind === 'food' ? 'food' : 'sight';
    if (!grouped.has(kind))
      grouped.set(kind, {
        kind,
        title: { sight: 'อยากไปเที่ยวที่ไหน', food: 'สนใจร้านอาหารไหน', stay: 'อยากพักโรงแรมไหน' }[kind],
        options: [],
      });
    grouped.get(kind).options.push(option);
  }
  return surveyOrder([...grouped.values()]);
}
export function chooseCandidates({ dialog, reopen, result, signal, partySize, onQuestion, findMore, includeHotels = true }) {
  const questions = candidateQuestions(result).filter(q => includeHotels || q.kind !== 'stay'),
    picks = { must: [], avoid: [] };
  if (!questions.length) return Promise.resolve(picks);
  return new Promise((resolve, reject) => {
    let index = 0;
    let answers = new Map();
    let refreshController;
    const stopRefresh = () => {
      refreshController?.abort();
      refreshController = undefined;
    };
    const collect = () => {
      for (const [option, value] of answers) {
        const kind = option.kind || questions[index].kind;
        if (value === 'yes') picks.must.push({ ...option, kind });
        if (value === 'no') picks.avoid.push({ id: option.id, name: option.name, kind, query: option.query });
      }
      answers = new Map();
    };
    const finish = (includeCurrent, aborted = false) => {
      stopRefresh();
      signal?.removeEventListener('abort', abort);
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('close', close);
      reopen.removeEventListener('click', open);
      reopen.hidden = true;
      if (includeCurrent) collect();
      if (dialog.open) dialog.close();
      dialog.replaceChildren();
      if (aborted) reject(signal.reason);
      else resolve(picks);
    };
    const abort = () => finish(false, true);
    const cancel = (event) => {
      event.preventDefault();
      finish(true);
    };
    const close = () => {
      if (dialog.open) return;
      reopen.hidden = false;
      reopen.focus({ preventScroll: true });
    };
    const open = () => {
      if (!dialog.open) dialog.showModal();
      reopen.hidden = true;
      dialog.querySelector('h2').focus({ preventScroll: true });
    };
    const draw = () => {
      const q = questions[index];
      const cards = new Map();
      const head = element('header', null, 'survey-head');
      const progress = element('progress');
      progress.max = questions.length;
      progress.value = index + 1;
      progress.setAttribute('aria-label', 'ความคืบหน้าคำถาม');
      const title = element('h2', plain(q.title) || 'เลือกสถานที่ที่สนใจ');
      title.id = 'survey-question';
      title.tabIndex = -1;
      const tools = element('div', null, 'survey-tools');
      tools.append(
        element(
          'p',
          ['คำถาม ' + (index + 1) + ' จาก ' + questions.length, partySize > 0 && 'กลุ่ม ' + partySize + ' คน']
            .filter(Boolean)
            .join(' · '),
          'muted',
        ),
        button('ดูแผนที่', () => dialog.close()),
      );
      head.append(tools, progress, title);
      if (q.sub || q.why) head.append(element('p', plain(q.sub || q.why), 'muted'));
      if (q.kind === 'stay') head.append(element('p', 'กด “สนใจ” ได้หนึ่งโรงแรม หรือข้ามเพื่อให้ Bop เลือก', 'muted'));
      const grid = element('div', null, 'candidate-grid');
      grid.id = 'survey-options';
      dialog.replaceChildren(head, grid);
      function candidateCard(option) {
        const row = element('article', null, 'question-option');
        row.tabIndex = -1;
        cards.set(option, row);
        const fig = photoFigure(option.photo, option.name);
        if (fig) row.append(fig);
        const body = element('div', null, 'candidate-body');
        body.append(element('h3', plain(option.name)));
        const address = q.kind === 'stay' && (plain(option.address) || plain(option.query));
        if (address && address !== plain(option.name)) body.append(element('p', address, 'muted'));
        if (plain(option.why)) body.append(element('p', plain(option.why)));
        const tags = (Array.isArray(option.tags) ? option.tags : []).map(plain).filter(Boolean);
        if (tags.length) {
          const list = element('ul', null, 'candidate-tags');
          for (const tag of tags) list.append(element('li', tag));
          body.append(list);
        }
        const page = option.src?.checked === 'web' && link(option.src.url, option.src.title || 'แหล่งข้อมูล');
        const raw = option.price ?? option.priceHint;
        const price =
          typeof raw === 'number' || (typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw))
            ? '฿' + money.format(Number(raw))
            : plain(raw);
        if (q.kind === 'stay') {
          const nightly = Number(option.priceNight);
          body.append(element('p', Number.isFinite(nightly) && nightly > 0
            ? 'ประมาณ ฿' + money.format(nightly) + ' / ห้อง / คืน' : 'ยังไม่มีราคาสำหรับวันเข้าพัก', 'muted'));
        } else if (price) body.append(element('p', (page ? 'ราคาที่พบ ' : 'ราคาประมาณ ') + price, 'muted'));
        if (page) body.append(page);
        const toggles = element('div', null, 'candidate-answers');
        toggles.setAttribute('role', 'group');
        toggles.setAttribute('aria-label', plain(option.name));
        for (const [value, label] of [
          ['yes', 'สนใจ'],
          ['no', 'ไม่เอา'],
          ['maybe', 'ไม่แน่ใจ'],
        ]) {
          const toggle = button(label, () => {
            if (answers.get(option) === value) answers.delete(option);
            else {
              if (q.kind === 'stay' && value === 'yes')
                for (const [other, answer] of answers) if (answer === 'yes') answers.delete(other);
              answers.set(option, value);
            }
            for (const [candidate, card] of cards) {
              card.dataset.answer = answers.get(candidate) || '';
              for (const item of card.querySelectorAll('.candidate-answers button'))
                item.setAttribute('aria-pressed', String(item.dataset.answer === card.dataset.answer));
            }
          });
          const mark = element('span', '✓', 'answer-mark');
          mark.setAttribute('aria-hidden', 'true');
          toggle.prepend(mark);
          toggle.dataset.answer = value;
          toggle.setAttribute('aria-pressed', 'false');
          toggles.append(toggle);
        }
        row.append(body, toggles);
        return row;
      }
      grid.append(...q.options.filter(o => o?.name).map(candidateCard));
      const next = (accept) => {
        stopRefresh();
        if (accept) collect();
        else answers = new Map();
        if (++index < questions.length) {
          draw();
          dialog.querySelector('h2').focus({ preventScroll: true });
        } else finish(false);
      };
      const footer = element('footer', null, 'survey-footer');
      const controls = element('div', null, 'survey-actions');
      const feedback = element('p', '', 'survey-feedback');
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-atomic', 'true');
      const openCard = option => {
        const card = cards.get(option);
        if (!card?.isConnected) return;
        if (!dialog.open) open();
        card.focus({ preventScroll: true });
        card.scrollIntoView({ block: 'nearest' });
      };
      if (findMore) {
        const more = button('หาตัวเลือกเพิ่ม', async () => {
          if (refreshController) return;
          const controller = new AbortController();
          refreshController = controller;
          more.setAttribute('aria-disabled', 'true');
          feedback.classList.add('bop-working');
          feedback.textContent = 'กำลังหาตัวเลือกเพิ่มสำหรับคำถามนี้…';
          const focusAtStart = document.activeElement;
          try {
            const exclude = questions.flatMap(question => question.options.map(o => plain(o?.name))).filter(Boolean);
            const response = await findMore({ kind: q.kind, exclude }, controller.signal);
            if (controller.signal.aborted) return;
            const comparable = name => plain(name).normalize('NFKC').toLowerCase()
              .replace(/^the\s+/i, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
            const seen = new Set(exclude.map(comparable));
            const incoming = candidateQuestions(response).find(question => question.kind === q.kind);
            const fresh = (incoming?.options || []).filter(option => {
              const name = comparable(option?.name);
              if (!name || seen.has(name)) return false;
              seen.add(name);
              return true;
            });
            if (!fresh.length) {
              feedback.textContent = 'ยังไม่พบตัวเลือกใหม่ ลองค้นอีกครั้งหรือเลือกจากรายการเดิมได้';
              return;
            }
            q.options = [...fresh, ...q.options];
            grid.prepend(...fresh.map(candidateCard));
            feedback.textContent = 'เพิ่ม ' + fresh.length + ' ตัวเลือกไว้ด้านบนแล้ว';
            onQuestion(q, openCard);
            if (dialog.open && document.activeElement === focusAtStart) openCard(fresh[0]);
          } catch {
            if (!controller.signal.aborted) feedback.textContent = 'ค้นหาเพิ่มไม่สำเร็จ กดหาตัวเลือกเพิ่มเพื่อลองอีกครั้ง';
          } finally {
            if (refreshController === controller) {
              refreshController = undefined;
              more.removeAttribute('aria-disabled');
              feedback.classList.remove('bop-working');
            }
          }
        }, 'quiet survey-more');
        more.setAttribute('aria-controls', grid.id);
        controls.append(more);
      }
      controls.append(
        button('ให้ Bop เลือกที่เหลือเอง', () => finish(true)),
        button('ข้ามคำถามนี้', () => next(false)),
        button(index === questions.length - 1 ? 'เริ่มวางแผน' : 'ถัดไป', () => next(true), 'primary'),
      );
      footer.append(feedback, controls);
      dialog.append(footer);
      dialog.scrollTop = 0;
      onQuestion(q, openCard);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    draw();
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('close', close);
    reopen.addEventListener('click', open);
    signal?.addEventListener('abort', abort, { once: true });
    open();
  });
}
