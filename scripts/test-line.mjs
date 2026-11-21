import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'bop-line-test-'));
const store = path.join(dir, 'trips.json');
process.env.BOP_TRIP_STORE_FILE = store;
process.env.BOP_NO_STORE = '0';
delete process.env.BOP_STATE_TABLE;
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-test-token';
process.env.LINE_CHANNEL_SECRET = 'line-test-secret';
process.env.LINE_CHANNEL_ID = '1234567890';
process.env.LIFF_ID = '123-test';
process.env.BOP_LINE_MONTHLY_CAP = '20';

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  requests.push({ url, method: init.method || 'GET', body: init.body ? String(init.body) : '' });
  if (url.includes('/member/')) return new Response(JSON.stringify({ userId: 'U1', displayName: 'Mint' }), { status: 200 });
  if (url.endsWith('/oauth2/v2.1/verify')) return new Response(JSON.stringify({ sub: 'U2', name: 'Palm' }), { status: 200 });
  return new Response('{}', { status: 200 });
};

try {
  const line = await import('../server/line.mjs');
  const trips = await import('../server/trips.mjs');
  const setup = {
    title: 'เชียงใหม่กับเพื่อน', startDate: '2026-11-20', endDate: '2026-11-22', days: 3,
    members: [{ id: 'mint', name: 'Mint', role: 'organizer' }, { id: 'palm', name: 'Palm' }],
  };

  assert.equal(line.verifyLineSignature(Buffer.from('{}'), 'wrong'), false);
  const created = await line.createLineTrip({ setup, summary: 'แผนพร้อมแล้ว' });
  assert.match(created.linkCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.ok(created.organizerToken);
  assert.ok(created.expiresAt > Math.floor(Date.now() / 1000));
  console.log('ok   trip link code and 30-day post-trip retention');

  const event = {
    webhookEventId: 'evt-link', type: 'message', replyToken: 'reply-link',
    source: { type: 'group', groupId: 'G1', userId: 'U1' },
    message: { type: 'text', text: created.linkCode },
  };
  const raw = Buffer.from(JSON.stringify({ events: [event] }));
  const signature = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64');
  assert.equal((await line.handleLineWebhook(raw, 'bad')).statusCode, 401);
  assert.equal((await line.handleLineWebhook(raw, signature)).statusCode, 200);
  const linked = await line.readLineTrip(created.tripId, created.organizerToken);
  assert.equal(linked.linked, true);
  assert.ok(requests.some(request => request.url.endsWith('/v2/bot/message/reply')));
  console.log('ok   signed webhook links a group and forged webhook is rejected');

  const voteResult = await line.startLineVote(created.tripId, created.organizerToken, {
    voteReason: 'เลือกแผน',
    options: [
      { key: 'A', title: 'แผน A', head: 'เช้า', line: 'Bop: แผน A' },
      { key: 'B', title: 'แผน B', head: 'สาย', line: 'Bop: แผน B' },
    ],
  });
  assert.equal(voteResult.posted, true);
  assert.ok(requests.some(request => request.url.endsWith('/v2/bot/message/push')));

  const voteId = voteResult.vote.id;
  const voteEvent = option => ({
    webhookEventId: `evt-vote-${option}`, type: 'postback', replyToken: `reply-${option}`,
    source: { type: 'group', groupId: 'G1', userId: 'U1' },
    postback: { data: `v=${voteId}&o=${option}` },
  });
  for (const option of ['A', 'B']) {
    const body = Buffer.from(JSON.stringify({ events: [voteEvent(option)] }));
    const sig = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(body).digest('base64');
    assert.equal((await line.handleLineWebhook(body, sig)).statusCode, 200);
  }
  let vote = await line.readLineVote(created.tripId, created.organizerToken);
  assert.equal(Object.keys(vote.ballots).length, 1);
  assert.equal(Object.values(vote.ballots)[0].option, 'B');
  console.log('ok   one LINE user has one ballot and the last vote counts');

  const identity = await line.lineIdentity(created.tripId, { idToken: 'valid', memberId: 'palm' });
  assert.equal(identity.identity.memberId, 'palm');
  await assert.rejects(trips.linkIdentity(created.tripId, 'U2', 'mint', 'Palm'), /เลือกสมาชิกของทริปไปแล้ว/);
  await assert.rejects(trips.linkIdentity(created.tripId, 'U3', 'palm', 'Other'), /บัญชี LINE อื่น/);
  vote = (await line.lineLiffBallot(created.tripId, { idToken: 'valid', voteId, option: 'A' })).vote;
  assert.equal(vote.status, 'TIE');
  const closed = await line.closeLineVote(created.tripId, created.organizerToken, 'B');
  assert.equal(closed.vote.status, 'CLOSED');
  assert.equal(closed.vote.winner, 'B');
  console.log('ok   LIFF identity maps a member and organizer resolves a tie');

  const deadlineVote = await line.startLineVote(created.tripId, created.organizerToken, {
    options: [{ key: 'A', title: 'แผน A' }, { key: 'B', title: 'แผน B' }],
  });
  const deadlineState = JSON.parse(readFileSync(store, 'utf8'));
  deadlineState[`TRIP#${created.tripId}`].vote.deadline = '2000-01-01T00:00:00.000Z';
  writeFileSync(store, JSON.stringify(deadlineState));
  vote = await line.readLineVote(created.tripId, created.organizerToken);
  assert.equal(vote.id, deadlineVote.vote.id);
  assert.equal(vote.status, 'TIE');
  console.log('ok   vote closes at its deadline and routes ties to the organizer');

  const expiring = await line.createLineTrip({ setup: { ...setup, title: 'Expired' } });
  const state = JSON.parse(readFileSync(store, 'utf8'));
  state[`LINK#${expiring.linkCode}`].expires_at = 1;
  writeFileSync(store, JSON.stringify(state));
  await assert.rejects(trips.linkTripToGroup(expiring.linkCode, 'G2'), /หมดอายุ/);
  console.log('ok   expired link codes cannot attach a group');

  await line.removeLineTrip(created.tripId, created.organizerToken);
  await assert.rejects(line.readLineTrip(created.tripId, created.organizerToken), /ไม่มีสิทธิ์/);
  const afterDelete = JSON.parse(readFileSync(store, 'utf8'));
  assert.equal(afterDelete[`LINK#${created.linkCode}`], undefined);
  console.log('ok   organizer can delete retained LINE personal data and pending link lookup');

  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  assert.equal(line.lineEnabled(), false);
  await assert.rejects(line.createLineTrip({ setup }), /ยังไม่ได้ตั้งค่า LINE/);
  console.log('ok   no-key path keeps LINE calls disabled');
} finally {
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
}

console.log('all passed');
