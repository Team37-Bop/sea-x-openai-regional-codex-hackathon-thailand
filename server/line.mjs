// LINE Messaging API, LIFF identity verification, and trip vote orchestration.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AgentError } from './claude.mjs';
import {
  claimWebhookEvent,
  closeOrganizerVote,
  consumeLinePush,
  createTrip,
  deleteTrip,
  getOrganizerTrip,
  getTrip,
  getTripByGroup,
  getVote,
  linkIdentity,
  linkTripToGroup,
  recordBallot,
  releaseWebhookEvent,
  startVote,
  tripView,
  unlinkGroup,
  updatePlan,
  voteView,
} from './trips.mjs';

const API = 'https://api.line.me';
const token = () => process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const channelSecret = () => process.env.LINE_CHANNEL_SECRET || '';
const loginChannelId = () => process.env.LINE_LOGIN_CHANNEL_ID || process.env.LINE_CHANNEL_ID || '';
const liffId = () => process.env.LIFF_ID || '';
const monthlyCap = () => Math.max(1, Number(process.env.BOP_LINE_MONTHLY_CAP) || 200);

export const lineEnabled = () => !!(token() && channelSecret());
export const lineConfig = () => ({ enabled: lineEnabled(), liffId: liffId() || null });

export function verifyLineSignature(rawBody, signature, secret = channelSecret()) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function lineRequest(path, { method = 'GET', body, bearer = token() } = {}) {
  if (!bearer) throw new AgentError('no_key', 'ยังไม่ได้ตั้งค่า LINE ของ Bop');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) throw new AgentError('auth', 'การเชื่อมต่อ LINE ใช้ไม่ได้', `HTTP ${response.status}`);
    if (response.status === 429) throw new AgentError('rate_limit', 'ส่งข้อความ LINE ครบโควตาชั่วคราว', 'HTTP 429');
    throw new AgentError('upstream', 'LINE ตอบกลับไม่สำเร็จ', `HTTP ${response.status} ${detail.slice(0, 120)}`);
  }
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

const textMessage = text => ({ type: 'text', text: String(text || '').slice(0, 5000) });
async function reply(replyToken, messages) {
  if (!replyToken || !messages.length) return false;
  await lineRequest('/v2/bot/message/reply', { method: 'POST', body: { replyToken, messages: messages.slice(0, 5) } });
  return true;
}
async function push(groupId, messages) {
  if (!groupId || !messages.length) return false;
  if (!(await consumeLinePush(monthlyCap()))) return false;
  await lineRequest('/v2/bot/message/push', { method: 'POST', body: { to: groupId, messages: messages.slice(0, 5) } });
  return true;
}

async function groupProfile(groupId, userId) {
  if (!groupId || !userId) return { userId, displayName: 'สมาชิก LINE' };
  try {
    const profile = await lineRequest(`/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`);
    return { userId, displayName: profile.displayName || 'สมาชิก LINE' };
  } catch {
    return { userId, displayName: 'สมาชิก LINE' };
  }
}

function voteFlex(trip, vote) {
  const liffUrl = liffId() ? `https://liff.line.me/${encodeURIComponent(liffId())}?trip=${encodeURIComponent(trip.trip_id)}` : null;
  const bubbles = vote.options.map(option => ({
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: `แผน ${option.key} · ${option.title}`, weight: 'bold', wrap: true, size: 'lg' },
        ...(option.head ? [{ type: 'text', text: option.head, wrap: true, size: 'sm', color: '#555555' }] : []),
        { type: 'button', style: 'primary', color: '#06C755', action: { type: 'postback', label: `โหวต ${option.key}`, data: `v=${encodeURIComponent(vote.id)}&o=${encodeURIComponent(option.key)}`, displayText: `โหวต ${option.key}` } },
      ],
    },
    ...(liffUrl ? { footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'เปิดแผนใน Bop', uri: liffUrl } }] } } : {}),
  }));
  return {
    type: 'flex',
    altText: `Bop: โหวตแผน ${vote.options.map(option => option.key).join('/')}`,
    contents: { type: 'carousel', contents: bubbles },
  };
}

function voteResultText(vote) {
  if (vote.status === 'TIE') return 'Bop: ผลโหวตเสมอ คนจัดทริปเป็นผู้ตัดสิน';
  return `Bop: ปิดโหวตแล้ว เลือกแผน ${vote.winner || '-'} `;
}

export async function createLineTrip(body) {
  if (!lineEnabled()) throw new AgentError('no_key', 'ยังไม่ได้ตั้งค่า LINE ของ Bop');
  return createTrip({ setup: body?.setup, summary: body?.summary });
}

export async function readLineTrip(tripId, organizerToken) {
  const trip = await getOrganizerTrip(tripId, organizerToken);
  return tripView(trip);
}

export async function updateLinePlan(tripId, organizerToken, summary) {
  const view = await updatePlan(tripId, organizerToken, summary);
  const trip = await getTrip(tripId);
  let posted = false;
  if (trip?.group_id && summary) posted = await push(trip.group_id, [textMessage(`Bop: ${summary}`)]);
  return { ...view, posted };
}

