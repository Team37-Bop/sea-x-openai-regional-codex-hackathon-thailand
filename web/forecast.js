import { readEvents } from './stream.js';

const keyFor = (alert) => [alert.stopId, alert.date, alert.level].join('|');
const messages = {
  unavailable: 'ยังอ่านข้อมูลฝนไม่ได้',
  beyond_horizon: 'ยังไม่มีพยากรณ์อากาศสำหรับวันเดินทาง',
  partial_horizon: 'มีพยากรณ์เฉพาะบางวันของทริป',
  no_exposed: 'ไม่มีจุดแวะกลางแจ้งที่ต้องตรวจฝน',
};
export function rankAlerts(alerts) {
  return [...alerts].sort(
    (a, b) =>
      Number(b.level === 'heavy') - Number(a.level === 'heavy') ||
      b.prob - a.prob ||
      a.day - b.day ||
      a.from.localeCompare(b.from),
  );
}
export function rainCommand(alert) {
  const level = alert.level === 'heavy' ? 'ฝนตกหนัก' : 'มีฝน';
  return (
    'พยากรณ์' +
    level +
    ' ' +
    alert.from +
    '–' +
    alert.to +
    ' วันที่ ' +
    (alert.day + 1) +
    ' ที่' +
    alert.n +
    ' (โอกาส ' +
    alert.prob +
    '% ~' +
    alert.mm +
    ' มม./ชม.) ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม'
  );
}
function containsStop(plan, alert) {
  const day = plan?.days?.[alert.day];
  return day && (!day.date || day.date === alert.date) && day.stops?.some((stop) => stop.id === alert.stopId);
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action) {
  const node = element('button', label, 'quiet');
  node.type = 'button';
  node.onclick = action;
  return node;
}
async function requestWeather(body, signal) {
  const response = await fetch('/api/weather-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return readEvents(response, () => {});
}
export function createForecast({
  getState,
  isBusy = () => false,
  onChange,
  onReplan,
  canNotify,
  notify,
  request = requestWeather,
}) {
  let current,
    result,
    status = '',
    manualCheck = false;
  const dismissed = new Set(),
    notified = new Set();

  function reset() {
    current?.abort();
    current = result = undefined;
    status = '';
    manualCheck = false;
    dismissed.clear();
    notified.clear();
  }

  function visible(plan, day) {
    return rankAlerts(
      (result?.alerts ?? []).filter(
        (alert) => alert.day === day && !dismissed.has(keyFor(alert)) && containsStop(plan, alert),
      ),
    );
  }

  async function refresh({ manual = false } = {}) {
    current?.abort();
    const state = getState();
    const controller = new AbortController();
    current = controller;
    result = undefined;
    manualCheck = manual;
    status = '';
    if (!state?.plan || state.demo) {
      if (manual && state?.demo) status = 'ทริปตัวอย่างใช้สถานการณ์ฝนจำลอง';
      onChange();
      return;
    }
    if (manual) status = 'กำลังตรวจพยากรณ์ตามจุดแวะกลางแจ้ง';
    onChange();
    const stillCurrent = () =>
      current === controller && !controller.signal.aborted && getState()?.plan === state.plan;
    try {
      const data = await request({ setup: state.setup, plan: state.plan }, controller.signal);
      if (!stillCurrent()) return;
      result = data;
      status =
        messages[data.reason] || (manual && !data.alerts?.length ? 'ไม่พบฝนที่กระทบจุดแวะกลางแจ้ง' : '');
      if (data.failed && data.checked && !status) status = 'บางจุดใช้พยากรณ์ที่บันทึกไว้ก่อนหน้า';
      onChange();
      if (notify && canNotify?.(state)) {
        const [first] = rankAlerts(
          (data.alerts ?? []).filter((a) => containsStop(state.plan, a) && !dismissed.has(keyFor(a))),
        );
        if (first && !notified.has(keyFor(first))) {
          notified.add(keyFor(first));
          try {
            await notify(first, state);
          } catch {
            /* Delivery can be uncertain. Keep this alert from generating duplicate pushes. */
          }
        }
      }
    } catch {
      if (!stillCurrent()) return;
      status = messages.unavailable;
      onChange();
    }
  }

  function renderStrip(container, plan, day) {
    container.replaceChildren();
    const [alert] = visible(plan, day);
    if (!alert) {
      if (
        status &&
        (manualCheck || ['partial_horizon', 'beyond_horizon'].includes(result?.reason) || result?.failed)
      ) {
        container.append(element('p', status, 'alert'));
      }
      return;
    }
    const card = element('article', '', 'alert');
    const label = (alert.trend ? 'แนวโน้ม' : '') + (alert.level === 'heavy' ? 'ฝนตกหนัก' : 'มีฝน');
    card.append(element('strong', label + 'ช่วง ' + alert.from + '–' + alert.to + ' ที่' + alert.n));
    card.append(element('p', 'โอกาส ' + alert.prob + '% · ประมาณ ' + alert.mm + ' มม./ชม.'));
    card.append(element('p', 'ข้อมูลอากาศ: Open-Meteo.com', 'muted'));
    if (!isBusy() && (!alert.trend || alert.level === 'heavy')) {
      card.append(
        button('ให้ Bop ปรับแผน', () => {
          if (!isBusy() && visible(getState().plan, day).some((a) => keyFor(a) === keyFor(alert))) {
            onReplan(rainCommand(alert), alert.day);
          }
        }),
      );
    }
    card.append(
      button('ปิดแจ้งเตือน', () => {
        dismissed.add(keyFor(alert));
        onChange();
      }),
    );
    container.append(card);
  }

  function badge(stop, day, plan) {
    const alert = visible(plan, day).find((a) => a.stopId === stop.id);
    if (!alert) return null;
    const label = (alert.trend ? 'แนวโน้ม' : '') + (alert.level === 'heavy' ? 'ฝนตกหนัก' : 'มีฝน');
    const badge = element('span', label + ' ' + alert.from + '–' + alert.to, 'pill');
    badge.title = 'ข้อมูลอากาศ: Open-Meteo.com';
    return badge;
  }
  function dayLabel(plan, day) {
    const [alert] = visible(plan, day);
    return alert ? (alert.trend ? 'แนวโน้ม' : '') + (alert.level === 'heavy' ? 'ฝนตกหนัก' : 'มีฝน') : '';
  }
  return { reset, refresh, renderStrip, badge, dayLabel };
}
