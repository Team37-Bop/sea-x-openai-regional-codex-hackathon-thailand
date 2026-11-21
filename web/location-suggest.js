// The same shortlist is available before a network request and in the server response.
const cities = [
  [
    'กรุงเทพฯ',
    'Bangkok',
    'TH',
    'THB',
    'BKK',
    [13.7563, 100.5018],
    ['กรุงเทพ', 'กรุงเทพมหานคร', 'กทม', 'Krung Thep', 'DMK'],
  ],
  ['เชียงใหม่', 'Chiang Mai', 'TH', 'THB', 'CNX', [18.7883, 98.9853], ['ชม', 'Chiangmai']],
  ['เชียงราย', 'Chiang Rai', 'TH', 'THB', 'CEI', [19.9105, 99.8406], ['ชร', 'Chiangrai']],
  ['ภูเก็ต', 'Phuket', 'TH', 'THB', 'HKT', [7.8804, 98.3923]],
  ['กระบี่', 'Krabi', 'TH', 'THB', 'KBV', [8.0863, 98.9063]],
  ['ขอนแก่น', 'Khon Kaen', 'TH', 'THB', 'KKC', [16.4419, 102.8359]],
  ['หาดใหญ่', 'Hat Yai', 'TH', 'THB', 'HDY', [7.0084, 100.4747], ['Hatyai']],
  ['เกาะสมุย', 'Ko Samui', 'TH', 'THB', 'USM', [9.512, 100.013], ['สมุย', 'Koh Samui', 'Samui']],
  ['ดานัง', 'Da Nang', 'VN', 'VND', 'DAD', [16.0544, 108.2022], ['ดาน่ัง', 'Danang', 'Đà Nẵng']],
  ['โตเกียว', 'Tokyo', 'JP', 'JPY', 'HND', [35.6762, 139.6503], ['TYO', 'NRT', '東京']],
  ['ไทเป', 'Taipei', 'TW', 'TWD', 'TPE', [25.033, 121.5654], ['台北']],
  ['โซล', 'Seoul', 'KR', 'KRW', 'ICN', [37.5665, 126.978], ['서울']],
  ['สิงคโปร์', 'Singapore', 'SG', 'SGD', 'SIN', [1.3521, 103.8198]],
];
const airports = [
  ['BKK', 'สุวรรณภูมิ', 'Suvarnabhumi', 13.69, 100.7501, 'กทม'],
  ['DMK', 'ดอนเมือง', 'Don Mueang', 13.9126, 100.6067, 'ดอนเมือง Don Muang'],
  ['CNX', 'เชียงใหม่', 'Chiang Mai', 18.7668, 98.9626, 'เชียงใหม่'],
  ['CEI', 'แม่ฟ้าหลวง เชียงราย', 'Mae Fah Luang Chiang Rai', 19.9523, 99.8829, 'เชียงราย'],
  ['HKT', 'ภูเก็ต', 'Phuket', 8.1132, 98.3169],
  ['KBV', 'กระบี่', 'Krabi', 8.0991, 98.9862],
  ['KKC', 'ขอนแก่น', 'Khon Kaen', 16.4666, 102.7837],
  ['HDY', 'หาดใหญ่', 'Hat Yai', 6.9332, 100.3936],
  ['USM', 'สมุย', 'Samui', 9.5478, 100.0623],
  ['DAD', 'ดานัง', 'Da Nang', 16.0439, 108.1994],
  ['HND', 'ฮาเนดะ', 'Haneda', 35.5494, 139.7798, 'ฮาเนดะ'],
  ['NRT', 'นาริตะ', 'Narita', 35.7647, 140.3864],
  ['TPE', 'เถาหยวน', 'Taoyuan', 25.0797, 121.2342],
  ['ICN', 'อินชอน', 'Incheon', 37.4602, 126.4407],
  ['SIN', 'ชางงี', 'Changi', 1.3644, 103.9915],
];
const hotels = [
  ['ibis Styles Chiang Mai', 'ไอบิส สไตล์ เชียงใหม่', 'เชียงใหม่', 18.80592, 98.960301],
  [
    'Novotel Bangkok Platinum Pratunam',
    'โนโวเทล กรุงเทพ แพลทินัม ประตูน้ำ',
    'กรุงเทพฯ',
    13.749701,
    100.54007,
  ],
  ['Novotel Danang Premier Han River', 'โนโวเทล ดานัง พรีเมียร์ ฮาน ริเวอร์', 'ดานัง', 16.077222, 108.223333],
];
const sights = [
  ['วัดโพธิ์', 'Wat Pho', 'กรุงเทพฯ', 13.7465, 100.4927, ['วัดพระเชตุพน', 'Temple of the Reclining Buddha']],
  ['วัดอรุณราชวราราม', 'Wat Arun', 'กรุงเทพฯ', 13.7437, 100.4889, ['วัดอรุณ', 'วัดแจ้ง', 'Temple of Dawn']],
  ['พระบรมมหาราชวัง', 'Grand Palace', 'กรุงเทพฯ', 13.75, 100.4913, ['วังหลวง']],
  ['ตลาดนัดจตุจักร', 'Chatuchak Weekend Market', 'กรุงเทพฯ', 13.7996, 100.5501, ['จตุจักร', 'JJ Market']],
  ['ประตูท่าแพ', 'Tha Phae Gate', 'เชียงใหม่', 18.7878, 98.9933, ['ท่าแพ', 'Thapae']],
  ['วัดเจดีย์หลวง', 'Wat Chedi Luang', 'เชียงใหม่', 18.7868, 98.9869, ['เจดีย์หลวง']],
  [
    'วัดพระธาตุดอยสุเทพ',
    'Wat Phra That Doi Suthep',
    'เชียงใหม่',
    18.8049,
    98.9216,
    ['ดอยสุเทพ', 'Doi Suthep'],
  ],
  ['ตลาดวโรรส', 'Warorot Market', 'เชียงใหม่', 18.7907, 99.0, ['กาดหลวง', 'Kad Luang']],
  ['สะพานมังกร', 'Dragon Bridge', 'ดานัง', 16.0611, 108.2276, ['Cầu Rồng']],
  ['ตลาดฮัน', 'Han Market', 'ดานัง', 16.0687, 108.2245, ['Chợ Hàn']],
  ['หาดหมีเคว', 'My Khe Beach', 'ดานัง', 16.0546, 108.2481, ['Bãi biển Mỹ Khê']],
];
function folded(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[đĐ]/g, 'd')
    .replace(/\p{Script=Latin}[\u0300-\u036f]*/gu, (letter) => letter.normalize('NFD').replace(/\p{M}/gu, ''))
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const directory = [];
for (const [name, en, cc, currency, airport, ll, aliases = []] of cities) {
  directory.push({
    kind: 'city',
    city: name,
    keys: [name, en, airport, ...aliases],
    item: { name, label: name + ' · ' + en + ' · ' + cc, cc, currency, airport, ll },
  });
}
for (const [iata, name, en, lat, lon, alias] of airports) {
  const city = cities.find((row) => row[4] === iata) ?? cities.find((row) => row[6]?.includes(iata));
  const [cityName, cityEn, cc, currency] = city;
  const title = 'สนามบิน' + name + ' (' + iata + ')';
  directory.push({
    kind: 'airport',
    city: cityName,
    keys: [
      iata,
      name,
      en,
      title,
      'ท่าอากาศยาน' + name,
      'สนามบิน' + cityName,
      cityName,
      cityEn,
      en + ' airport',
      ...(city[6] ?? []).filter((s) => s.length !== 3 || !/^[A-Z]{3}$/.test(s)),
      alias,
    ],
    item: { name: title, label: title + ' · ' + cityName, cc, currency, airport: iata, ll: [lat, lon] },
  });
}
for (const [name, thai, city, lat, lon] of hotels) {
  const [, , cc, currency] = cities.find((row) => row[0] === city);
  directory.push({
    kind: 'stay',
    city,
    keys: [name, thai, 'โรงแรม' + thai, 'โรงแรม ' + thai],
    item: { name, label: thai + ' · ' + name, ll: [lat, lon], cc, currency },
  });
}
for (const [name, en, city, lat, lon, aliases] of sights) {
  const [, , cc, currency] = cities.find((row) => row[0] === city);
  directory.push({
    kind: 'place',
    city,
    keys: [name, en, ...aliases],
    item: { name, label: name + ' · ' + city, ll: [lat, lon], cc, currency },
  });
}
function matchScore(keys, q) {
  let score = Infinity;
  const joined = q.replaceAll(' ', '');
  for (const key of keys) {
    const s = folded(key);
    if (!s) continue;
    if (s === q) return 0;
    if (s.startsWith(q) || s.replaceAll(' ', '').startsWith(joined)) score = Math.min(score, 1);
    else if (s.split(' ').some((part) => part.startsWith(q))) score = Math.min(score, 2);
    else if (q.length >= 3 && s.includes(q)) score = Math.min(score, 3);
  }
  return score;
}
export function localSuggestions(query, { kind = 'city', city = '' } = {}) {
  const q = folded(query);
  if (!q) return [];
  const cityKey = folded(city);
  const localCity =
    cities.find((row) =>
      [row[0], row[1], row[4], ...(row[6] ?? [])].some((alias) => folded(alias) === cityKey),
    )?.[0] ?? city;
  const found = [];
  for (const entry of directory) {
    if (kind === 'city' && entry.kind !== 'city') continue;
    if (kind === 'transport' && !['city', 'airport'].includes(entry.kind)) continue;
    if (kind === 'place' && (entry.kind !== 'place' || (city && entry.city !== localCity))) continue;
    if (kind === 'stay' && (entry.kind !== 'stay' || (city && entry.city !== localCity))) continue;
    let score = matchScore(entry.keys, q);
    if (!Number.isFinite(score)) continue;
    // Airport codes should select the airport for a travel leg and the city for a destination.
    if (kind === 'transport' && entry.kind === 'airport' && folded(entry.item.airport) === q) score = -1;
    found.push({ score, item: entry.item });
  }
  return found
    .sort((a, b) => a.score - b.score)
    .slice(0, 7)
    .map(({ item }) => ({ ...item, ll: [...item.ll] }));
}
const cache = new Map();
let nextId = 0;
function locationKey(row) {
  return folded(row.name) + '|' + row.cc + '|' + row.ll.map((v) => Number(v).toFixed(2)).join(',');
}
function mergeRows(...groups) {
  const rows = new Map();
  for (const row of groups.flat()) {
    if (
      !row ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      !Array.isArray(row.ll) ||
      !row.ll.every(Number.isFinite)
    )
      continue;
    const id = locationKey(row);
    if (!rows.has(id)) rows.set(id, row);
  }
  return [...rows.values()].slice(0, 7);
}
export function locationTerm(value, caret = value.length, multiple = false) {
  if (!multiple) return { query: value.trim(), start: 0, end: value.length };
  const pos = Number.isInteger(caret) ? caret : value.length;
  const left = value.slice(0, pos).search(/[^,，]*$/);
  const next = value.slice(pos).search(/[,，]/);
  const right = next === -1 ? value.length : pos + next;
  const segment = value.slice(left, right);
  const start = left + segment.length - segment.trimStart().length;
  return { query: segment.trim(), start, end: Math.max(start, left + segment.trimEnd().length) };
}
export function attachLocationSuggestions(
  input,
  { kind = 'city', getContext = () => ({}), onSelect = () => {}, multiple = false } = {},
) {
  const doc = input.ownerDocument;
  const id = 'locations-' + ++nextId;
  const fieldLabel = input.labels?.[0]?.textContent.trim();
  if (fieldLabel && !input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby'))
    input.setAttribute('aria-label', fieldLabel);
  const wrapper = doc.createElement('span');
  wrapper.className = 'location-picker';
  input.before(wrapper);
  wrapper.append(input);
  const list = doc.createElement('span');
  list.className = 'location-list';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'สถานที่ที่พบ');
  list.hidden = true;
  const status = doc.createElement('span');
  status.className = 'location-announcement';
  status.setAttribute('role', 'status');
  wrapper.append(list, status);
  input.removeAttribute('list');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';
  let rows = [],
    active = -1,
    sequence = 0,
    timer,
    controller,
    choosing = false,
    composing = false;
  const term = () => locationTerm(input.value, input.selectionStart, multiple);
  function stop() {
    sequence++;
    clearTimeout(timer);
    controller?.abort();
  }
  function highlight(index) {
    active = index;
    [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    const selected = list.children[index];
    if (selected) {
      input.setAttribute('aria-activedescendant', selected.id);
      selected.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function hide() {
    stop();
    rows = [];
    list.replaceChildren();
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    status.textContent = '';
  }
  function choose(index) {
    const item = rows[index];
    if (!item) return;
    hide();
    const { start, end } = term();
    input.value = input.value.slice(0, start) + item.name + input.value.slice(end);
    if (multiple) input.setSelectionRange(start + item.name.length, start + item.name.length);
    choosing = true;
    try {
      onSelect(item);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      choosing = false;
    }
  }
  function render(values) {
    const old = rows[active];
    rows = values;
    list.replaceChildren();
    list.hidden = !rows.length;
    input.setAttribute('aria-expanded', String(Boolean(rows.length)));
    for (const [i, row] of rows.entries()) {
      const option = doc.createElement('span');
      option.className = 'location-option';
      option.id = id + '-' + i;
      option.setAttribute('role', 'option');
      option.textContent = row.label || row.name;
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', (event) => {
        event.preventDefault();
        choose(i);
      });
      list.append(option);
    }
    highlight(old ? rows.findIndex((row) => locationKey(row) === locationKey(old)) : -1);
    status.textContent = rows.length ? 'พบ ' + rows.length + ' สถานที่' : '';
  }
  function search() {
    if (choosing || composing) return;
    stop();
    const seq = sequence;
    const { query } = term();
    if (!query) {
      hide();
      return;
    }
    const context = getContext() ?? {};
    const local = localSuggestions(query, { kind, ...context });
    const params = new URLSearchParams({ q: query, kind });
    if (context.city) params.set('city', String(context.city).slice(0, 120));
    if (
      Array.isArray(context.center) &&
      context.center.length === 2 &&
      context.center.every(Number.isFinite)
    ) {
      params.set('lat', context.center[0].toFixed(3));
      params.set('lon', context.center[1].toFixed(3));
    }
    const key = params.toString(),
      hit = cache.get(key);
    if (hit && hit.until > Date.now()) {
      render(mergeRows(local, hit.rows));
      return;
    }
    render(local);
    if ([...query].length < 2 || query.length > 120) return;
    timer = setTimeout(async () => {
      if (seq !== sequence || doc.activeElement !== input) return;
      const ctrl = new AbortController();
      controller = ctrl;
      try {
        const response = await fetch('/api/location-suggest?' + key, {
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(4500)]),
        });
        if (!response.ok) return;
        const data = await response.json();
        if (
          seq !== sequence ||
          doc.activeElement !== input ||
          term().query !== query ||
          !Array.isArray(data.suggestions)
        )
          return;
        if (cache.size >= 160) cache.delete(cache.keys().next().value);
        cache.set(key, { rows: data.suggestions, until: Date.now() + 300000 });
        render(mergeRows(local, data.suggestions));
      } catch {
        /* Manual input and local suggestions still work. */
      }
    }, 280);
  }
  function keydown(event) {
    if (event.isComposing || composing) return;
    if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hide();
      return;
    }
    if (event.key === 'Tab') {
      hide();
      return;
    }
    if (event.key === 'Enter' && active >= 0 && !list.hidden) {
      event.preventDefault();
      choose(active);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (list.hidden && input.value) search();
      if (!rows.length) return;
      event.preventDefault();
      const next =
        event.key === 'ArrowDown' ? (active + 1) % rows.length : active <= 0 ? rows.length - 1 : active - 1;
      highlight(next);
    }
  }
  const cleanup = new AbortController();
  const events = { signal: cleanup.signal };
  input.addEventListener('keydown', keydown, events);
  input.addEventListener('input', search, events);
  if (multiple) {
    input.addEventListener('click', search, events);
    input.addEventListener(
      'keyup',
      (event) => {
        if (['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) search();
      },
      events,
    );
  }
  input.addEventListener(
    'compositionstart',
    () => {
      composing = true;
      hide();
    },
    events,
  );
  input.addEventListener(
    'compositionend',
    () => {
      composing = false;
      search();
    },
    events,
  );
  input.addEventListener('blur', hide, events);
  return () => {
    hide();
    cleanup.abort();
    for (const name of [
      'role',
      'aria-autocomplete',
      'aria-haspopup',
      'aria-controls',
      'aria-expanded',
      'aria-activedescendant',
    ])
      input.removeAttribute(name);
    wrapper.replaceWith(input);
  };
}
