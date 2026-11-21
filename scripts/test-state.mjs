import assert from 'node:assert/strict';

process.env.BOP_NO_STORE = '1';
process.env.BOP_STATE_TABLE = 'must-not-be-called';
const state = await import('../server/state.mjs');

assert.equal(await state.createOrderRecord({ orderId: 'ord_test' }), false);
assert.equal(await state.updateOrderRecord('ord_test', { cancelledAt: 'now' }), false);
assert.deepEqual(await state.beginIdempotentOperation({ key: 'test', requestHash: 'hash' }), { acquired: true, persisted: false });
assert.equal(await state.completeIdempotentOperation('test', {}), false);
assert.equal(await state.markIdempotentOperationUncertain('test', 'test'), false);
assert.equal(await state.releaseIdempotentOperation('test'), false);
console.log('ok   disabled state mode makes no DynamoDB calls');
console.log('all passed');
