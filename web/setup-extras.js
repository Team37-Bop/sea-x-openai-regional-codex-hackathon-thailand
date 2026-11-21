import { readEvents } from './stream.js';

const money = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const kinds = {
  food: 'อาหาร',
  sight: 'สถานที่เที่ยว',
  hotel: 'ที่พัก',
  stay: 'ย่านที่พัก',
  nature: 'ธรรมชาติ',
  view: 'จุดชมวิว',
  terminal: 'จุดเดินทาง',
  transit: 'สถานีเดินทาง',
  market: 'ตลาด',
};
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
function photoFigure(photo, name) {
  const url = mediaUrl(photo?.url);
  if (!url) return null;
  const figure = element('figure', null, 'place-photo');
  const image = element('img');
  image.src = mediaUrl(photo.thumb) || url;
  image.alt = plain(name);
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener(
    'error',
    () => {
      figure.hidden = true;
    },
    { once: true },
  );
  const credit = element('figcaption');
  if (photo.match === 'likely')
    credit.append(element('span', 'รูปจากเว็บ', 'photo-badge'), document.createTextNode(' · '));
  const label = plain(photo.credit) || 'เครดิตภาพ';
  credit.append(link(photo.page, label) ?? document.createTextNode(label));
  figure.append(image, credit);
  return figure;
}
async function post(path, payload, signal, onStep = () => {}) {
  const response = await fetch(path, {
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
  const stayMode = form.elements.stayMode;
  const areaLabel = textField('hotelArea', 'ย่านที่สนใจพัก (ถ้ามี)', 120);
  stayMode.closest('label').after(areaLabel);
  const toggleArea = () => {
    areaLabel.hidden = stayMode.value === 'booked';
  };
  stayMode.addEventListener('change', toggleArea);
  toggleArea();
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
    const by = form.elements[name + 'By'],
      time = form.elements[name + 'Time'];
    const fieldset = by.closest('fieldset');
    const auto = element('input');
    auto.type = 'checkbox';
    auto.name = name + 'Auto';
    const autoLabel = element('label', null, 'checkbox');
    autoLabel.append(auto, document.createTextNode('ให้ Bop เลือกเวลาให้'));
    const list = element('div', null, 'transport-options');
    const feedback = element('p', null, 'muted');
    feedback.setAttribute('role', 'status');
    const place = form.elements[name + 'Place'];
    const destination = name === 'arrive' ? 'from' : 'to';
    const directionLabel = dir === 'go' ? 'ขาไป' : 'ขากลับ';
    const leg = { auto, choice: null, ctrl: null, original: null, placeLL: null };
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
    function updateLabel() {
      search.textContent = (by.value === 'drive' ? 'คำนวณเวลาขับรถ' : 'ค้นหาตัวเลือก') + directionLabel;
    }
    function clear(restore = false, edited = '') {
      leg.ctrl?.abort();
      leg.ctrl = null;
      if (restore && leg.original) {
        if (edited !== time.name && time.value === leg.original.appliedTime) time.value = leg.original.time;
        if (edited !== by.name && by.value === leg.original.appliedBy) by.value = leg.original.by;
      }
      leg.choice = leg.original = null;
      list.replaceChildren();
      feedback.textContent = '';
      search.disabled = false;
      updateLabel();
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
          auto.checked = false;
          feedback.textContent = 'เลือก ' + nameText + ' · ' + option.dep + '–' + option.arr;
          updateLabel();
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
      const ctrl = new AbortController();
      leg.ctrl = ctrl;
      const started = signature();
      const driving = by.value === 'drive';
      const onStep = (text) => {
        if (leg.ctrl === ctrl) feedback.textContent = text;
      };
      feedback.textContent = driving ? 'กำลังคำนวณเส้นทางขับรถ…' : 'กำลังค้นหาตัวเลือกการเดินทาง…';
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
        if (leg.ctrl === ctrl) search.disabled = false;
      }
    });
    fieldset.append(autoLabel, search, feedback, list);
    updateLabel();
    const inputFields = new Set(['city', 'startDate', 'endDate', place.name, by.name, time.name, auto.name]);
    form.addEventListener('input', (event) => {
      const field = event.target.name;
      if (!inputFields.has(field)) return;
      if (field === place.name) leg.placeLL = null;
      clear(true, field);
    });
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
      const picked =
        saved.choice ||
        plannedRoute?.options?.find((item) => item.id === plannedRoute.chosen) ||
        plannedRoute?.chosenOption ||
        (typeof plannedRoute?.chosen === 'object' && plannedRoute.chosen);
      const choice = picked?.carrier && picked.dep && picked.arr ? picked : null;
      by.value = saved.by || choice?.by || 'undecided';
      time.value = saved.time || (dir === 'go' ? choice?.arr : choice?.dep) || '';
      place.value = saved[destination] || '';
      auto.checked = saved.auto === true;
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
      updateLabel();
    };
  }
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
        auto: leg.auto.checked,
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
    return decorated;
  };
  augment.restore = (setup = {}, flags = {}) => {
    form.elements.hotelArea.value = setup.hotelArea || '';
    form.elements.extra.value = setup.extra || '';
    toggleArea();
    legs.arrive.restore(setup.arrive, flags.transport?.go);
    legs.depart.restore(setup.depart, flags.transport?.back);
  };
  return augment;
}
function presentFacts(content, info, stop) {
  const checked = info.confidence === 'web' || (stop.src?.checked === 'web' && mediaUrl(stop.src.url));
  content.append(element('p', checked ? 'ตรวจจากเว็บ' : 'ข้อมูลประมาณ', 'muted'));
  const summary = plain(info.summary),
    what = plain(info.details?.what);
  if (summary) content.append(element('p', summary));
  if (what && what !== summary) content.append(element('p', what));
  const appendList = (heading, items) => {
    const texts = (Array.isArray(items) ? items : []).map(plain).filter(Boolean);
    if (!texts.length) return;
    const ul = element('ul');
    for (const text of texts) ul.append(element('li', text));
    content.append(element('h3', heading), ul);
  };
  appendList('จุดเด่น', info.details?.highlights);
  const facts = element('dl');
  for (const [label, value] of [
    ['ราคา', info.details?.price || info.priceRange],
    ['เวลาเปิด', info.hours || info.details?.hours],
    ['ที่อยู่', info.details?.address],
    ['คะแนนรีวิว', info.details?.rating],
    ['การจอง', info.details?.booking],
    ['โทรศัพท์', info.phone],
  ]) {
    if (plain(value)) facts.append(element('dt', label), element('dd', plain(value)));
  }
  if (facts.childElementCount) content.append(facts);
  if ((stop.k ?? stop.kind) === 'food' && Array.isArray(info.dishes) && info.dishes.length) {
    const menu = element('ul');
    for (const dish of info.dishes) {
      if (!plain(dish?.name)) continue;
      const baht = Number.isFinite(dish.price) ? ' · ฿' + money.format(dish.price) : '';
      const why = plain(dish.why);
      menu.append(element('li', plain(dish.name) + baht + (why ? ' · ' + why : '')));
    }
    if (menu.childElementCount) content.append(element('h3', 'เมนูแนะนำ'), menu);
  }
  appendList('ข้อแนะนำ', info.tips);
  for (const photo of (info.photos ?? []).slice(0, 4)) {
    const figure = photoFigure(photo, stop.n ?? stop.name);
    if (figure) content.append(figure);
  }
  const sources = element('ul'),
    used = new Set();
  for (const source of [...(info.sources ?? []), stop.src?.checked === 'web' ? stop.src : null]) {
    const target = link(source?.url, source?.title);
    if (!target || used.has(target.href)) continue;
    used.add(target.href);
    const li = element('li');
    li.append(target);
    sources.append(li);
  }
  if (sources.childElementCount) content.append(element('h3', 'แหล่งข้อมูล'), sources);
}
const sheets = new WeakMap();
export async function openPlaceSheet({ dialog, content, stop, city, sample = false }) {
  sheets.get(dialog)?.abort();
  const ctrl = new AbortController();
  sheets.set(dialog, ctrl);
  const abort = () => ctrl.abort();
  dialog.addEventListener('close', abort, { once: true });
  const n = stop.n ?? stop.name,
    k = stop.k ?? stop.kind;
  const tokens = [
    kinds[k] || 'กิจกรรม',
    [stop.start ?? stop.t0, stop.end ?? stop.t1].filter(Boolean).join('–'),
  ].filter(Boolean);
  content.replaceChildren(element('h2', plain(n)), element('p', tokens.join(' · '), 'muted'));
  if (!dialog.open) dialog.showModal();
  const progress = element('p', null, 'muted');
  progress.setAttribute('role', 'status');
  content.append(progress);
  try {
    if (sample) {
      presentFacts(
        content,
        {
          summary: plain(stop.note) || 'จุดแวะในทริปตัวอย่าง',
          priceRange: Number.isFinite(stop.cost) ? '฿' + money.format(stop.cost) + ' / คน' : '',
          hours: typeof stop.open === 'string' ? stop.open : '',
          phone: stop.res?.phone,
        },
        stop,
      );
      return;
    }
    progress.textContent = 'กำลังค้นรายละเอียดสถานที่…';
    const payload = {
      city,
      stop: {
        id: stop.id,
        n,
        k,
        ll: stop.ll,
        note: stop.note,
        query: stop.query,
        aliases: stop.aliases,
        place: { query: stop.place?.query, aliases: stop.place?.aliases },
      },
    };
    const result = await post('/api/place-info', payload, ctrl.signal, (value) => {
      if (!ctrl.signal.aborted) progress.textContent = value;
    });
    if (!ctrl.signal.aborted && dialog.open) presentFacts(content, result.info || {}, stop);
  } catch (error) {
    if (!ctrl.signal.aborted)
      content.append(element('p', plain(error.message) || 'ค้นข้อมูลสถานที่ไม่ได้', 'feedback'));
  } finally {
    progress.remove();
    dialog.removeEventListener('close', abort);
    if (sheets.get(dialog) === ctrl) sheets.delete(dialog);
  }
}
export function candidateQuestions(result) {
  if (Array.isArray(result?.questions))
    return result.questions.filter((q) => Array.isArray(q?.options) && q.options.some((o) => o?.name));
  const grouped = new Map();
  for (const option of Array.isArray(result?.candidates) ? result.candidates : []) {
    if (!option?.name) continue;
    const kind = ['sight', 'food', 'stay'].includes(option.kind) ? option.kind : 'sight';
    if (!grouped.has(kind))
      grouped.set(kind, {
        kind,
        title: { sight: 'อยากไปเที่ยวที่ไหน', food: 'สนใจร้านอาหารไหน', stay: 'อยากพักย่านไหน' }[kind],
        options: [],
      });
    grouped.get(kind).options.push(option);
  }
  return [...grouped.values()];
}
export function chooseCandidates({ dialog, content, result, signal }) {
  const questions = candidateQuestions(result),
    picks = { must: [], avoid: [] };
  if (!questions.length) return Promise.resolve(picks);
  return new Promise((resolve, reject) => {
    let index = 0;
    let answers = new Map();
    const collect = () => {
      for (const [option, value] of answers) {
        if (value === 'yes') picks.must.push(option);
        if (value === 'no') picks.avoid.push(option.id);
      }
      answers = new Map();
    };
    const finish = (includeCurrent, aborted = false) => {
      dialog.removeEventListener('close', close);
      signal?.removeEventListener('abort', abort);
      if (includeCurrent) collect();
      if (dialog.open) dialog.close();
      if (aborted) reject(signal.reason);
      else resolve(picks);
    };
    const close = () => finish(true),
      abort = () => finish(false, true);
    const draw = () => {
      const q = questions[index];
      content.replaceChildren(element('h2', plain(q.title) || 'เลือกสถานที่ที่สนใจ'));
      for (const option of q.options.filter((o) => o?.name)) {
        const row = element('article', null, 'question-option');
        row.append(element('h3', plain(option.name)));
        const fig = photoFigure(option.photo, option.name);
        if (fig) row.append(fig);
        if (plain(option.why)) row.append(element('p', plain(option.why)));
        const labels = (Array.isArray(option.tags) ? option.tags : []).map(plain).filter(Boolean);
        const price =
          typeof option.price === 'number'
            ? '฿' + money.format(option.price)
            : plain(option.price ?? option.priceHint);
        if (price) labels.push(price);
        if (labels.length) row.append(element('p', labels.join(' · '), 'muted'));
        const page = option.src?.checked === 'web' && link(option.src.url, option.src.title || 'แหล่งข้อมูล');
        if (page) row.append(page);
        const toggles = element('div', null, 'inline');
        toggles.setAttribute('role', 'group');
        toggles.setAttribute('aria-label', plain(option.name));
        for (const [value, label] of [
          ['yes', 'สนใจ'],
          ['no', 'ไม่เอา'],
          ['maybe', 'ไม่แน่ใจ'],
        ]) {
          const toggle = button(label, () => {
            if (answers.get(option) === value) answers.delete(option);
            else answers.set(option, value);
            for (const item of toggles.children)
              item.setAttribute('aria-pressed', String(item.dataset.answer === answers.get(option)));
          });
          toggle.dataset.answer = value;
          toggle.setAttribute('aria-pressed', 'false');
          toggles.append(toggle);
        }
        row.append(toggles);
        content.append(row);
      }
      const next = (accept) => {
        if (accept) collect();
        else answers = new Map();
        if (++index < questions.length) {
          draw();
          content.querySelector('h2')?.focus();
        } else finish(false);
      };
      content.append(
        button(index === questions.length - 1 ? 'เริ่มวางแผน' : 'ถัดไป', () => next(true), 'primary'),
        button('ข้ามคำถามนี้', () => next(false)),
        button('ให้ Bop เลือกที่เหลือเอง', () => finish(false)),
      );
      content.querySelector('h2').tabIndex = -1;
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    draw();
    dialog.addEventListener('close', close, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (!dialog.open) dialog.showModal();
  });
}
