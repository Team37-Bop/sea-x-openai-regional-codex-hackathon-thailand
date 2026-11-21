// Minimal trip, LINE-link, identity, vote, and quota state.
// AWS uses DynamoDB. Local development falls back to one gitignored JSON file.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { AgentError } from './claude.mjs';

const tableName = () => process.env.BOP_STATE_TABLE || '';
const useDynamo = () => process.env.BOP_NO_STORE !== '1' && !!tableName();
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const localFile = () => process.env.BOP_TRIP_STORE_FILE || path.resolve(process.cwd(), 'server/.data/trips.json');
const nowSeconds = () => Math.floor(Date.now() / 1000);
const iso = () => new Date().toISOString();
const hash = value => createHash('sha256').update(String(value || '')).digest('hex');
const conditional = error => error?.name === 'ConditionalCheckFailedException' || error?.name === 'TransactionCanceledException';

function readLocal() {
  try { return JSON.parse(readFileSync(localFile(), 'utf8')); }
  catch { return {}; }
}
function writeLocal(data) {
  const file = localFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  renameSync(temp, file);
}
async function get(key) {
  if (useDynamo()) return (await ddb.send(new GetCommand({ TableName: tableName(), Key: { record_key: key }, ConsistentRead: true }))).Item || null;
  return readLocal()[key] || null;
}
async function put(item, mustBeNew = false) {
  if (useDynamo()) {
    await ddb.send(new PutCommand({ TableName: tableName(), Item: item, ...(mustBeNew ? { ConditionExpression: 'attribute_not_exists(record_key)' } : {}) }));
  } else {
    const data = readLocal();
    if (mustBeNew && data[item.record_key]) throw Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' });
    data[item.record_key] = item; writeLocal(data);
  }
}
async function remove(key) {
  if (useDynamo()) await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { record_key: key } }));
  else { const data = readLocal(); delete data[key]; writeLocal(data); }
}

function tripExpiry(setup) {
  const last = setup?.endDate || (() => {
    const date = new Date(`${setup?.startDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Math.max(0, Number(setup?.days || 1) - 1));
    return date.toISOString().slice(0, 10);
  })();
  const date = new Date(`${last}T23:59:59Z`);
  return Math.floor(date.getTime() / 1000) + 30 * 86400;
}
const memberList = setup => (setup?.members || []).slice(0, 20).map(member => ({
  id: String(member.id || '').slice(0, 80),
  name: String(member.name || '').slice(0, 120),
  ...(member.role === 'organizer' ? { role: 'organizer' } : {}),
})).filter(member => member.id && member.name);
const publicVote = vote => vote && ({
  ...vote,
  ballots: Object.fromEntries(Object.values(vote.ballots || {}).map((ballot, index) => [ballot.memberId || `anonymous-${index + 1}`, ballot])),
});
const publicTrip = trip => trip && ({
  tripId: trip.trip_id,
  title: trip.title,
  summary: trip.summary || '',
  members: (trip.members || []).map(member => ({ id: member.id, name: member.name, ...(member.role ? { role: member.role } : {}), linked: !!member.lineUserId })),
  linked: !!trip.group_id,
  linkedAt: trip.linked_at || null,
  expiresAt: trip.expires_at,
  vote: publicVote(trip.vote) || null,
});

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyOrganizerToken(trip, token) {
  return !!trip?.organizer_token_hash && secureEqual(trip.organizer_token_hash, hash(token));
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const linkCode = () => Array.from(randomBytes(6), byte => CODE_CHARS[byte % CODE_CHARS.length]).join('');

export async function createTrip({ setup, summary = '' }) {
  const tripId = randomUUID();
  const organizerToken = randomBytes(32).toString('base64url');
  const code = linkCode();
  const createdAt = iso();
  const codeExpiresAt = nowSeconds() + 30 * 60;
  const expiresAt = tripExpiry(setup);
  const trip = {
    record_key: `TRIP#${tripId}`,
    record_type: 'TRIP',
    trip_id: tripId,
    title: String(setup?.title || 'ทริป Bop').slice(0, 200),
    summary: String(summary || '').slice(0, 2000),
    members: memberList(setup),
    start_date: setup?.startDate,
    end_date: setup?.endDate,
    organizer_token_hash: hash(organizerToken),
    link_code: code,
    code_expires_at: codeExpiresAt,
    created_at: createdAt,
    expires_at: expiresAt,
  };
  const codeItem = {
    record_key: `LINK#${code}`,
    record_type: 'LINK',
    trip_id: tripId,
    expires_at: codeExpiresAt,
  };
  if (useDynamo()) {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName(), Item: trip, ConditionExpression: 'attribute_not_exists(record_key)' } },
      { Put: { TableName: tableName(), Item: codeItem, ConditionExpression: 'attribute_not_exists(record_key)' } },
    ] }));
  } else {
    const data = readLocal(); data[trip.record_key] = trip; data[codeItem.record_key] = codeItem; writeLocal(data);
  }
  return { ...publicTrip(trip), organizerToken, linkCode: code, codeExpiresAt };
}

