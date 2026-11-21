import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { operationalStore, failure } from './operation-store.mjs';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const compact = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const epoch = () => Math.floor(Date.now() / 1000);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const text = (value) => ({ type: 'text', text: String(value).slice(0, 5000) });
const equal = (left, right) => left.length === right.length && timingSafeEqual(left, right);
const deny = () => failure('auth', 'ไม่พบสิทธิ์จัดการทริปนี้');
const invalid = (message) => failure('bad_request', message);
const token = () => process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_ACCESS_TOKEN;
const secret = () => process.env.LINE_CHANNEL_SECRET;
export function lineConfig() {
  return {
    enabled: Boolean(token() && secret()),
    liffId: process.env.LINE_LIFF_ID || process.env.LIFF_ID || null,
  };
}
const liffUri = (id) =>
  lineConfig().liffId &&
  'https://liff.line.me/' + encodeURIComponent(lineConfig().liffId) + '?tripId=' + encodeURIComponent(id);
function required() {
  if (!lineConfig().enabled) throw failure('no_key', 'ยังไม่ได้ตั้งค่าบัญชี LINE ของ Bop');
}
function day(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function project(setup, summary) {
  if (!setup || !day(setup.startDate)) throw invalid('กรุณาระบุวันเริ่มทริป');
  const days = Number(setup.days);
  const endDate =
    day(setup.endDate) && setup.endDate >= setup.startDate
      ? setup.endDate
      : new Date(
          Date.parse(setup.startDate) + 86400000 * (Math.max(1, Math.min(365, Math.floor(days) || 1)) - 1),
        )
          .toISOString()
          .slice(0, 10);
  const members = [];
  const ids = new Set();
  for (const row of Array.isArray(setup.members) ? setup.members : []) {
    const id = compact(row?.id, 80),
      name = compact(row?.name, 120);
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    members.push({ id, name, ...(row.role === 'organizer' ? { role: 'organizer' } : {}) });
    if (members.length === 20) break;
  }
  return {
    title: compact(setup.title || setup.city, 200) || 'ทริปของเรา',
    summary: compact(summary, 2000),
    startDate: setup.startDate,
    endDate,
    members,
    expires_at: Date.parse(endDate + 'T23:59:59Z') / 1000 + 30 * 86400,
  };
}
function counts(vote) {
  const tally = Object.fromEntries(vote.options.map((option) => [option.key, 0]));
  for (const ballot of Object.values(vote.ballots)) tally[ballot.option]++;
  return tally;
}
function voteView(vote) {
  if (!vote) return null;
  const ballots = Object.create(null);
  let anon = 0;
  const reserved = new Set(Object.values(vote.ballots).map((b) => b.memberId));
  for (const ballot of Object.values(vote.ballots)) {
    let id = ballot.memberId;
    if (!id || Object.hasOwn(ballots, id)) {
      do {
        id = 'anonymous-' + ++anon;
      } while (reserved.has(id));
    }
    ballots[id] = { option: ballot.option, memberId: ballot.memberId, displayName: ballot.displayName };
  }
  return {
    id: vote.id,
    status: vote.status,
    reason: vote.reason,
    options: vote.options,
    createdAt: vote.createdAt,
    deadline: vote.deadline,
    ballots,
    tally: counts(vote),
    winner: vote.winner ?? null,
  };
}
function view(trip) {
  return {
    tripId: trip.tripId,
    title: trip.title,
    summary: trip.summary,
    linked: !!trip.groupId,
    linkedAt: trip.linkedAt || null,
    expiresAt: new Date(trip.expires_at * 1000).toISOString(),
    members: trip.members.map(({ id, name, role, lineUserId }) => ({
      id,
      name,
      ...(role ? { role } : {}),
      linked: !!lineUserId,
    })),
    vote: voteView(trip.vote),
  };
}
function finalize(trip) {
  const vote = trip.vote;
  if (!vote || vote.status !== 'OPEN') return;
  const represented = new Set(
    Object.values(vote.ballots)
      .map((row) => row.memberId)
      .filter(Boolean),
  );
  if (
    Date.now() < Date.parse(vote.deadline) &&
    (!trip.members.length || !trip.members.every((member) => represented.has(member.id)))
  )
    return;
  const sorted = Object.entries(counts(vote)).sort((a, b) => b[1] - a[1]);
  const winner = sorted[0]?.[1] && sorted[0][1] > (sorted[1]?.[1] || 0) ? sorted[0][0] : null;
  vote.winner = winner;
  vote.status = winner ? 'CLOSED' : 'TIE';
  return trip;
}
function voteFlex(trip) {
  const vote = trip.vote;
  const uri = liffUri(trip.tripId);
  const bubbles = vote.options.map((option) => {
    const buttons = [
      {
        type: 'button',
        style: 'primary',
        action: {
          type: 'postback',
          label: 'โหวต ' + option.key,
          data: new URLSearchParams({ voteId: vote.id, option: option.key }).toString(),
        },
      },
    ];
    if (uri) buttons.push({ type: 'button', action: { type: 'uri', label: 'เลือกชื่อของฉัน', uri } });
    const lines = [option.key + ' · ' + option.title, option.head].filter(Boolean);
    return {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: lines.map((line, i) => ({
          type: 'text',
          text: line,
          wrap: true,
          weight: i ? 'regular' : 'bold',
        })),
      },
      footer: { type: 'box', layout: 'vertical', contents: buttons },
    };
  });
  return {
    type: 'flex',
    altText: 'โหวตแผนทริป ' + trip.title,
    contents: { type: 'carousel', contents: bubbles },
  };
}
const resultText = (vote) =>
  vote.status === 'CLOSED'
    ? 'ผลโหวตของกลุ่ม: ' + (vote.options.find((o) => o.key === vote.winner)?.title || vote.winner)
    : vote.status === 'TIE'
      ? 'คะแนนเสมอ ให้ผู้จัดทริปเลือกแผนสุดท้าย'
      : 'บันทึกคะแนนโหวตแล้ว ขอบคุณค่ะ';

