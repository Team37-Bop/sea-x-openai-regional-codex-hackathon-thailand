import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const day = 86400;
export const failure = (code, message) => Object.assign(new Error(message), { code });
const now = () => Math.floor(Date.now() / 1000);
const table = () => process.env.BOP_NO_STORE !== '1' && process.env.BOP_STATE_TABLE;
const file = () =>
  process.env.BOP_TRIP_STORE_FILE || fileURLToPath(new URL('./.data/trips.json', import.meta.url));
const conflict = (err) =>
  err.name === 'ConditionalCheckFailedException' ||
  (err.name === 'TransactionCanceledException' &&
    err.CancellationReasons?.some((row) =>
      ['ConditionalCheckFailed', 'TransactionConflict'].includes(row.Code),
    ));
let sdk;
async function execute(command, input) {
  sdk ??= Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/lib-dynamodb')]).then(
    ([base, lib]) => ({
      client: lib.DynamoDBDocumentClient.from(new base.DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      }),
      lib,
    }),
  );
  const { client, lib } = await sdk;
  return client.send(new lib[command + 'Command'](input));
}

// Serializing the whole read/modify/rename prevents lost changes between local requests.
let pending = Promise.resolve();
function local(edit, write = true) {
  const path = file();
  const run = pending.then(async () => {
    let rows;
    try {
      rows = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      rows = {};
    }
    const result = edit(rows);
    if (write) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(tmp, JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
        await rename(tmp, path);
      } finally {
        await unlink(tmp).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
    return result;
  });
  pending = run.catch(() => {});
  return run;
}
const key = (record_key) => ({ record_key });
const mustBeNew = 'attribute_not_exists(record_key)';
const versionCheck = { ConditionExpression: '#rev = :rev', ExpressionAttributeNames: { '#rev': 'revision' } };
const tripKey = (id) => 'TRIP#' + id;
const linkKey = (id) => 'LINK#' + id;
const groupKey = (id) => 'GROUP#' + id;

export function createOperationStore(send = execute) {
  const command = (name, data) => send(name, { TableName: table(), ...data });
  const get = async (record_key) =>
    table()
      ? (await command('Get', { Key: key(record_key), ConsistentRead: true })).Item
      : local((rows) => rows[record_key], false);
  const getTrip = (id) => get(tripKey(id));
  const transaction = (TransactItems) =>
    send('TransactWrite', {
      TransactItems: TransactItems.map(([op, data]) => ({ [op]: { TableName: table(), ...data } })),
    });
  async function createTrip(trip) {
    const item = { ...trip, ...key(tripKey(trip.tripId)), revision: 1 };
    const link = { ...key(linkKey(trip.linkCode)), tripId: trip.tripId, expires_at: trip.codeExpiresAt };
    if (table()) {
      try {
        await transaction([item, link].map((Item) => ['Put', { Item, ConditionExpression: mustBeNew }]));
        return true;
      } catch (err) {
        if (conflict(err)) return false;
        throw err;
      }
    }
    return local((rows) => {
      if (rows[item.record_key] || rows[link.record_key]) return false;
      rows[item.record_key] = item;
      rows[link.record_key] = link;
      return true;
    });
  }
  async function mutateTrip(id, update) {
    const pk = tripKey(id);
    function apply(current) {
      if (!current) return;
      const next = update(structuredClone(current));
      if (next) next.revision = current.revision + 1;
      return next;
    }
    if (!table())
      return local((rows) => {
        const next = apply(rows[pk]);
        if (next) rows[pk] = next;
        return rows[pk];
      });
    for (let i = 0; i < 12; i++) {
      const current = await get(pk);
      const next = apply(current);
      if (!next) return current;
      try {
        await command('Put', {
          Item: next,
          ...versionCheck,
          ExpressionAttributeValues: { ':rev': current.revision },
        });
        return next;
      } catch (err) {
        if (!conflict(err)) throw err;
      }
    }
    throw failure('rate_limit', 'ทริปกำลังมีการแก้ไข กรุณาลองใหม่');
  }
  async function linkGroup(code, groupId) {
    const lookup = await get(linkKey(code));
    if (!lookup || lookup.expires_at <= now()) return;
    const trip = await getTrip(lookup.tripId);
    if (!trip || trip.linkCode !== code || trip.groupId) return;
    const item = { ...trip, groupId, linkedAt: new Date().toISOString(), revision: trip.revision + 1 };
    delete item.linkCode;
    delete item.codeExpiresAt;
    const mapping = { ...key(groupKey(groupId)), tripId: trip.tripId, expires_at: trip.expires_at };
    if (table()) {
      try {
        await transaction([
          ['Put', { Item: item, ...versionCheck, ExpressionAttributeValues: { ':rev': trip.revision } }],
          ['Put', { Item: mapping, ConditionExpression: mustBeNew }],
          [
            'Delete',
            {
              Key: key(linkKey(code)),
              ConditionExpression: 'tripId = :id AND expires_at > :now',
              ExpressionAttributeValues: { ':id': trip.tripId, ':now': now() },
            },
          ],
        ]);
        return item;
      } catch (err) {
        if (!conflict(err)) throw err;
      }
    } else
      return local((rows) => {
        if (
          rows[trip.record_key]?.revision !== trip.revision ||
          !rows[lookup.record_key] ||
          rows[lookup.record_key].expires_at <= now() ||
          rows[mapping.record_key]
        )
          return;
        rows[item.record_key] = item;
        rows[mapping.record_key] = mapping;
        delete rows[lookup.record_key];
        return item;
      });
  }
  const groupTrip = async (groupId) => {
    const row = await get(groupKey(groupId));
    if (!row) return;
    const trip = await getTrip(row.tripId);
    return trip?.groupId === groupId ? trip : undefined;
  };
  async function remove(id, deleting, groupId) {
    for (let retry = 0; retry < 12; retry++) {
      const trip = await getTrip(id);
      if (!trip || (!deleting && trip.groupId !== groupId)) return;
      const lookups = [
        trip.groupId && groupKey(trip.groupId),
        deleting && trip.linkCode && linkKey(trip.linkCode),
      ].filter(Boolean);
      const updated = { ...trip, revision: trip.revision + 1 };
      delete updated.groupId;
      delete updated.linkedAt;
      if (table()) {
        const args = { ...versionCheck, ExpressionAttributeValues: { ':rev': trip.revision } };
        try {
          await transaction([
            deleting
              ? ['Delete', { Key: key(trip.record_key), ...args }]
              : ['Put', { Item: updated, ...args }],
            ...lookups.map((pk) => [
              'Delete',
              {
                Key: key(pk),
                ConditionExpression: 'attribute_not_exists(record_key) OR tripId = :id',
                ExpressionAttributeValues: { ':id': id },
              },
            ]),
          ]);
          return;
        } catch (err) {
          if (!conflict(err)) throw err;
        }
      } else if (
        await local((rows) => {
          if (rows[trip.record_key]?.revision !== trip.revision) return false;
          if (deleting) delete rows[trip.record_key];
          else rows[trip.record_key] = updated;
          for (const pk of lookups) if (rows[pk]?.tripId === id) delete rows[pk];
          return true;
        })
      )
        return;
    }
    throw failure('rate_limit', 'ทริปกำลังมีการแก้ไข กรุณาลองใหม่');
  }
  async function putBallot(trip, userId, ballot) {
    if (!table())
      return local((rows) => {
        const active = rows[trip.record_key];
        if (
          !active ||
          active.vote?.id !== trip.vote.id ||
          active.vote.status !== 'OPEN' ||
          active.revision !== trip.revision
        )
          return;
        active.vote.ballots[userId] = ballot;
        active.revision++;
        return active;
      });
    try {
      return (
        await command('Update', {
          Key: key(trip.record_key),
          UpdateExpression: 'SET #v.#b.#user = :ballot ADD #rev :one',
          ConditionExpression: '#v.#id = :id AND #v.#st = :open AND #rev = :revision',
          ReturnValues: 'ALL_NEW',
          ExpressionAttributeNames: {
            '#v': 'vote',
            '#b': 'ballots',
            '#user': userId,
            '#id': 'id',
            '#st': 'status',
            '#rev': 'revision',
          },
          ExpressionAttributeValues: {
            ':ballot': ballot,
            ':id': trip.vote.id,
            ':open': 'OPEN',
            ':one': 1,
            ':revision': trip.revision,
          },
        })
      ).Attributes;
    } catch (err) {
      if (!conflict(err)) throw err;
    }
  }
  async function claimEvent(id) {
    if (!id) return true;
    const pk = 'LINE_EVENT#' + id;
    const Item = { ...key(pk), expires_at: now() + day };
    if (!table())
      return local((rows) => {
        if (rows[pk]?.expires_at > now()) return false;
        rows[pk] = Item;
        return true;
      });
    try {
      await command('Put', {
        Item,
        ConditionExpression: mustBeNew + ' OR expires_at <= :now',
        ExpressionAttributeValues: { ':now': now() },
      });
      return true;
    } catch (err) {
      if (conflict(err)) return false;
      throw err;
    }
  }
  async function releaseEvent(id) {
    if (!id) return;
    const pk = 'LINE_EVENT#' + id;
    if (table()) await command('Delete', { Key: key(pk) });
    else
      await local((rows) => {
        delete rows[pk];
      });
  }
  async function consumePush(retryKey) {
    const configured = Number(process.env.BOP_LINE_MONTHLY_CAP ?? 200);
    const cap = Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 200;
    if (!cap) return false;
    const pk = 'LINE_QUOTA#' + new Date().toISOString().slice(0, 7);
    const started = now();
    const ttl = started + 40 * day;
    const receipt = retryKey && { ...key('LINE_PUSH#' + retryKey), expires_at: started + day };
    if (!table())
      return local((rows) => {
        if (receipt) {
          if (rows[receipt.record_key]?.expires_at > started) return true;
          for (const [id, row] of Object.entries(rows))
            if (id.startsWith('LINE_PUSH#') && row.expires_at <= started) delete rows[id];
        }
        const usage = (rows[pk] ??= { ...key(pk), count: 0, expires_at: ttl });
        if (usage.count >= cap) return false;
        usage.count++;
        if (receipt) rows[receipt.record_key] = receipt;
        return true;
      });
    const increment = {
      Key: key(pk),
      UpdateExpression: 'SET expires_at = :ttl ADD #c :one',
      ConditionExpression: 'attribute_not_exists(#c) OR #c < :cap',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':cap': cap, ':one': 1, ':ttl': ttl },
    };
    if (receipt) {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          await transaction([
            ['Put', { Item: receipt, ConditionExpression: mustBeNew + ' OR expires_at <= :now',
              ExpressionAttributeValues: { ':now': started } }],
            ['Update', increment],
          ]);
          return true;
        } catch (err) {
          const missingReasons = err.name === 'TransactionCanceledException' && !err.CancellationReasons?.length;
          if (!conflict(err) && !missingReasons) throw err;
          const capped = missingReasons
            ? (await get(pk))?.count >= cap
            : err.CancellationReasons?.[1]?.Code === 'ConditionalCheckFailed';
          // A concurrent attempt may have won this last slot for the very same message.
          if ((await get(receipt.record_key))?.expires_at > now()) return true;
          if (capped) return false;
        }
      }
      throw failure('rate_limit', 'กำลังตรวจสอบโควตา LINE กรุณาลองใหม่');
    }
    try {
      await command('Update', increment);
      return true;
    } catch (err) {
      if (conflict(err)) return false;
      throw err;
    }
  }
  const opKey = (id) => key('IDEMPOTENCY#' + id);
  async function acquireOperation(id, body) {
    if (!table()) return { persisted: false };
    if (typeof id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))
      throw failure('bad_request', 'กรุณาระบุรหัสยืนยันการทำรายการ');
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    try {
      await command('Put', {
        Item: {
          ...opKey(id),
          hash,
          status: 'IN_PROGRESS',
          createdAt: new Date().toISOString(),
          expires_at: now() + day,
        },
        ConditionExpression: mustBeNew,
      });
      return { persisted: true };
    } catch (err) {
      if (!conflict(err)) throw err;
    }
    const current = await get(opKey(id).record_key);
    if (current && current.hash !== hash) throw failure('bad_request', 'รหัสนี้ใช้กับรายการอื่นแล้ว');
    if (current?.status === 'COMPLETE') return { persisted: true, replay: current.response };
    throw failure('rate_limit', 'กำลังตรวจสอบผลรายการเดิม กรุณารอสักครู่');
  }
  const active = {
    ConditionExpression: '#s = :active',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':active': 'IN_PROGRESS' },
  };
  const releaseOperation = (id) => table() && command('Delete', { Key: opKey(id), ...active });
  async function finishOperation(id, status, fields) {
    if (!table()) return;
    const names = { ...active.ExpressionAttributeNames };
    const values = { ...active.ExpressionAttributeValues, ':end': status };
    const parts = ['#s = :end'];
    for (const [k, v] of Object.entries(fields)) {
      names['#' + k] = k;
      values[':' + k] = v;
      parts.push('#' + k + ' = :' + k);
    }
    await command('Update', {
      Key: opKey(id),
      ...active,
      UpdateExpression: 'SET ' + parts.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    });
  }
  async function auditOrder(order) {
    if (!table()) return;
    const days = Math.max(1, Number.parseInt(process.env.BOP_STATE_RETENTION_DAYS ?? '90', 10) || 1);
    const item = { ...key('ORDER#' + order.orderId), expires_at: now() + days * day };
    for (const field of [
      'orderId',
      'bookingReference',
      'offerId',
      'mode',
      'type',
      'total',
      'currency',
      'createdAt',
      'payBy',
    ]) {
      if (order[field] != null) item[field] = order[field];
    }
    try {
      await command('Put', { Item: item, ConditionExpression: mustBeNew });
    } catch (err) {
      if (!conflict(err)) throw err;
    }
  }
  async function auditCancellation(id, confirmedAt) {
    if (!table()) return;
    try {
      await command('Update', {
        Key: key('ORDER#' + id),
        ConditionExpression: 'attribute_exists(record_key)',
        UpdateExpression: 'SET cancelledAt = :at',
        ExpressionAttributeValues: { ':at': confirmedAt },
      });
    } catch (err) {
      if (!conflict(err)) throw err;
    }
  }
  return {
    getTrip,
    groupTrip,
    createTrip,
    mutateTrip,
    linkGroup,
    putBallot,
    unlinkGroup: (id, groupId) => remove(id, false, groupId),
    deleteTrip: (id) => remove(id, true),
    claimEvent,
    releaseEvent,
    consumePush,
    acquireOperation,
    releaseOperation,
    auditOrder,
    auditCancellation,
    completeOperation: (id, response) =>
      finishOperation(id, 'COMPLETE', { response, completedAt: new Date().toISOString() }),
    uncertainOperation: (id, reason) =>
      finishOperation(id, 'UNCERTAIN', { reason: String(reason).slice(0, 300) }),
  };
}
export const operationalStore = createOperationStore();
export const {
  acquireOperation,
  releaseOperation,
  completeOperation,
  uncertainOperation,
  auditOrder,
  auditCancellation,
} = operationalStore;