export async function getTrip(tripId) { return get(`TRIP#${tripId}`); }
export async function getOrganizerTrip(tripId, token) {
  const trip = await getTrip(tripId);
  if (!trip || !verifyOrganizerToken(trip, token)) throw new AgentError('auth', 'ไม่มีสิทธิ์เข้าถึงทริปนี้');
  return trip;
}
export const tripView = publicTrip;
export const voteView = publicVote;

export async function updatePlan(tripId, token, summary) {
  const trip = await getOrganizerTrip(tripId, token);
  const value = String(summary || '').slice(0, 2000);
  if (useDynamo()) {
    await ddb.send(new UpdateCommand({ TableName: tableName(), Key: { record_key: trip.record_key },
      UpdateExpression: 'SET #summary = :summary, #updated = :updated',
      ExpressionAttributeNames: { '#summary': 'summary', '#updated': 'updated_at' },
      ExpressionAttributeValues: { ':summary': value, ':updated': iso() } }));
  } else { trip.summary = value; trip.updated_at = iso(); await put(trip); }
  return { ...publicTrip({ ...trip, summary: value }) };
}

export async function linkTripToGroup(code, groupId) {
  const normalized = String(code || '').trim().toUpperCase();
  const link = await get(`LINK#${normalized}`);
  if (!link || link.expires_at < nowSeconds()) throw new AgentError('bad_request', 'รหัสเชื่อมทริปหมดอายุหรือไม่ถูกต้อง');
  const trip = await getTrip(link.trip_id);
  if (!trip) throw new AgentError('bad_request', 'ไม่พบทริปสำหรับรหัสนี้');
  const linkedAt = iso();
  const group = { record_key: `GROUP#${groupId}`, record_type: 'GROUP', trip_id: trip.trip_id, expires_at: trip.expires_at };
  if (useDynamo()) {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: tableName(), Key: { record_key: trip.record_key },
        UpdateExpression: 'SET #group = :group, #linked = :linked REMOVE #code, #codeExpiry',
        ExpressionAttributeNames: { '#group': 'group_id', '#linked': 'linked_at', '#code': 'link_code', '#codeExpiry': 'code_expires_at' },
        ExpressionAttributeValues: { ':group': groupId, ':linked': linkedAt } } },
      { Put: { TableName: tableName(), Item: group } },
      { Delete: { TableName: tableName(), Key: { record_key: link.record_key } } },
    ] }));
  } else {
    const data = readLocal(); trip.group_id = groupId; trip.linked_at = linkedAt; delete trip.link_code; delete trip.code_expires_at;
    data[trip.record_key] = trip; data[group.record_key] = group; delete data[link.record_key]; writeLocal(data);
  }
  return { ...trip, group_id: groupId, linked_at: linkedAt };
}

export async function getTripByGroup(groupId) {
  const group = await get(`GROUP#${groupId}`);
  return group ? getTrip(group.trip_id) : null;
}

export async function unlinkGroup(groupId) {
  const trip = await getTripByGroup(groupId);
  if (!trip) return false;
  if (useDynamo()) {
    await ddb.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: tableName(), Key: { record_key: trip.record_key },
        UpdateExpression: 'REMOVE #group SET #updated = :updated',
        ExpressionAttributeNames: { '#group': 'group_id', '#updated': 'updated_at' },
        ExpressionAttributeValues: { ':updated': iso() } } },
      { Delete: { TableName: tableName(), Key: { record_key: `GROUP#${groupId}` } } },
    ] }));
  } else { delete trip.group_id; await put(trip); await remove(`GROUP#${groupId}`); }
  return true;
}

function compactOptions(options) {
  return (options || []).slice(0, 3).map((option, index) => ({
    key: String(option.key || String.fromCharCode(65 + index)).slice(0, 4),
    title: String(option.title || `ทางเลือก ${index + 1}`).slice(0, 120),
    head: String(option.head || '').slice(0, 300),
    line: String(option.line || '').slice(0, 1000),
    places: (option.places || option.candidates || []).slice(0, 3).map(place => ({
      name: String(place.name || place.n || '').slice(0, 120),
      photo: place.photo?.url || null,
    })),
  }));
}

