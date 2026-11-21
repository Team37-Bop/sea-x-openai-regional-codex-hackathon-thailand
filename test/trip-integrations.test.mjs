import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveIntegrations } from '../server/integrations.mjs';
import { operationalStore, createOperationStore } from '../server/operation-store.mjs';
import { createLineService } from '../server/line-trips.mjs';

async function call(method, path, body, token, extra = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}));
  const request = Readable.from([bytes]);
  Object.assign(request, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-bop-trip-token': token } : {}),
      ...extra,
    },
  });
  let status, payload, headers;
  const response = {
    writeHead(code, h) {
      status = code;
      headers = h;
    },
    flushHeaders() {},
    write(s) {
      payload = (payload || '') + s;
    },
    end(s) {
      if (s) payload = (payload || '') + s;
    },
  };
  const handled = await serveIntegrations(
    request,
    response,
    new URL(path, 'http://localhost'),
    new AbortController().signal,
  );
  assert.equal(handled, true);
  const data = headers['Content-Type'].includes('ndjson')
    ? payload
        .trim()
        .split('\n')
        .map((x) => JSON.parse(x))
        .at(-1)
    : JSON.parse(payload);
  return { status, data };
}
function hooks(t, entries) {
  const previous = Object.fromEntries(Object.keys(entries).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}
const setup = {
  city: 'เชียงใหม่',
  startDate: '2026-11-20',
  days: 3,
  members: [
    { id: 'a', name: 'May', role: 'organizer' },
    { id: 'b', name: 'Nok', phone: 'private' },
  ],
};
const options = [
  { key: 'A', title: 'คาเฟ่' },
  { key: 'B', title: 'เดินเล่น' },
];

test('an applied-plan post uses the exact summary, safely retries an accepted request and honors disabled credentials', async (t) => {
  hooks(t, { LINE_CHANNEL_ACCESS_TOKEN: 'test-token', LINE_CHANNEL_SECRET: 'test-secret' });
  const trip = { tripId: 'trip1', groupId: 'group1', organizerHash: createHash('sha256').update('organizer').digest('hex') };
  let quota = 0;
  const attempts = [];
  const service = createLineService({
    getTrip: async () => trip,
    consumePush: async () => { quota++; return true; },
  }, async (url, init) => {
    assert.equal(url, 'https://api.line.me/v2/bot/message/push');
    const key = init.headers['X-Line-Retry-Key'];
    const duplicate = attempts.some((row) => row.key === key);
    attempts.push({ key, ...JSON.parse(init.body) });
    if (!duplicate) throw Error('connection closed after acceptance');
    return new Response(null, { status: 409, headers: { 'x-line-accepted-request-id': 'prior-request' } });
  });
  const text = 'Bop: เปลี่ยนมื้อเย็นเป็นร้านใหม่\nค่าใช้จ่ายเท่าเดิม';
  const input = { text, retryKey: randomUUID() };
  const send = () => service.organizer(trip.tripId, 'organizer', 'post', input);
  await assert.rejects(send(), /connection closed/);
  assert.deepEqual(await send(), { posted: true });
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(attempts[0].messages, [{ type: 'text', text }]);
  assert.equal(attempts[0].to, 'group1');
  assert.match(attempts[0].key, /^[a-f\d-]{36}$/);
  delete process.env.LINE_CHANNEL_SECRET;
  await assert.rejects(send(), { code: 'no_key' });
  assert.equal(quota, 2);
  assert.equal(attempts.length, 2);
});

test('signed group linking, public views, LIFF identity, cross-channel ballots, closure and quota', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bop-trip-test-'));
  const file = join(dir, 'trips.json');
  t.after(() => rm(dir, { force: true, recursive: true }));
  hooks(t, {
    BOP_NO_STORE: '1',
    BOP_TRIP_STORE_FILE: file,
    BOP_STATE_TABLE: 'offline',
    LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    LINE_CHANNEL_SECRET: 'test-secret',
    LINE_LOGIN_CHANNEL_ID: 'login-app',
    LINE_LIFF_ID: 'test-liff',
    BOP_LINE_MONTHLY_CAP: '2',
  });
  let replyFailure = false,
    invalidIdentity = false;
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, req) => {
    assert.equal(new URL(url).origin, 'https://api.line.me');
    if (url.endsWith('/verify')) {
      assert.equal(req.body.get('client_id'), 'login-app');
      if (invalidIdentity) return Response.json({ error: 'invalid_request' }, { status: 400 });
      return Response.json({ sub: 'line-' + req.body.get('id_token'), name: req.body.get('id_token') });
    }
    assert.equal(req.headers.Authorization, 'Bearer test-token');
    if (url.includes('/member/')) return Response.json({ displayName: ' nok ' });
    sent.push([url.split('/').at(-1), JSON.parse(req.body)]);
    if (replyFailure) {
      replyFailure = false;
      return Response.json({ error: 'failed' }, { status: 500 });
    }
    return Response.json({});
  });
  const webhook = (events, signature) => {
    const body = JSON.stringify({ events });
    return call('POST', '/api/line/webhook', body, null, {
      'x-line-signature': signature ?? createHmac('sha256', 'test-secret').update(body).digest('base64'),
    });
  };
  assert.deepEqual((await call('GET', '/api/config')).data, { enabled: true, liffId: 'test-liff' });
  assert.equal((await call('POST', '/api/trips', {}, null, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await webhook([], 'invalid')).data.error, 'invalid_signature');
  assert.equal(
    (
      await call('POST', '/api/line/webhook', '{', null, {
        'x-line-signature': createHmac('sha256', 'test-secret').update('{').digest('base64'),
      })
    ).data.error,
    'invalid_json',
  );
  assert.deepEqual((await webhook([])).data, { ok: true });
  const { data: untitled } = await call('POST', '/api/trips', { setup: { ...setup, title: '   ' } });
  assert.equal(untitled.title, setup.city);
  const title = 'วันหยุดกับเพื่อน';
  const { data: created } = await call('POST', '/api/trips', {
    setup: { ...setup, title },
    summary: 'แผนแรก',
  });
  assert.equal(created.title, title);
  const base = '/api/trips/' + created.tripId,
    token = created.organizerToken;
  const organizer = (method, suffix, body) => call(method, base + suffix, body, token);
  assert.match(created.linkCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.equal((await call('GET', base)).status, 401);
  assert.equal((await call('GET', '/api/trips/unknown', null, token)).status, 401);
  assert.equal((await organizer('POST', '/post', { text: 'hello' })).status, 400);
  const event = {
    source: { type: 'group', groupId: 'group-private', userId: 'line-private' },
    replyToken: 'reply',
  };
  const ev = (id, extra) => ({ ...event, webhookEventId: id, ...extra });
  const link = ev('link', {
    type: 'message',
    message: { type: 'text', text: '  ' + created.linkCode.toLowerCase() + ' ' },
  });
  await webhook([link, link]);
  assert.equal(sent.length, 1);
  assert.ok(sent[0][1].messages[0].text.includes(title));
  const { data: view } = await organizer('GET', '');
  assert.equal(view.title, title);
  assert.equal(view.linked, true);
  assert.equal(view.expiresAt, '2026-12-22T23:59:59.000Z');
  assert.doesNotMatch(JSON.stringify(view), /group-private|organizerHash|linkCode|private/);
  assert.equal(view.members[0].role, 'organizer');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.doesNotMatch(await readFile(file, 'utf8'), new RegExp(token));
  await webhook([
    ev('again', { ...link, webhookEventId: 'again', source: { type: 'group', groupId: 'another' } }),
  ]);
  assert.equal(await operationalStore.groupTrip('another'), undefined);
  replyFailure = true;
  await webhook([ev('retry', { type: 'join' })]);
  await webhook([ev('retry', { type: 'join' })]);
  assert.equal(
    sent.filter(([kind, msg]) => kind === 'reply' && msg.messages[0].text.includes('สวัสดีจาก')).length,
    2,
  );
  const post = await organizer('POST', '/post', { text: 'Bop: Bop: แตะเพื่อดู' });
  assert.equal(post.data.posted, true);
  assert.equal(sent.at(-1)[1].messages[0].text, 'Bop: แตะเพื่อดู');
  const { data: started } = await organizer('POST', '/vote', { options, minutes: 1, reason: 'แผนไหนดี' });
  assert.equal(started.vote.status, 'OPEN');
  assert.equal(started.posted, true);
  assert.equal(Date.parse(started.vote.deadline) - Date.parse(started.vote.createdAt) <= 300000, true);
  const buttonData = sent.at(-1)[1].messages[0].contents.contents[1].footer.contents[0].action.data;
  assert.match(
    sent.at(-1)[1].messages[0].contents.contents[1].footer.contents[1].action.uri,
    /liff\.line\.me\/test-liff/,
  );
  const identity = (idToken, memberId) => call('POST', base + '/identity', { idToken, memberId });
  assert.equal((await identity('May')).data.identity.memberId, null);
  assert.equal((await identity('May', 'a')).data.identity.memberId, 'a');
  assert.equal((await identity('May', 'b')).status, 400);
  assert.equal((await identity('other', 'a')).status, 400);
  invalidIdentity = true;
  assert.equal((await identity('fake')).status, 401);
  invalidIdentity = false;
  const cast = (idToken, option, voteId = started.vote.id) =>
    call('POST', base + '/vote/ballot', { idToken, option, voteId });
  assert.equal((await cast('Nok', 'A')).status, 400);
  await cast('May', 'B');
  assert.equal((await cast('May', 'A')).data.vote.tally.B, 0);
  await webhook([ev('cast', { type: 'postback', postback: { data: buttonData } })]);
  const final = (await organizer('GET', '/vote')).data.vote;
  assert.equal(final.status, 'TIE');
  assert.deepEqual(final.tally, { A: 1, B: 1 });
  assert.equal(final.ballots.b.option, 'B');
  assert.doesNotMatch(JSON.stringify(final), /line-private/);
  const { data: close } = await organizer('POST', '/vote/close', { option: 'B' });
  assert.equal(close.vote.winner, 'B');
  assert.equal(close.quotaReached, true);
  assert.deepEqual((await cast('May', 'B')).data.vote.tally, { A: 1, B: 1 });
  assert.equal((await cast('May', 'Z')).status, 400);
  assert.equal((await cast('May', 'B', 'wrong-id')).status, 400);
  const plan = (await organizer('POST', '/plan', { summary: 'แก้แผนแล้ว' })).data;
  assert.equal(plan.summary, 'แก้แผนแล้ว');
  assert.equal(plan.posted, false);
  assert.deepEqual((await organizer('POST', '/post', { text: 'อีกครั้ง' })).data, {
    posted: false,
    quotaReached: true,
  });
  assert.equal((await organizer('POST', '/vote', { options })).data.vote.status, 'OPEN');
  await operationalStore.mutateTrip(created.tripId, (trip) => {
    trip.vote.deadline = new Date(0).toISOString();
    return trip;
  });
  assert.equal(
    (await cast('May', 'A', (await operationalStore.getTrip(created.tripId)).vote.id)).data.vote.winner,
    'A',
  );
  await webhook([ev('left', { type: 'leave' })]);
  assert.equal((await organizer('GET', '')).data.linked, false);
  assert.deepEqual((await organizer('DELETE', '')).data, { deleted: true });
  assert.equal((await organizer('GET', '')).status, 401);
  const { data: next } = await call('POST', '/api/trips', { setup });
  await call('DELETE', '/api/trips/' + next.tripId, null, next.organizerToken);
  assert.equal(await operationalStore.linkGroup(next.linkCode, 'another'), undefined);
  assert.equal(sent.filter(([kind]) => kind === 'push').length, 2);
});

