// DynamoDB-backed POC state: booking audit and idempotency records.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const tableName = () => process.env.BOP_STATE_TABLE || '';
const retentionDays = () => Math.max(1, Number(process.env.BOP_STATE_RETENTION_DAYS) || 90);
const ttl = days => Math.floor(Date.now() / 1000) + days * 86400;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const enabled = () => process.env.BOP_NO_STORE !== '1' && !!tableName();
const conditional = error => error?.name === 'ConditionalCheckFailedException';

export async function createOrderRecord(record) {
  if (!enabled()) return false;
  await client.send(new PutCommand({
    TableName: tableName(),
    Item: {
      record_key: `ORDER#${record.orderId}`,
      record_type: 'ORDER',
      expires_at: ttl(retentionDays()),
      ...record,
    },
    ConditionExpression: 'attribute_not_exists(record_key)',
  }));
  return true;
}

export async function updateOrderRecord(orderId, values) {
  if (!enabled()) return false;
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (!entries.length) return false;
  const names = Object.fromEntries(entries.map(([key], index) => [`#f${index}`, key]));
  const attributes = Object.fromEntries(entries.map(([, value], index) => [`:v${index}`, value]));
  await client.send(new UpdateCommand({
    TableName: tableName(),
    Key: { record_key: `ORDER#${orderId}` },
    UpdateExpression: `SET ${entries.map((_, index) => `#f${index} = :v${index}`).join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: attributes,
    ConditionExpression: 'attribute_exists(record_key)',
  }));
  return true;
}

export async function beginIdempotentOperation({ key, requestHash }) {
  if (!enabled()) return { acquired: true, persisted: false };
  const recordKey = `IDEMPOTENCY#${key}`;
  try {
    await client.send(new PutCommand({
      TableName: tableName(),
      Item: {
        record_key: recordKey,
        record_type: 'IDEMPOTENCY',
        request_hash: requestHash,
        status: 'IN_PROGRESS',
        created_at: new Date().toISOString(),
        expires_at: ttl(1),
      },
      ConditionExpression: 'attribute_not_exists(record_key)',
    }));
    return { acquired: true, persisted: true };
  } catch (error) {
    if (!conditional(error)) throw error;
    const result = await client.send(new GetCommand({
      TableName: tableName(),
      Key: { record_key: recordKey },
      ConsistentRead: true,
    }));
    const item = result.Item;
    if (!item || item.request_hash !== requestHash) return { acquired: false, conflict: true };
    if (item.status === 'COMPLETE' && item.response) return { acquired: false, response: item.response };
    return { acquired: false, pending: true };
  }
}

export async function completeIdempotentOperation(key, response) {
  if (!enabled()) return false;
  await client.send(new UpdateCommand({
    TableName: tableName(),
    Key: { record_key: `IDEMPOTENCY#${key}` },
    UpdateExpression: 'SET #status = :complete, #response = :response, #completed = :completed',
    ConditionExpression: '#status = :in_progress',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#response': 'response',
      '#completed': 'completed_at',
    },
    ExpressionAttributeValues: {
      ':complete': 'COMPLETE',
      ':in_progress': 'IN_PROGRESS',
      ':response': response,
      ':completed': new Date().toISOString(),
    },
  }));
  return true;
}

export async function markIdempotentOperationUncertain(key, reason) {
  if (!enabled()) return false;
  await client.send(new UpdateCommand({
    TableName: tableName(),
    Key: { record_key: `IDEMPOTENCY#${key}` },
    UpdateExpression: 'SET #status = :uncertain, #reason = :reason, #updated = :updated',
    ConditionExpression: '#status = :in_progress',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#reason': 'reason',
      '#updated': 'updated_at',
    },
    ExpressionAttributeValues: {
      ':uncertain': 'UNCERTAIN',
      ':in_progress': 'IN_PROGRESS',
      ':reason': String(reason || 'upstream outcome unknown').slice(0, 200),
      ':updated': new Date().toISOString(),
    },
  }));
  return true;
}

export async function releaseIdempotentOperation(key) {
  if (!enabled()) return false;
  await client.send(new DeleteCommand({
    TableName: tableName(),
    Key: { record_key: `IDEMPOTENCY#${key}` },
    ConditionExpression: '#status = :in_progress',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':in_progress': 'IN_PROGRESS' },
  }));
  return true;
}