export function createLineService(store = operationalStore, request = (...args) => fetch(...args)) {
  async function lineApi(path, options = {}, auth = true) {
    const response = await request('https://api.line.me' + path, {
      ...options,
      headers: { ...(auth ? { Authorization: 'Bearer ' + token() } : {}), ...options.headers },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw failure(
        response.status === 429
          ? 'rate_limit'
          : !auth && [400, 401].includes(response.status)
            ? 'auth'
            : 'upstream',
        'LINE ทำรายการไม่สำเร็จ',
      );
    return response.status === 204 ? {} : response.json();
  }
  const send = (endpoint, body) =>
    lineApi('/v2/bot/message/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, messages: body.messages.slice(0, 5) }),
    });
  const reply = async (event, ...messages) => {
    if (event.replyToken) await send('reply', { replyToken: event.replyToken, messages });
  };
  async function push(trip, ...messages) {
    if (!trip.groupId) return { posted: false };
    if (!(await store.consumePush())) return { posted: false, quotaReached: true };
    await send('push', { to: trip.groupId, messages });
    return { posted: true };
  }
  async function create(input) {
    required();
    const base = project(input?.setup, input?.summary);
    const organizerToken = randomBytes(32).toString('base64url');
    for (let i = 0; i < 8; i++) {
      const linkCode = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
      const trip = {
        ...base,
        tripId: randomUUID(),
        organizerHash: hash(organizerToken),
        linkCode,
        codeExpiresAt: epoch() + 1800,
        vote: null,
      };
      if (await store.createTrip(trip))
        return {
          ...view(trip),
          organizerToken,
          linkCode,
          codeExpiresAt: new Date(trip.codeExpiresAt * 1000).toISOString(),
        };
    }
    throw failure('rate_limit', 'ยังสร้างรหัสเชื่อมกลุ่มไม่ได้ กรุณาลองใหม่');
  }
  async function authorize(id, credential) {
    const trip = await store.getTrip(id);
    if (!trip || !credential || !equal(Buffer.from(trip.organizerHash), Buffer.from(hash(credential))))
      throw deny();
    return trip;
  }
  async function finishIfDue(trip) {
    if (!trip?.vote || !finalize(structuredClone(trip))) return trip;
    return await store.mutateTrip(trip.tripId, finalize);
  }
  async function organizer(id, credential, action, input = {}) {
    const trip = await authorize(id, credential);
    if (action === 'get') return view(await finishIfDue(trip));
    if (action === 'remove') {
      await store.deleteTrip(id);
      return { deleted: true };
    }
    if (action === 'vote.get') return { vote: voteView((await finishIfDue(trip)).vote) };
    if (action === 'plan') {
      const next = await store.mutateTrip(id, (current) => ({
        ...current,
        summary: compact(input.summary, 2000),
      }));
      if (!next) throw deny();
      return { ...view(next), ...(next.summary ? await push(next, text(next.summary)) : { posted: false }) };
    }
    if (!trip.groupId) throw invalid('เชื่อมต่อกลุ่ม LINE ก่อน');
    if (action === 'post') {
      const message = compact(input.text, 5000);
      if (!message) throw invalid('กรุณาใส่ข้อความ');
      return push(trip, text('Bop: ' + message.replace(/^(?:Bop:\s*)+/i, '')));
    }
    if (action === 'vote.start') {
      const options = [];
      for (const row of Array.isArray(input.options) ? input.options : []) {
        const key = compact(row?.key, 16),
          title = compact(row?.title, 160);
        if (key && title && !options.some((o) => o.key === key))
          options.push({ key, title, head: compact(row.head || row.line, 300) });
        if (options.length === 3) break;
      }
      if (!options.length) throw invalid('ต้องมีตัวเลือกสำหรับโหวต');
      const minutes = Number(input.deadlineMinutes ?? input.minutes ?? 120);
      const deadline = new Date(
        Date.now() + 60000 * (Number.isFinite(minutes) ? Math.min(1440, Math.max(5, minutes)) : 120),
      ).toISOString();
      const vote = {
        id: randomUUID(),
        status: 'OPEN',
        reason: compact(input.reason, 500),
        options,
        ballots: {},
        createdAt: new Date().toISOString(),
        deadline,
      };
      const next = await store.mutateTrip(id, (current) => {
        if (!current.groupId) throw invalid('เชื่อมต่อกลุ่ม LINE ก่อน');
        return { ...current, vote };
      });
      if (!next) throw deny();
      return { vote: voteView(vote), ...(await push(next, voteFlex(next))) };
    }
    if (action === 'vote.close') {
      const next = await store.mutateTrip(id, (current) => {
        const vote = current.vote;
        if (!vote?.options.some((o) => o.key === input.option)) throw invalid('ไม่พบตัวเลือกนี้');
        if (vote.status === 'CLOSED') return;
        vote.winner = input.option;
        vote.status = 'CLOSED';
        return current;
      });
      if (!next) throw deny();
      if (trip.vote?.status === 'CLOSED') return { vote: voteView(next.vote), posted: false };
      return { vote: voteView(next.vote), ...(await push(next, text(resultText(next.vote)))) };
    }
    throw invalid('คำขอไม่ถูกต้อง');
  }
  async function verified(input) {
    required();
    const clientId = process.env.LINE_LOGIN_CHANNEL_ID || process.env.LINE_CHANNEL_ID;
    if (!clientId) throw failure('no_key', 'ยังไม่ได้ตั้งค่า LINE Login');
    if (!compact(input?.idToken, 8192)) throw failure('auth', 'กรุณาเข้าสู่ระบบ LINE');
    const data = await lineApi(
      '/oauth2/v2.1/verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: input.idToken, client_id: clientId }),
      },
      false,
    );
    if (!compact(data.sub, 256)) throw failure('auth', 'ยืนยันบัญชี LINE ไม่สำเร็จ');
    return { userId: data.sub, displayName: compact(data.name, 120) || 'สมาชิก LINE' };
  }
  const normalizeName = (value) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  async function ballot(id, identity, voteId, option, requireMember = false) {
    for (let i = 0; i < 12; i++) {
      const trip = await store.getTrip(id);
      if (!trip?.vote || trip.vote.id !== voteId || !trip.vote.options.some((o) => o.key === option))
        throw invalid('ไม่พบโหวตหรือตัวเลือกนี้');
      const bound = trip.members.find((m) => m.lineUserId === identity.userId);
      if (requireMember && !bound) throw invalid('เลือกชื่อของคุณก่อนโหวต');
      if (trip.vote.status !== 'OPEN') return voteView(trip.vote);
      const member =
        bound ||
        trip.members.find(
          (m) => !m.lineUserId && normalizeName(m.name) === normalizeName(identity.displayName),
        );
      const submitted = await store.putBallot(trip, 'user-' + hash(identity.userId), {
        option,
        memberId: member?.id ?? null,
        displayName: identity.displayName,
      });
      if (submitted) return voteView((await finishIfDue(submitted)).vote);
    }
    throw failure('rate_limit', 'มีการโหวตพร้อมกัน กรุณาลองใหม่');
  }
  async function participant(id, action, input) {
    const identity = await verified(input);
    if (action === 'ballot') return { vote: await ballot(id, identity, input.voteId, input.option, true) };
    const trip = await store.mutateTrip(id, (current) => {
      if (input.memberId == null) return;
      const member = current.members.find((m) => m.id === input.memberId);
      const bound = current.members.find((m) => m.lineUserId === identity.userId);
      if (
        !member ||
        (bound && bound.id !== member.id) ||
        (member.lineUserId && member.lineUserId !== identity.userId)
      )
        throw invalid('บัญชีนี้ไม่สามารถเชื่อมกับชื่อที่เลือก');
      member.lineUserId = identity.userId;
      member.displayName = identity.displayName;
      return current;
    });
    if (!trip) throw invalid('ไม่พบทริป');
    return {
      ...view(await finishIfDue(trip)),
      identity: {
        displayName: identity.displayName,
        memberId: trip.members.find((m) => m.lineUserId === identity.userId)?.id ?? null,
      },
    };
  }
  async function eventHandler(event) {
    const groupId = event?.source?.groupId;
    if (!groupId || event.source.type !== 'group') return;
    if (event.type === 'join')
      return reply(event, text('สวัสดีจาก Bop ส่งรหัสเชื่อมทริป 6 ตัวที่ได้จากผู้จัดทริปในกลุ่มนี้'));
    if (event.type === 'message' && event.message?.type === 'text') {
      const code = event.message.text.trim().toUpperCase();
      if (code.length !== 6 || ![...code].every((c) => alphabet.includes(c))) return;
      const trip = await store.linkGroup(code, groupId);
      if (trip)
        return reply(
          event,
          text('เชื่อมกลุ่มกับทริป ' + trip.title + ' แล้ว' + (trip.summary ? '\n' + trip.summary : '')),
        );
      return reply(event, text('รหัสนี้หมดอายุหรือถูกใช้แล้ว'));
    }
    const trip = await store.groupTrip(groupId);
    if (!trip) return;
    if (event.type === 'leave') return store.unlinkGroup(trip.tripId, groupId);
    if (event.type === 'memberJoined' && liffUri(trip.tripId))
      return reply(event, text('เลือกชื่อของคุณเพื่อโหวตแผนทริป ' + liffUri(trip.tripId)));
    if (event.type !== 'postback' || !event.source.userId) return;
    const data = new URLSearchParams(event.postback?.data);
    if (!data.has('voteId') || !data.has('option')) return;
    const userId = event.source.userId;
    let displayName = 'สมาชิก LINE';
    try {
      displayName =
        compact(
          (
            await lineApi(
              '/v2/bot/group/' + encodeURIComponent(groupId) + '/member/' + encodeURIComponent(userId),
            )
          ).displayName,
          120,
        ) || displayName;
    } catch {
      /* Anonymous group profiles may be unavailable. */
    }
    const vote = await ballot(trip.tripId, { userId, displayName }, data.get('voteId'), data.get('option'));
    await reply(event, text(resultText(vote)));
  }
  async function webhook(bytes, signature) {
    required();
    const expected = createHmac('sha256', secret()).update(bytes).digest('base64');
    if (!equal(Buffer.from(expected), Buffer.from(signature || '')))
      throw failure('invalid_signature', 'ลายเซ็น LINE ไม่ถูกต้อง');
    let envelope;
    try {
      envelope = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw failure('invalid_json', 'ข้อมูล JSON ไม่ถูกต้อง');
    }
    if (!Array.isArray(envelope?.events)) throw invalid('ไม่พบรายการเหตุการณ์');
    for (const event of envelope.events) {
      const id = compact(event?.webhookEventId, 256);
      if (!(await store.claimEvent(id))) continue;
      try {
        await eventHandler(event);
      } catch {
        await store.releaseEvent(id).catch(() => {});
        await reply(event, text('Bop ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง')).catch(() => {});
      }
    }
    return { ok: true };
  }
  return { create, organizer, participant, webhook };
}
export const lineTrips = createLineService();