test('missing configuration and disabled persistence isolate the LINE file from flight state', async (t) => {
  hooks(t, {
    BOP_NO_STORE: '1',
    BOP_STATE_TABLE: 'unused',
    LINE_CHANNEL_ACCESS_TOKEN: undefined,
    LINE_ACCESS_TOKEN: undefined,
    LINE_CHANNEL_SECRET: undefined,
    LINE_LIFF_ID: undefined,
    LIFF_ID: undefined,
    DUFFEL_ACCESS_TOKEN: undefined,
  });
  assert.deepEqual((await call('GET', '/api/config')).data, { enabled: false, liffId: null });
  assert.equal((await call('POST', '/api/trips', { setup })).status, 503);
  const store = createOperationStore(() => assert.fail('DynamoDB used despite BOP_NO_STORE'));
  assert.deepEqual(await store.acquireOperation('invalid', {}), { persisted: false });
  await store.auditOrder({ orderId: 'ord_fake' });
  await store.auditCancellation('ord_fake', 'now');
  const { data } = await call('POST', '/api/flights/order', {});
  assert.deepEqual([data.type, data.code], ['error', 'no_key']);
});

test('DynamoDB operations enforce optimistic trip writes, conditional quota and persistent idempotency', async (t) => {
  hooks(t, {
    BOP_NO_STORE: '0',
    BOP_STATE_TABLE: 'mock',
    BOP_LINE_MONTHLY_CAP: '1',
    BOP_STATE_RETENTION_DAYS: '3',
  });
  const calls = [],
    rows = new Map();
  const conditional = () => Object.assign(new Error(), { name: 'ConditionalCheckFailedException' });
  const store = createOperationStore(async (command, data) => {
    calls.push([command, data]);
    if (command === 'TransactWrite') {
      for (const item of data.TransactItems) {
        if (item.Put) rows.set(item.Put.Item.record_key, item.Put.Item);
        if (item.Delete) rows.delete(item.Delete.Key.record_key);
      }
    } else {
      const id = data.Item?.record_key || data.Key.record_key;
      if (command === 'Get') {
        assert.equal(data.ConsistentRead, true);
        return { Item: rows.get(id) };
      }
      if (command === 'Put') {
        if (rows.has(id) && data.ConditionExpression === 'attribute_not_exists(record_key)')
          throw conditional();
        rows.set(id, data.Item);
      }
      if (command === 'Update') {
        if (id.startsWith('LINE_QUOTA#') && rows.has(id)) throw conditional();
        if (id.startsWith('ORDER#') && !rows.has(id)) throw conditional();
        const attr = data.ExpressionAttributeValues;
        if (id.startsWith('TRIP#')) return { Attributes: rows.get(id) };
        rows.set(id, { ...rows.get(id), status: attr[':end'], response: attr[':response'] });
      }
      if (command === 'Delete') rows.delete(id);
    }
    return {};
  });
  const trip = {
    tripId: randomUUID(),
    linkCode: 'ABCDE2',
    codeExpiresAt: Math.floor(Date.now() / 1000) + 1800,
    expires_at: 2000000000,
  };
  assert.equal(await store.createTrip(trip), true);
  const tx = calls[0][1].TransactItems;
  assert.equal(tx.length, 2);
  assert.ok(tx.every((op) => op.Put.ConditionExpression.includes('attribute_not_exists')));
  const linked = await store.linkGroup(trip.linkCode, 'group');
  assert.equal(linked.groupId, 'group');
  assert.ok(calls.at(-1)[1].TransactItems[2].Delete.ConditionExpression.includes('expires_at >'));
  await store.putBallot({ ...linked, vote: { id: 'vote-id' } }, 'user', 'a');
  const ballot = calls.at(-1)[1];
  assert.equal(ballot.ReturnValues, 'ALL_NEW');
  assert.match(ballot.UpdateExpression, /#v\.#b\.#user/);
  assert.match(ballot.ConditionExpression, /#v\.#id = :id AND #v\.#st = :open/);
  assert.equal(await store.consumePush(), true);
  assert.equal(await store.consumePush(), false);
  assert.match(calls.at(-1)[1].ConditionExpression, /#c < :cap/);
  assert.equal(await store.claimEvent('ev'), true);
  await store.releaseEvent('ev');
  assert.equal(rows.has('LINE_EVENT#ev'), false);
  const id = randomUUID(),
    body = { operation: 'order', passengers: [{ given_name: 'private' }] };
  await assert.rejects(store.acquireOperation('bad', body), { code: 'bad_request' });
  assert.equal((await store.acquireOperation(id, body)).persisted, true);
  const operation = rows.get('IDEMPOTENCY#' + id);
  assert.match(operation.hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(operation), /private/);
  await assert.rejects(store.acquireOperation(id, body), { code: 'rate_limit' });
  await assert.rejects(store.acquireOperation(id, {}), { code: 'bad_request' });
  const confirmed = { order: { orderId: 'ord_one', bookingReference: 'abc' } };
  await store.completeOperation(id, confirmed);
  assert.deepEqual((await store.acquireOperation(id, body)).replay, confirmed);
  await store.auditOrder({ ...confirmed.order, passengers: [{ born_on: 'private' }] });
  assert.doesNotMatch(JSON.stringify(rows.get('ORDER#ord_one')), /private|passenger/);
  await store.auditCancellation('ord_missing', 'now');
  assert.equal(rows.has('ORDER#ord_missing'), false);
  assert.equal(calls.at(-1)[1].ConditionExpression, 'attribute_exists(record_key)');
});
