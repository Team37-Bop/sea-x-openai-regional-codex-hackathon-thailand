// This grammar mirrors the stored summary from trip-integrations.js. Stored text
// can also be legacy/free-form, and must remain readable without interpretation.
const clock = '(?:[01]\\d|2[0-3]):[0-5]\\d';
const dayLine = /^วันที่ ([1-9]\d*) (.+)$/u;
const timeAtStart = new RegExp('^(' + clock + ') (.+)$', 'u');
const nextTime = new RegExp(' → (?=' + clock + ' )', 'u');

const nearStorageLimit = (text) => text.length >= 1980;

function parseDay(line, number) {
  const header = dayLine.exec(line);
  if (!header || Number(header[1]) !== number) return null;
  const stops = [];
  for (const entry of header[2].split(nextTime)) {
    const item = timeAtStart.exec(entry);
    if (!item || item[2] !== item[2].trim() || /[\r\u0000-\u001F]/u.test(item[2]) || / →(?: \d{0,2}:?\d{0,2})?$/u.test(item[2])) return null;
    stops.push({ time: item[1], name: item[2] });
  }
  return { number, stops };
}

export function parseTripSummary(raw) {
  if (typeof raw !== 'string') return null;
  const [city, ...lines] = raw.split('\n');
  if (!city || !lines.length || city !== city.trim() || /[\r\u0000-\u001F]/u.test(city) || city.startsWith('วันที่ ')) return null;
  const nearLimit = nearStorageLimit(raw);
  const days = [];
  // Storage clips at 2,000 UTF-16 units and trims whitespace. A terminated
  // day line is complete; the final line can look valid but be cut mid-venue.
  const end = nearLimit ? lines.length - 1 : lines.length;
  for (let i = 0; i < end; i++) {
    const day = parseDay(lines[i], i + 1);
    if (!day) {
      if (nearLimit) break;
      return null;
    }
    days.push(day);
  }
  if (!days.length) return null;
  return nearLimit ? { city, days, remainder: lines.slice(days.length).join('\n') } : { city, days };
}

export function createTripSummaryRenderer(disclosure, host, doc = document) {
  let last = '';
  let openedOnce = false;
  const openDays = new Map();
  const make = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  return function render(raw, { activeVote = false } = {}) {
    const text = typeof raw === 'string' && raw.trim() ? raw : '';
    if (text === last) return;
    for (const day of host.querySelectorAll('details[data-day]')) openDays.set(Number(day.dataset.day), day.open);
    last = text;
    disclosure.hidden = !text;
    if (!text) {
      host.replaceChildren();
      return;
    }
    if (!openedOnce) {
      disclosure.open = !activeVote;
      openedOnce = true;
    }
    const parsed = parseTripSummary(text);
    const warning = () => make('p', 'สรุปอาจไม่ครบ', 'liff-summary-warning');
    if (!parsed) {
      host.replaceChildren(
        ...(nearStorageLimit(text) ? [warning()] : []),
        make('p', text, 'liff-summary-plain'),
      );
      return;
    }
    const focusedDay = [...host.querySelectorAll('details[data-day]')].find((day) =>
      day.querySelector('summary') === doc.activeElement,
    )?.dataset.day;
    let replacement;
    const days = make('div', null, 'liff-summary-days');
    for (const day of parsed.days) {
      const item = make('details', null, 'liff-summary-day');
      item.dataset.day = String(day.number);
      item.open = openDays.has(day.number) ? openDays.get(day.number) : day.number === 1;
      const list = make('ol', null, 'liff-summary-timeline');
      list.setAttribute('role', 'list');
      for (const stop of day.stops) {
        const row = make('li');
        const time = make('time', stop.time);
        time.dateTime = stop.time;
        row.append(time, make('span', stop.name));
        list.append(row);
      }
      const heading = make('summary', 'วันที่ ' + day.number);
      if (item.dataset.day === focusedDay) replacement = heading;
      item.append(heading, list);
      days.append(item);
    }
    const tail = parsed.remainder != null ? [
      warning(),
      make('p', parsed.remainder, 'liff-summary-plain'),
    ] : [];
    host.replaceChildren(make('p', parsed.city, 'liff-summary-destination'), days, ...tail);
    if (disclosure.open && focusedDay) {
      (replacement || disclosure.querySelector('summary'))?.focus({ preventScroll: true });
    }
  };
}
