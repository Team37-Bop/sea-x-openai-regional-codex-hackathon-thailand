import liff from '/assets/liff.js';
import { el, action, tripRequest } from './integration-ui.js';
import { createTripSummaryRenderer } from './liff-summary.js';

const status = document.querySelector('#status');
const panel = document.querySelector('#participant');
const summary = document.querySelector('#trip-summary');
const summaryHeading = summary.querySelector('summary');
const summaryLink = document.querySelector('#trip-summary-link');
const renderSummary = createTripSummaryRenderer(
  summary,
  document.querySelector('#trip-summary-content'),
);
function updateSummary(text, activeVote) {
  renderSummary(text, { activeVote });
  summaryLink.hidden = !activeVote || summary.hidden;
}
summaryLink.addEventListener('click', (event) => {
  event.preventDefault();
  summary.open = true;
  summaryHeading.focus();
  summaryHeading.scrollIntoView({ block: 'start' });
});
function keyedAction(key, ...args) {
  const button = action(...args);
  button.dataset.focusKey = key;
  return button;
}
const params = new URLSearchParams(location.search);
const tripId =
  params.get('tripId') ||
  params.get('trip') ||
  new URL(params.get('liff.state') || '/', location.origin).searchParams.get('tripId');
let timer;
let busy = false;
let path;
const post = (url, data = {}) => {
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('กรุณาเปิด LINE Login และอนุญาตให้ยืนยันตัวตน');
  return tripRequest(path + url, { method: 'POST', data: { ...data, idToken } });
};
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!document.hidden) run();
    else schedule();
  }, 5000);
}
async function run(actionWork, memberId) {
  if (busy) return;
  busy = true;
  clearTimeout(timer);
  try {
    if (actionWork) await actionWork();
    const trip = await post('/identity', memberId ? { memberId } : {});
    document.querySelector('#title').textContent = trip.title;
    status.textContent = 'สวัสดี ' + trip.identity.displayName;
    const focusKey = panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    panel.replaceChildren();
    updateSummary(trip.identity.memberId ? trip.summary : '', trip.vote?.status === 'OPEN');
    if (!trip.identity.memberId) {
      panel.append(el('h2', 'เลือกชื่อของคุณในทริป'));
      const available = trip.members.filter((m) => !m.linked);
      if (!available.length)
        panel.append(el('p', 'ชื่อในทริปเชื่อมกับบัญชี LINE แล้ว กรุณาติดต่อผู้จัดทริป'));
      for (const member of available) panel.append(keyedAction('member:' + member.id, member.name, () => run(null, member.id)));
    } else {
      panel.append(
        el(
          'p',
          'สมาชิก · ' +
            (trip.members.find((m) => m.id === trip.identity.memberId)?.name || trip.identity.displayName),
        ),
      );
      const vote = trip.vote;
      if (!vote) panel.append(el('p', 'ยังไม่มีการโหวตที่เปิดอยู่'));
      else {
        panel.append(el('h2', vote.reason || 'โหวตแผนทริป'));
        if (vote.status === 'OPEN')
          panel.append(el('p', 'ปิดโหวต ' + new Date(vote.deadline).toLocaleString('th-TH')));
        for (const option of vote.options) {
          const row = el('article', null, 'option');
          row.append(
            el('strong', option.key + ' · ' + option.title),
            el('p', option.head || ''),
            el('p', (vote.tally[option.key] || 0) + ' คะแนน'),
          );
          if (vote.status === 'OPEN') {
            const voted = vote.ballots[trip.identity.memberId]?.option === option.key;
            row.append(
              keyedAction(
                'vote:' + vote.id + ':' + option.key,
                voted ? 'คุณเลือกตัวเลือกนี้แล้ว' : 'เลือกตัวเลือกนี้',
                () => run(() => post('/vote/ballot', { voteId: vote.id, option: option.key })),
                voted ? 'quiet' : 'primary',
              ),
            );
          }
          panel.append(row);
        }
        if (vote.status !== 'OPEN')
          panel.append(
            el(
              'p',
              vote.winner
                ? 'ผลโหวต · ' + vote.options.find((o) => o.key === vote.winner)?.title
                : 'คะแนนเสมอ รอผู้จัดทริปเลือก',
            ),
          );
      }
      schedule();
    }
    if (focusKey) {
      const replacement = [...panel.querySelectorAll('[data-focus-key]')].find((button) => button.dataset.focusKey === focusKey);
      if (replacement) replacement.focus({ preventScroll: true });
    }
  } catch (error) {
    updateSummary('', false);
    status.textContent = error.message;
    schedule();
  } finally {
    busy = false;
  }
}
async function init() {
  if (!tripId) throw new Error('เปิดลิงก์จากกลุ่ม LINE ของทริป');
  path = '/api/trips/' + encodeURIComponent(tripId);
  const config = await tripRequest('/api/config');
  if (!config.enabled || !config.liffId) throw new Error('ทริปนี้ยังไม่ได้เปิดใช้งาน LINE Login');
  if (!liff) throw new Error('โหลด LINE Login ไม่สำเร็จ กรุณาเปิดอีกครั้ง');
  await liff.init({ liffId: config.liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }
  await run();
}
window.addEventListener('pagehide', () => clearTimeout(timer));
init().catch((err) => {
  status.textContent = err.message;
});
