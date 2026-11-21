import assert from 'node:assert/strict';
import test from 'node:test';
import { describePlanChange } from '../web/plan-review.js';

test('vote compares changed visits and each incoming fare against the committed itinerary', () => {
  const stop = { id: 'a', n: 'คาเฟ่เดิม', t0: '10:00', t1: '11:00', cost: 120, leg: { cost: 20 } };
  const before = {
    days: [{ date: '2026-12-01', stops: [stop, { id: 'b', name: 'ตลาด', cost: 50 }] }],
    checks: [
      { id: 'old', pass: false },
      { id: 'p/budget', pass: true },
    ],
  };
  const after = {
    days: [
      null,
      {
        date: '2026-12-02',
        stops: [
          { ...stop, n: 'ร้านใหม่', t0: '12:00', cost: 150, leg: { cost: 30 } },
          { id: 'c', name: 'วัด' },
        ],
      },
    ],
    checks: [
      { id: 'old', pass: false },
      { id: 'p/budget', pass: false, member: 'พิม', problems: ['เกินงบ'] },
    ],
  };
  const diff = describePlanChange(before, after);
  assert.deepEqual(
    diff.changes.map(({ id, kinds }) => [id, kinds]),
    [
      ['a', ['renamed', 'retimed', 'price']],
      ['c', ['added']],
      ['b', ['removed']],
    ],
  );
  assert.deepEqual([diff.oldTotal, diff.newTotal, diff.delta], [190, 180, -10]);
  assert.deepEqual(
    diff.newFailures.map(({ id }) => id),
    ['p/budget'],
  );
  assert.equal(diff.changes[0].after.day, 2);
});
