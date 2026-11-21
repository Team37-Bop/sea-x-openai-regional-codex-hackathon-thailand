import { el, action, message, tripRequest, label } from './integration-ui.js';
import { renderFlightPanels } from './flight-panel.js';

let config;
let current;
let appliedMessage;
const sessions = new Map();
const storageKey = 'bop.line.organizer.v1';
let saved = {};
try {
  saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {};
} catch {
  /* Private browsing can disable storage. */
}
function remember(session, localTripId = session.state?.localTripId) {
  if (session.auth) {
    saved[session.key] = session.auth;
    if (localTripId) saved['trip/' + localTripId] = session.auth;
  } else {
    const oldId = saved[session.key]?.tripId;
    for (const key of Object.keys(saved)) if (saved[key]?.tripId === oldId) delete saved[key];
  }
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    /* Keep the current page usable. */
  }
}
function keyFor(state) {
  const data = state.setup || {};
  const identity = [
    data.city,
    data.startDate,
    data.endDate,
    (data.members || []).map((m) => [m.id, m.name]),
  ];
  if (data.title && data.title !== data.city && data.title !== 'ทริปของเรา') identity.push(data.title);
  return JSON.stringify(identity);
}
function lineSessionKey(state) {
  const localKey = state.localTripId && 'trip/' + state.localTripId;
  return state.lineSessionKey || (localKey && saved[localKey] ? localKey : keyFor(state));
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
  if (appliedMessage?.session === s) appliedMessage.refresh();
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
async function loadLine(s) {
  config ??= tripRequest('/api/config').catch((err) => {
    config = null;
    throw err;
  });
  s.enabled = (await config).enabled;
  s.host.hidden = !s.enabled;
  if (!s.enabled || !s.auth || s.trip) return;
  s.loading ??= access(s).then((trip) => {
    s.trip = trip;
    drawLine(s);
    startPolling(s);
  }).catch((err) => {
    if (err.code !== 'auth') throw err;
    s.auth = null;
    remember(s);
    drawLine(s);
  }).finally(() => { s.loading = null; });
  await s.loading;
}
export function renderTripIntegrations(container, state) {
  const key = lineSessionKey(state);
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
  renderFlightPanels(container, state, keyFor(state));
  if (!state.plan?.days.every(Boolean)) return;
  if (!s.host) {
    s.host = el('article', null, 'alert');
    drawLine(s);
  }
  (container.querySelector('[data-booking-line]') || container).append(s.host);
  s.host.hidden = !s.enabled;
  loadLine(s).catch((err) => { s.output.textContent = err.message; });
  if (s.auth && !s.trip?.linked) startPolling(s);
}
export function renderLineVote(container, state, result, apply) {
  const s = current;
  if (!s?.enabled || s.key !== lineSessionKey(state) || !s.auth || !s.trip?.linked) return false;
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
            reason: result.vote_reason || result.summary,
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
  return !!(current?.enabled && current.auth && current.trip?.linked && lineSessionKey(state) === current.key);
}

function groupMessage(text) {
  const content = String(text || '').trim().replace(/^(?:Bop:\s*)+/i, '');
  return content ? ('Bop: ' + content).slice(0, 5000) : '';
}

export function lineMessageBubble(text, title) {
  const section = el('section', null, 'line-message');
  section.append(el('h4', title), el('blockquote', groupMessage(text)));
  return section;
}

export function renderAppliedLine(container, before, after, text, fromLineVote, showBooking) {
  const s = current?.key === lineSessionKey(before) ? current : null;
  if (s) {
    // This is the same group trip even when the new itinerary ends on a different date.
    after.lineSessionKey = s.key;
    if (s.auth) remember(s, after.localTripId);
  }
  container.replaceChildren();
  const body = groupMessage(text);
  if (!body) return;
  const panel = lineMessageBubble(body, 'ข้อความสำหรับกลุ่ม LINE');
  const status = message(panel);
  const controls = el('div', null, 'inline');
  panel.append(controls);
  container.append(panel);
  let sent = false, sending = false;
  const retryKey = globalThis.crypto?.randomUUID?.();
  const active = () => container.contains(panel) && s === current;
  async function send() {
    if (!active() || sending || sent || !s?.enabled || !s?.auth || !s.trip?.linked) return;
    sending = true;
    controls.replaceChildren();
    status.textContent = 'กำลังส่งเข้ากลุ่ม LINE…';
    try {
      const result = await access(s, '/post', { text: body, ...(retryKey && { retryKey }) });
      sent = result.posted === true;
      status.textContent = sent ? 'ส่งเข้ากลุ่ม LINE แล้ว'
        : result.quotaReached ? 'ยังไม่ได้ส่ง · ครบโควตา LINE ของเดือนนี้' : 'ยังไม่ได้ส่งเข้ากลุ่ม LINE';
    } catch (err) {
      status.textContent = 'ยังยืนยันการส่งไม่ได้ · ' + err.message;
      if (retryKey && active()) controls.append(action('ลองส่งอีกครั้ง', send));
    } finally {
      sending = false;
    }
  }
  function showActions(autoSend = false) {
    if (!active() || sent || sending) return;
    controls.replaceChildren();
    if (!s?.enabled) status.textContent = 'ยังไม่ได้ส่ง · ยังไม่ได้ตั้งค่าบริการ LINE';
    else if (!s.trip?.linked || !s.auth) {
      status.textContent = 'ยังไม่ได้ส่ง · ทริปนี้ยังไม่ได้เชื่อมกลุ่ม LINE';
      controls.append(action('ไปเชื่อมกลุ่ม LINE', () => {
        showBooking();
        s.host.scrollIntoView({ block: 'center' });
        s.host.querySelector('button')?.focus({ preventScroll: true });
      }));
    } else if (autoSend && !fromLineVote) void send();
    else {
      status.textContent = fromLineVote ? 'กลุ่มเลือกแผนผ่าน LINE แล้ว · ยังไม่ได้ส่งสรุปนี้' : 'พร้อมส่งเข้ากลุ่ม LINE';
      controls.append(action('ส่งสรุปเข้ากลุ่ม LINE', send));
    }
  }
  async function prepare() {
    status.textContent = 'กำลังตรวจสอบการเชื่อมต่อ LINE…';
    try {
      if (s) await loadLine(s);
      if (!s) status.textContent = 'ยังไม่ได้ส่ง · ทริปนี้ยังไม่ได้เชื่อมกลุ่ม LINE';
      else if (active()) {
        appliedMessage = { session: s, refresh: () => showActions() };
        showActions(true);
      }
    } catch {
      status.textContent = 'ยังไม่ได้ส่ง · ตรวจสอบการเชื่อมต่อ LINE ไม่สำเร็จ';
      controls.replaceChildren(action('ลองตรวจสอบอีกครั้ง', prepare));
    }
  }
  void prepare();
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