export async function postLineText(tripId, organizerToken, text) {
  const trip = await getOrganizerTrip(tripId, organizerToken);
  if (!trip.group_id) throw new AgentError('bad_request', 'ทริปนี้ยังไม่ได้เชื่อมกลุ่ม LINE');
  const message = String(text || '').trim();
  if (!message) throw new AgentError('bad_request', 'ไม่มีข้อความที่จะส่ง');
  const posted = await push(trip.group_id, [textMessage(message.startsWith('Bop:') ? message : `Bop: ${message}`)]);
  return { posted, quotaReached: !posted };
}

export async function startLineVote(tripId, organizerToken, body) {
  const vote = await startVote(tripId, organizerToken, body || {});
  const trip = await getTrip(tripId);
  const posted = await push(trip.group_id, [voteFlex(trip, vote)]);
  return { vote: voteView(vote), posted, quotaReached: !posted };
}

export async function readLineVote(tripId, organizerToken) {
  return voteView(await getVote(tripId, organizerToken));
}

export async function closeLineVote(tripId, organizerToken, option) {
  const vote = await closeOrganizerVote(tripId, organizerToken, option);
  const trip = await getTrip(tripId);
  const posted = trip?.group_id ? await push(trip.group_id, [textMessage(voteResultText(vote))]) : false;
  return { vote: voteView(vote), posted };
}

export async function removeLineTrip(tripId, organizerToken) {
  await deleteTrip(tripId, organizerToken);
  return { deleted: true };
}

export async function verifyLineIdToken(idToken) {
  if (!loginChannelId()) throw new AgentError('no_key', 'ยังไม่ได้ตั้งค่า LINE Login channel');
  const form = new URLSearchParams({ id_token: String(idToken || ''), client_id: loginChannelId() });
  const response = await fetch(`${API}/oauth2/v2.1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.sub) throw new AgentError('auth', 'ยืนยันตัวตน LINE ไม่สำเร็จ', `HTTP ${response.status}`);
  return { userId: body.sub, displayName: body.name || '' };
}

export async function lineIdentity(tripId, { idToken, memberId }) {
  const identity = await verifyLineIdToken(idToken);
  if (!memberId) {
    const trip = await getTrip(tripId);
    if (!trip) throw new AgentError('bad_request', 'ไม่พบทริปนี้');
    const current = (trip.members || []).find(member => member.lineUserId === identity.userId);
    return { identity: { displayName: identity.displayName, memberId: current?.id || null }, trip: tripView(trip) };
  }
  const trip = await linkIdentity(tripId, identity.userId, memberId, identity.displayName);
  return { identity: { displayName: identity.displayName, memberId }, trip };
}

export async function lineLiffBallot(tripId, { idToken, voteId, option }) {
  const identity = await verifyLineIdToken(idToken);
  const vote = await recordBallot({ tripId, voteId, option, userId: identity.userId, displayName: identity.displayName });
  return { vote: voteView(vote) };
}

export async function handleLineWebhook(rawBody, signature) {
  if (!verifyLineSignature(rawBody, signature)) return { statusCode: 401, body: { error: 'invalid_signature' } };
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return { statusCode: 400, body: { error: 'invalid_json' } }; }

  for (const event of payload.events || []) {
    if (!(await claimWebhookEvent(event.webhookEventId))) continue;
    const groupId = event.source?.groupId;
    const userId = event.source?.userId;
    try {
      if (event.type === 'leave' && groupId) {
        await unlinkGroup(groupId);
        continue;
      }
      if (event.type === 'join' && event.replyToken) {
        await reply(event.replyToken, [textMessage('Bop: ส่งรหัสเชื่อมทริป 6 ตัวจากหน้าแผนในกลุ่มนี้')]);
        continue;
      }
      if (event.type === 'memberJoined' && event.replyToken) {
        await reply(event.replyToken, [textMessage('Bop: สมาชิกใหม่เปิดแผนจากการ์ดในกลุ่มเพื่อเลือก “ฉันคือ…” ได้')]);
        continue;
      }
      if (event.type === 'message' && event.message?.type === 'text' && groupId) {
        const match = String(event.message.text || '').trim().toUpperCase().match(/^[A-HJ-NP-Z2-9]{6}$/);
        if (!match) continue;
        const trip = await linkTripToGroup(match[0], groupId);
        const messages = [textMessage(`Bop: เชื่อมทริป ${trip.title} แล้ว`)];
        if (trip.summary) messages.push(textMessage(`Bop: ${trip.summary}`));
        await reply(event.replyToken, messages);
        continue;
      }
      if (event.type === 'postback' && groupId && userId) {
        const data = new URLSearchParams(event.postback?.data || '');
        const voteId = data.get('v');
        const option = data.get('o');
        if (!voteId || !option) continue;
        const profile = await groupProfile(groupId, userId);
        const vote = await recordBallot({ groupId, voteId, option, userId, displayName: profile.displayName });
        const message = vote.status === 'OPEN'
          ? `Bop: บันทึกโหวต ${option} ของ ${profile.displayName} แล้ว`
          : voteResultText(vote);
        await reply(event.replyToken, [textMessage(message)]);
      }
    } catch (error) {
      await releaseWebhookEvent(event.webhookEventId).catch(() => {});
      if (event.replyToken) {
        const message = error instanceof AgentError ? error.message : 'Bop: ทำรายการ LINE ไม่สำเร็จ';
        await reply(event.replyToken, [textMessage(message)]).catch(() => {});
      }
    }
  }
  return { statusCode: 200, body: { ok: true } };
}
