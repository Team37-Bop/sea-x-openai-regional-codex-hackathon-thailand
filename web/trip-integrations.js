import { el, action, message, tripRequest, label } from './integration-ui.js';
import { renderFlightPanels } from './flight-panel.js';
import { pendingReservationMessage } from './booking-tasks.js';

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
function setupKey(data) {
  const identity = [
    data.city,
    data.startDate,
    data.endDate,
    (data.members || []).map((m) => [m.id, m.name]),
  ];
  if (data.title && data.title !== data.city && data.title !== 'ทริปของเรา') identity.push(data.title);
  return JSON.stringify(identity);
}
export function newTripIntegrationKey() {
  return 'plan/' + crypto.getRandomValues(new Uint32Array(4)).join('-');
}
export function bindTripIntegrations(state) {
  const legacyLink = state.localTripId && 'trip/' + state.localTripId;
  const legacyKey = legacyLink && saved[legacyLink] ? legacyLink : setupKey(state.setup);
  if (state.localTripId) {
    const storageSlot = 'bop.trip.origin.' + state.localTripId;
    try {
      state.integrationKey ??= sessionStorage.getItem(storageSlot) || legacyKey;
      sessionStorage.setItem(storageSlot, state.integrationKey);
    } catch {
      /* The planner state still carries the key when session storage is unavailable. */
    }
  }
  state.integrationKey ??= legacyKey;
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
      action('ส่งงานโทรจองเข้า LINE', safe(async () => {
        const text = pendingReservationMessage(s.state);
        if (!text) {
          s.output.textContent = 'ไม่มีงานโทรจองที่รอติดต่อ';
          return;
        }
        const data = await access(s, '/post', { text });
        s.output.textContent = deliver(data);
      })),
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
  const key = state.integrationKey;
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
  loadLine(s).catch((err) => { s.output.textContent = err.message; });
  if (s.auth && !s.trip?.linked) startPolling(s);
}
const startedVotes = new WeakMap();
export function renderLineVote(container, state, result, apply, showLocalVote) {
  const s = current;
  if (!s?.auth || s.key !== state.integrationKey || s.enabled === false || s.trip?.linked === false) return false;
  clearTimeout(s.voteTimer);
  const panel = el('section', null, 'line-vote');
  s.votePanel = panel;
  const feedback = message(panel);
  const ballot = el('div');
  panel.append(ballot);
  container.append(panel);
  let voteId, finished = false, closing = false;
  const active = () => !finished && s === current && s.votePanel === panel && panel.isConnected;
  function local(reason) {
    if (!active()) return;
    clearTimeout(s.voteTimer);
    finished = true;
    ballot.replaceChildren();
    feedback.textContent = reason;
    showLocalVote(voteId ? syncLocalChoice : undefined);
  }
  async function readVote() {
    const { vote } = await access(s, '/vote');
    return vote?.id === voteId ? vote : null;
  }
  async function closeVote(key) {
    const live = await readVote();
    if (!live || live.status === 'CLOSED') return live;
    const { vote } = await access(s, '/vote/close', { option: key, voteId });
    return vote?.id === voteId ? vote : null;
  }
  async function syncLocalChoice(option) {
    // An unpublished ballot may already exist on the server. Finalize it if reachable.
    try {
      const vote = await closeVote(option.key);
      return result.options.find((o) => o.key === vote?.winner);
    } catch { return undefined; }
  }
  async function choose(key) {
    if (!active() || closing) return;
    clearTimeout(s.voteTimer);
    closing = true;
    feedback.textContent = 'กำลังปิดโหวต LINE…';
    ballot.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const vote = await closeVote(key);
      if (!active()) return;
      closing = false;
      display(vote);
    } catch {
      if (!active()) return;
      closing = false;
      feedback.textContent = 'ยังยืนยันผลไม่ได้ กำลังตรวจโหวตอีกครั้ง';
      ballot.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      void poll();
    }
  }
  function display(vote) {
    if (!active() || closing) return;
    if (!vote) return local('โหวตใน LINE เปลี่ยนไปแล้ว เลือกแผนนี้ในแอปได้');
    if (vote.status === 'CLOSED') {
      const selected = result.options.find((option) => option.key === vote.winner);
      if (!selected) return local('ไม่พบตัวเลือกที่ชนะโหวต เลือกแผนในแอปได้');
      finished = true;
      clearTimeout(s.voteTimer);
      apply(selected);
      return;
    }
    const members = state.setup.members || [];
    const votes = Object.values(vote.ballots || {});
    const votedIds = new Set(votes.map((v) => v.memberId));
    const pending = members.filter((member) => !votedIds.has(member.id));
    ballot.replaceChildren(el('p', 'คะแนนกลุ่ม · ' + vote.options.map((o) => o.key + ' ' + (vote.tally?.[o.key] || 0)).join(' / ')));
    if (votes.length) {
      const list = el('ul');
      for (const v of votes) {
        const who = members.find((m) => m.id === v.memberId)?.name || v.displayName || 'สมาชิก LINE';
        list.append(el('li', who + ' เลือก ' + v.option));
      }
      ballot.append(list);
    }
    if (vote.status === 'TIE') ballot.append(el('p', 'คะแนนเสมอ ผู้จัดทริปเลือกแผนสุดท้าย'));
    else if (pending.length) ballot.append(el('p', 'รอโหวตจาก ' + pending.map((m) => m.name).join(', ')));
    const choices = el('div', null, 'inline');
    for (const opt of vote.options) choices.append(action('ปิดโหวตและใช้แผน ' + opt.key, () => choose(opt.key)));
    ballot.append(choices);
    s.voteTimer = setTimeout(poll, 3000);
  }
  async function poll() {
    if (!active() || closing) return;
    try {
      const vote = await readVote();
      if (!active() || closing) return;
      feedback.textContent = 'ส่งโหวตเข้ากลุ่ม LINE แล้ว';
      display(vote);
    } catch {
      if (!active() || closing) return;
      feedback.textContent = 'กำลังรอการเชื่อมต่อเพื่อดูผลโหวต LINE';
      s.voteTimer = setTimeout(poll, 3000);
    }
  }
  async function start() {
    feedback.textContent = 'กำลังส่งตัวเลือกให้กลุ่มโหวตใน LINE…';
    try {
      await loadLine(s);
      if (!active()) return;
      if (!s.enabled || !s.auth || !s.trip?.linked) return local('ยังไม่ได้เชื่อมกลุ่ม LINE เลือกแผนในแอปได้');
      if (!startedVotes.has(result)) {
        startedVotes.set(result, access(s, '/vote', {
          reason: result.vote_reason || result.summary,
          deadlineMinutes: 120,
          options: result.options.map(({ key, title, head, line }) => ({ key, title, head: head || line })),
        }));
      }
      const delivery = await startedVotes.get(result);
      if (!active()) return;
      voteId = delivery.vote?.id;
      if (!delivery.posted || !voteId)
        return local(delivery.quotaReached ? 'ครบโควตา LINE ของเดือนนี้ เลือกแผนในแอปได้' : 'ยังไม่ได้ส่งโหวตเข้า LINE เลือกแผนในแอปได้');
      feedback.textContent = 'ส่งโหวตเข้ากลุ่ม LINE แล้ว';
      display(delivery.vote);
    } catch {
      local('ยังยืนยันการส่งโหวตเข้า LINE ไม่ได้ เลือกแผนในแอปได้');
    }
  }
  void start();
  return true;
}
export function canNotifyWeather(state) {
  return !!(current?.enabled && current.auth && current.trip?.linked && state.integrationKey === current.key);
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
  const s = current?.key === before.integrationKey && current?.key === after.integrationKey ? current : null;
  if (s?.auth) remember(s, after.localTripId);
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
      status.textContent = fromLineVote ? 'ปิดโหวต LINE แล้ว · ยังไม่ได้ส่งสรุปนี้' : 'พร้อมส่งเข้ากลุ่ม LINE';
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