export async function startVote(tripId, token, { options, voteReason, deadlineMinutes = 120 }) {
  const trip = await getOrganizerTrip(tripId, token);
  if (!trip.group_id) throw new AgentError('bad_request', 'ทริปนี้ยังไม่ได้เชื่อมกลุ่ม LINE');
  const vote = {
    id: randomUUID(),
    status: 'OPEN',
    reason: String(voteReason || '').slice(0, 500),
    options: compactOptions(options),
    ballots: {},
    created_at: iso(),
    deadline: new Date(Date.now() + Math.min(1440, Math.max(5, Number(deadlineMinutes) || 120)) * 60000).toISOString(),
  };
  if (!vote.options.length) throw new AgentError('bad_request', 'ไม่มีตัวเลือกสำหรับโหวต');
  if (useDynamo()) {
    await ddb.send(new UpdateCommand({ TableName: tableName(), Key: { record_key: trip.record_key },
      UpdateExpression: 'SET #vote = :vote, #updated = :updated',
      ExpressionAttributeNames: { '#vote': 'vote', '#updated': 'updated_at' },
      ExpressionAttributeValues: { ':vote': vote, ':updated': iso() } }));
  } else { trip.vote = vote; trip.updated_at = iso(); await put(trip); }
  return vote;
}

function winner(vote, organizerChoice) {
  if (organizerChoice && vote.options.some(option => option.key === organizerChoice)) return { winner: organizerChoice, tie: false };
  const tally = {};
  for (const ballot of Object.values(vote.ballots || {})) tally[ballot.option] = (tally[ballot.option] || 0) + 1;
  const high = Math.max(0, ...Object.values(tally));
  const top = Object.entries(tally).filter(([, count]) => count === high).map(([key]) => key);
  return { winner: top.length === 1 ? top[0] : null, tie: top.length !== 1, tally };
}

async function saveVote(trip, vote) {
  if (useDynamo()) {
    await ddb.send(new UpdateCommand({ TableName: tableName(), Key: { record_key: trip.record_key },
      UpdateExpression: 'SET #vote = :vote, #updated = :updated',
      ExpressionAttributeNames: { '#vote': 'vote', '#updated': 'updated_at' },
      ExpressionAttributeValues: { ':vote': vote, ':updated': iso() } }));
  } else { trip.vote = vote; trip.updated_at = iso(); await put(trip); }
}

export async function closeVote(trip, organizerChoice = null) {
  const vote = trip.vote;
  if (!vote) throw new AgentError('bad_request', 'ยังไม่มีการโหวต');
  if (vote.status === 'CLOSED') return vote;
  const result = winner(vote, organizerChoice);
  vote.tally = result.tally || vote.tally || {};
  vote.closed_at = iso();
  vote.winner = result.winner;
  vote.status = result.tie && !organizerChoice ? 'TIE' : 'CLOSED';
  await saveVote(trip, vote);
  return vote;
}

const normalizedName = value => String(value || '').trim().toLocaleLowerCase('th-TH');
function memberFor(trip, userId, displayName) {
  return (trip.members || []).find(member => member.lineUserId === userId)
    || (trip.members || []).find(member => normalizedName(member.name) === normalizedName(displayName))
    || null;
}

export async function recordBallot({ tripId, groupId, voteId, option, userId, displayName }) {
  const trip = tripId ? await getTrip(tripId) : await getTripByGroup(groupId);
  if (!trip?.vote || trip.vote.id !== voteId || !trip.vote.options.some(item => item.key === option)) throw new AgentError('bad_request', 'การโหวตนี้ไม่ถูกต้องหรือปิดแล้ว');
  if (trip.vote.status !== 'OPEN') return trip.vote;
  const member = memberFor(trip, userId, displayName);
  const ballot = { option, memberId: member?.id || null, displayName: String(displayName || 'ไม่ระบุ').slice(0, 120), at: iso() };
  if (useDynamo()) {
    const updated = await ddb.send(new UpdateCommand({ TableName: tableName(), Key: { record_key: trip.record_key },
      UpdateExpression: 'SET #vote.#ballots.#user = :ballot, #updated = :updated',
      ConditionExpression: '#vote.#id = :voteId AND #vote.#status = :open',
      ExpressionAttributeNames: { '#vote': 'vote', '#ballots': 'ballots', '#user': userId, '#id': 'id', '#status': 'status', '#updated': 'updated_at' },
      ExpressionAttributeValues: { ':ballot': ballot, ':voteId': voteId, ':open': 'OPEN', ':updated': iso() },
      ReturnValues: 'ALL_NEW' }));
    Object.assign(trip, updated.Attributes || {});
  } else { trip.vote.ballots[userId] = ballot; await put(trip); }
  const votedMembers = new Set(Object.values(trip.vote.ballots || {}).map(item => item.memberId).filter(Boolean));
  if ((trip.members || []).length && (trip.members || []).every(member => votedMembers.has(member.id))) return closeVote(trip);
  if (Date.parse(trip.vote.deadline) <= Date.now()) return closeVote(trip);
  return trip.vote;
}

