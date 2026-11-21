import assert from 'node:assert/strict';
import test from 'node:test';
import { checks } from '../server/rules.mjs';
import { presentChecks } from '../web/check-presentation.js';

const setup = { startDate: '2026-11-22', members: [] };
function checkedPlan(stops, trip = setup) {
  const plan = { days: [{ stops }], setup: trip };
  plan.checks = checks(plan, trip).list;
  return plan;
}

test('explains each London conflict using the scheduled visit, closing time and actual dinner', () => {
  const plan = checkedPlan([
    { id: 'lunch', n: 'PizzaExpress', meal: 'lunch', t0: '13:15', t1: '14:15' },
    { id: 'd1_benugo_waterloo', n: 'Benugo — Waterloo Station', t0: '20:08', t1: '20:33',
      days: { hours: { sun: '08:00–20:00' } } },
    { id: 'd1_dinner', name: 'Wahaca Waterloo', start: '20:38', end: '21:53', meal: 'dinner', open: '12:00–21:00' },
  ]);
  const saved = JSON.stringify(plan);
  const [hours, days, meals] = presentChecks(plan);
  assert.equal(hours.issues.length, 2);
  assert.deepEqual(hours.issues.map((i) => i.subject), ['Benugo — Waterloo Station', 'Wahaca Waterloo']);
  assert.match(hours.issues[0].detail, /ถึงหลังปิด 8 นาที.*20:08–20:33.*08:00–20:00/);
  assert.match(hours.issues[1].detail, /จบหลังปิด 53 นาที.*20:38–21:53.*12:00–21:00/);
  assert.deepEqual([hours.pass, days.pass, meals.pass], [false, true, false]);
  assert.equal(meals.issues.length, 1);
  assert.match(meals.issues[0].subject, /มื้อเย็น.*Wahaca Waterloo/);
  assert.match(meals.issues[0].detail, /20:38.*17:30–20:30.*8 นาที/);
  for (const issue of [...hours.issues, ...meals.issues]) {
    assert.match(issue.when, /22 พ\.ย\./);
    assert.equal(issue.dayIndex, 0);
    assert.doesNotMatch([issue.subject, issue.when, issue.detail].join(' '), /วันที่ 1|\bid\b|d1_/);
  }
  assert.equal(meals.issues[0].stopId, 'd1_dinner');
  assert.equal(JSON.stringify(plan), saved);
});

test('shows early visits, covers split and overnight hours, and distinguishes an absent meal from an early meal', () => {
  const plan = checkedPlan([
    { id: 'a', name: 'Breakfast', start: '07:30', end: '08:30', open: '08:00–15:00' },
    { id: 'b', n: 'Split', t0: '11:00', t1: '14:00', open: '09:00–12:00, 13:00–15:00' },
    { id: 'c', n: 'Night', t0: '01:30', t1: '03:00', open: '20:00–02:00' },
    { id: 'd', n: 'Dinner', meal: 'dinner', t0: '16:30', t1: '17:10' },
  ]);
  const [hours, , meals] = presentChecks(plan);
  assert.match(hours.issues[0].detail, /ถึงก่อนเปิด 30 นาที/);
  assert.match(hours.issues[1].detail, /11:00–14:00.*09:00–12:00, 13:00–15:00/);
  assert.match(hours.issues[2].detail, /01:30–03:00.*20:00–02:00/);
  assert.equal(meals.issues[0].subject, 'มื้อกลางวัน');
  assert.match(meals.issues[0].detail, /ยังไม่มีมื้อกลางวันในช่วง 11:00–14:00/);
  assert.match(meals.issues[1].detail, /จบ 17:10.*17:30–20:30.*20 นาที/);
});

test('keeps member and closure evidence, strips machine references and preserves unknown reasons', () => {
  const trip = { ...setup, members: [{ id: 'group-a', name: 'ฟ้า', avoid: 'กุ้ง', maxWalkKm: 1, budget: 50 }] };
  const plan = checkedPlan([{
    id: 'internal-stop', n: 'Café (West)', t0: '12:00', t1: '13:00', meal: 'lunch', cost: 100,
    walk: 2, closures: [{ date: '2026-11-22', why: 'ปรับปรุงร้าน' }],
  }], trip);
  plan.checks.push({ label: 'เงื่อนไขอื่น', ok: false, problems: ['ต้องจองล่วงหน้า (รอบบ่าย, id mystery)'] });
  const rows = presentChecks({ days: plan.days, report: { list: plan.checks } }, trip);
  const [food, walk, budget] = rows;
  assert.equal(food.member, 'ฟ้า');
  assert.equal(food.issues[0].subject, 'Café (West)');
  assert.match(food.issues[0].detail, /เมนูที่ทานได้/);
  assert.match(walk.issues[0].detail, /เดินรวม 2.0 กม. \(เกิน 1\)/);
  assert.match(budget.issues[0].detail, /฿100 เกินงบ ฿50/);
  const closure = rows.find((r) => r.label === 'เปิดวันที่ไป').issues[0];
  assert.equal(closure.subject, 'Café (West)');
  assert.match(closure.detail, /ปิดวันที่ 2026-11-22 \(ปรับปรุงร้าน\)/);
  assert.equal(rows.at(-1).issues[0].detail, 'ต้องจองล่วงหน้า (รอบบ่าย)');
});

test('older reports can omit dates or referenced stops without losing the reported failure', () => {
  const legacy = { report: { list: [{ label: 'เวลาเปิด–ปิด', ok: false, problems: [
    'Old venue (วันที่ 2, id stale-key) 15:40–16:10 เปิด 10:00–16:00',
  ] }] } };
  const [check] = presentChecks(legacy);
  assert.equal(check.pass, false);
  assert.deepEqual(check.issues[0], {
    subject: 'Old venue', when: 'วันที่ 2 ของทริป', detail: 'จบหลังปิด 10 นาที · แผน 15:40–16:10 · เปิด 10:00–16:00',
    dayIndex: null, stopId: null,
  });
  assert.deepEqual(presentChecks(null), []);
});
