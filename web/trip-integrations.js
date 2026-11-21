import { el, action, message, tripRequest, label } from './integration-ui.js';
import { renderFlightPanels } from './flight-panel.js';

let config;
let current;
const sessions = new Map();
const storageKey = 'bop.line.organizer.v1';
let saved = {};
try {
  saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {};
} catch {
  /* Private browsing can disable storage. */
}
function remember(session) {
  if (session.auth) saved[session.key] = session.auth;
  else delete saved[session.key];
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    /* Keep the current page usable. */
  }
}
function keyFor(state) {
  const data = state.setup || {};
  return JSON.stringify([
    data.city,
    data.startDate,
    data.endDate,
    (data.members || []).map((m) => [m.id, m.name]),
  ]);
}
function summary(state) {
  const plan = state.plan;
  return [
    plan.city,
    ...plan.days
      .filter(Boolean)
      .map(
        (d, i) => 'วันที่ ' + (i + 1) + ' ' + (d.stops || []).map((s) => s.start + ' ' + s.name).join(' → '),
      ),
  ]
    .join('\n')
    .slice(0, 2000);
}
function access(s, path = '', data, method) {
  return tripRequest('/api/trips/' + encodeURIComponent(s.auth.tripId) + path, {
    token: s.auth.organizerToken,
    data,
    method: method || (data ? 'POST' : 'GET'),
  });
}
function deliver(result) {
  return result.quotaReached
    ? 'ครบโควตาส่ง LINE ของเดือนนี้'
    : result.posted
      ? 'ส่งเข้ากลุ่มแล้ว'
      : 'บันทึกแล้ว';
}
function startPolling(s) {
  clearTimeout(s.linkTimer);
  if (s !== current || !s.auth || s.trip?.linked || Date.now() >= Date.parse(s.auth.codeExpiresAt)) return;
  s.linkTimer = setTimeout(async () => {
    if (s !== current || !s.auth) return;
    try {
      s.trip = await access(s);
      if (s.trip.linked || Date.now() >= Date.parse(s.auth.codeExpiresAt)) drawLine(s);
    } catch (err) {
      if (s.auth) s.output.textContent = err.message;
    }
    startPolling(s);
  }, 5000);
}
function drawLine(s) {
  if (!s.host) return;
  const host = s.host;
  host.replaceChildren(el('h3', 'กลุ่ม LINE'));
  s.output = message(host);
  const safe = (work) => async () => {
    try {
      await work();
    } catch (e) {
      s.output.textContent = e.message;
    }
  };
  if (!s.auth) {
    host.append(
      action(
        'เชื่อมทริปกับกลุ่ม LINE',
        safe(async () => {
          const data = await tripRequest('/api/trips', {
            method: 'POST',
            data: { setup: s.state.setup, summary: summary(s.state) },
          });
          s.auth = {
            tripId: data.tripId,
            organizerToken: data.organizerToken,
            linkCode: data.linkCode,
            codeExpiresAt: data.codeExpiresAt,
          };
          s.trip = data;
          remember(s);
          drawLine(s);
          startPolling(s);
        }),
      ),
    );
    return;
  }
  if (s.trip?.linked) {
    host.append(el('p', 'เชื่อมกลุ่มแล้ว · ' + s.trip.title));
    host.append(
      action(
        'ส่งสรุปแผนล่าสุด',
        safe(async () => {
          const data = await access(s, '/plan', { summary: summary(s.state) });
          s.output.textContent = deliver(data);
        }),
      ),
    );
    const input = el('input');
    input.maxLength = 4995;
    host.append(
      label('ข้อความถึงเพื่อน', input),
      action(
        'ส่งข้อความเข้ากลุ่ม',
        safe(async () => {
          if (!input.value.trim()) {
            input.focus();
            return;
          }
          const data = await access(s, '/post', { text: input.value });
          s.output.textContent = deliver(data);
          if (data.posted) input.value = '';
        }),
      ),
    );
  } else {
    host.append(
      el(
        'p',
        Date.now() < Date.parse(s.auth.codeExpiresAt)
          ? 'เชิญ Bop เข้ากลุ่ม แล้วส่งรหัส ' +
              s.auth.linkCode +
              ' ภายใน ' +
              new Date(s.auth.codeExpiresAt).toLocaleTimeString('th-TH', {
                hour: '2-digit',
                minute: '2-digit',
              })
          : 'รหัสหมดอายุ ลบทริป LINE นี้เพื่อสร้างรหัสใหม่',
      ),
    );
  }
  host.append(
    action(
      'ลบทริป LINE',
      safe(async () => {
        if (!window.confirm('ลบการเชื่อมกลุ่มและผลโหวตของทริปนี้?')) return;
        await access(s, '', undefined, 'DELETE');
        s.trip = null;
        s.auth = null;
        clearTimeout(s.linkTimer);
        clearTimeout(s.voteTimer);
        remember(s);
        drawLine(s);
      }),
    ),
  );
}
export function renderTripIntegrations(container, state) {
  const key = keyFor(state);
  if (current?.key !== key) {
    if (current) {
      clearTimeout(current.linkTimer);
      clearTimeout(current.voteTimer);
    }
    if (!sessions.has(key)) sessions.set(key, { key, auth: saved[key] || null, state });
    current = sessions.get(key);
  }
  const s = current;
  s.state = state;
  renderFlightPanels(container, state, key);
  if (!state.plan?.days.every(Boolean)) return;
  if (!s.host) {
    s.host = el('article', null, 'alert');
    drawLine(s);
  }
  (container.querySelector('[data-booking-line]') || container).append(s.host);
  s.host.hidden = !s.enabled;
  config ??= tripRequest('/api/config').catch(() => {
    config = null;
    return { enabled: false };
  });
  config.then(async (value) => {
    if (s !== current) return;
    s.host.hidden = !value.enabled;
    s.enabled = value.enabled;
    if (!value.enabled || !s.auth || s.initialized) return;
    s.initialized = true;
    try {
      s.trip = await access(s);
      drawLine(s);
    } catch (err) {
      if (err.code === 'auth') {
        s.auth = null;
        remember(s);
        drawLine(s);
      } else s.output.textContent = err.message;
    }
    startPolling(s);
  });
  if (s.auth && !s.trip?.linked) startPolling(s);
}
export function renderLineVote(container, state, result, apply) {
  const s = current;
  if (!s || s.key !== keyFor(state) || !s.auth || !s.trip?.linked) return false;
  clearTimeout(s.voteTimer);
  const panel = el('div');
  container.append(panel);
  let voteId;
  const isActive = () => s === current && panel.isConnected && s.auth;
  async function update(vote) {
    if (!isActive() || !vote || vote.id !== voteId) return;
    panel.replaceChildren(
      el(
        'p',
        'คะแนนกลุ่ม · ' + vote.options.map((o) => o.key + ' ' + (vote.tally?.[o.key] || 0)).join(' / '),
      ),
    );
    if (vote.status === 'CLOSED') {
      const chosen = result.options.find((o) => o.key === vote.winner);
      if (chosen) apply(chosen);
      return;
    }
    if (vote.status === 'TIE') {
      panel.append(el('p', 'คะแนนเสมอ ผู้จัดทริปเลือกแผนสุดท้าย'));
      for (const opt of vote.options)
        panel.append(
          action('ใช้ ' + opt.title, async () => {
            try {
              await update((await access(s, '/vote/close', { option: opt.key })).vote);
            } catch (err) {
              panel.append(el('p', err.message));
            }
          }),
        );
      return;
    }
    s.voteTimer = setTimeout(poll, 3000);
  }
  async function poll() {
    if (!isActive()) return;
    try {
      await update((await access(s, '/vote')).vote);
    } catch (err) {
      panel.replaceChildren(el('p', err.message));
      s.voteTimer = setTimeout(poll, 3000);
    }
  }
  const note = message(panel);
  panel.append(
    action(
      'เปิดโหวตในกลุ่ม LINE',
      async () => {
        try {
          const data = await access(s, '/vote', {
            reason: result.summary,
            options: result.options.map(({ key, title, head, line }) => ({ key, title, head: head || line })),
          });
          voteId = data.vote.id;
          await update(data.vote);
          if (data.quotaReached) panel.prepend(el('p', deliver(data)));
        } catch (err) {
          note.textContent = err.message;
        }
      },
      'primary',
    ),
  );
  return true;
}
export function canNotifyWeather(state) {
  return !!(current?.auth && current.trip?.linked && keyFor(state) === current.key);
}
export async function notifyWeather(alert, state) {
  if (!canNotifyWeather(state)) return { posted: false };
  const description = alert.level === 'heavy' ? 'คาดว่าฝนตกหนัก' : 'มีโอกาสฝนตก';
  return access(current, '/post', {
    text: [
      description,
      alert.n,
      alert.from && alert.from + '–' + alert.to,
      Number.isFinite(alert.prob) && 'โอกาส ' + alert.prob + '%',
    ]
      .filter(Boolean)
      .join(' · '),
  });
}