export async function getVote(tripId, token) {
  const trip = await getOrganizerTrip(tripId, token);
  if (trip.vote?.status === 'OPEN' && Date.parse(trip.vote.deadline) <= Date.now()) await closeVote(trip);
  return trip.vote || null;
}

export async function closeOrganizerVote(tripId, token, option) {
  const trip = await getOrganizerTrip(tripId, token);
  return closeVote(trip, option);
}

export async function linkIdentity(tripId, lineUserId, memberId, displayName) {
  const trip = await getTrip(tripId);
  if (!trip) throw new AgentError('bad_request', 'ไม่พบทริปนี้');
  const current = (trip.members || []).find(member => member.lineUserId === lineUserId);
  if (current && current.id !== memberId) throw new AgentError('bad_request', 'บัญชี LINE นี้เลือกสมาชิกของทริปไปแล้ว');
  const target = (trip.members || []).find(member => member.id === memberId);
  if (!target) throw new AgentError('bad_request', 'ไม่พบสมาชิกที่เลือก');
  if (target.lineUserId && target.lineUserId !== lineUserId) throw new AgentError('bad_request', 'สมาชิกคนนี้เชื่อมกับบัญชี LINE อื่นแล้ว');
  const members = (trip.members || []).map(member => member.id === memberId
    ? { ...member, lineUserId, lineDisplayName: String(displayName || '').slice(0, 120) }
    : member);
  if (useDynamo()) {
    await ddb.send(new UpdateCommand({ TableName: tableName(), Key: { record_key: trip.record_key },
      UpdateExpression: 'SET #members = :members, #updated = :updated',
      ExpressionAttributeNames: { '#members': 'members', '#updated': 'updated_at' },
      ExpressionAttributeValues: { ':members': members, ':updated': iso() } }));
  } else { trip.members = members; await put(trip); }
  return publicTrip({ ...trip, members });
}

export async function claimWebhookEvent(eventId) {
  if (!eventId) return true;
  const item = { record_key: `LINE_EVENT#${eventId}`, record_type: 'LINE_EVENT', expires_at: nowSeconds() + 86400 };
  try { await put(item, true); return true; }
  catch (error) { if (conditional(error)) return false; throw error; }
}

export async function releaseWebhookEvent(eventId) {
  if (eventId) await remove(`LINE_EVENT#${eventId}`);
}

export async function consumeLinePush(cap = 200) {
  const month = new Date().toISOString().slice(0, 7);
  const key = `LINE_QUOTA#${month}`;
  const expiresAt = nowSeconds() + 40 * 86400;
  if (useDynamo()) {
    try {
      await ddb.send(new UpdateCommand({ TableName: tableName(), Key: { record_key: key },
        UpdateExpression: 'ADD #count :one SET #type = :type, #expires = :expires',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :cap',
        ExpressionAttributeNames: { '#count': 'push_count', '#type': 'record_type', '#expires': 'expires_at' },
        ExpressionAttributeValues: { ':one': 1, ':cap': Number(cap), ':type': 'LINE_QUOTA', ':expires': expiresAt } }));
      return true;
    } catch (error) { if (conditional(error)) return false; throw error; }
  }
  const data = readLocal(); const item = data[key] || { record_key: key, push_count: 0, expires_at: expiresAt };
  if (item.push_count >= Number(cap)) return false;
  item.push_count++; data[key] = item; writeLocal(data); return true;
}

export async function deleteTrip(tripId, token) {
  const trip = await getOrganizerTrip(tripId, token);
  if (useDynamo()) {
    const items = [{ Delete: { TableName: tableName(), Key: { record_key: trip.record_key } } }];
    if (trip.group_id) items.push({ Delete: { TableName: tableName(), Key: { record_key: `GROUP#${trip.group_id}` } } });
    if (trip.link_code) items.push({ Delete: { TableName: tableName(), Key: { record_key: `LINK#${trip.link_code}` } } });
    await ddb.send(new TransactWriteCommand({ TransactItems: items }));
  } else {
    await remove(trip.record_key);
    if (trip.group_id) await remove(`GROUP#${trip.group_id}`);
    if (trip.link_code) await remove(`LINK#${trip.link_code}`);
  }
  return true;
}
