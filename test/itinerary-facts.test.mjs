import assert from 'node:assert/strict';
import test from 'node:test';
import { visitDate, visitAvailability, stopFacts, legFacts } from '../web/itinerary-facts.js';
import { normalize } from '../server/domain.mjs';
import { schedule } from '../server/schedule.mjs';
import { claudeShapes, openaiShapes } from '../server/model-shapes.mjs';

test('weekdays and recorded closure dates match the actual visit and midnight-crossing hours', () => {
  assert.equal(visitDate({}, 2, { startDate: '2026-12-30' }), '2027-01-01');
  const stop = { days: { only: ['sat', 'sun'], hours: { sat: '19:00–02:00' } },
    closures: [{ date: '2026-11-22', why: 'งานชุมชน' }], t0: '23:30', t1: '01:15' };
  const friday = visitAvailability(stop, '2026-11-20');
  assert.match(friday.reason, /เปิดเฉพาะวันเสาร์\/อาทิตย์/);
  const saturday = visitAvailability(stop, '2026-11-21');
  assert.equal(saturday.reason, '');
  assert.equal(saturday.hours, '19:00–02:00');
  assert.equal(saturday.outsideHours, false);
  assert.equal(visitAvailability({ ...stop, t1: '03:15' }, '2026-11-21').outsideHours, true);
  assert.match(visitAvailability(stop, '2026-11-22').reason, /งานชุมชน/);
  assert.match(visitAvailability({ closedDays: [6] }, '2026-11-21').reason, /ปิดวันเสาร์/);
  assert.equal(visitAvailability({ open: ['08:00–12:00','14:00–18:00'], start: '15:00', end: '15:30' }, '2026-11-21').outsideHours, false);
});

test('meal facts distinguish dietary evidence, walk-in, an existing booking and archived flags', () => {
  const members = [{ name: 'นก', veg: true }, { name: 'ฟ้า', avoid: 'มังสวิรัติ, แพ้ถั่ว' }];
  const meal = { k: 'food', meal: 'dinner', veg: 1, walkin: 1, dress: 1, outdoor: 1 };
  const facts = stopFacts(meal, members).map(([text]) => text);
  assert.ok(facts.includes('ยังไม่ยืนยันเมนูสำหรับฟ้า'));
  for (const text of ['แต่งกายสุภาพ', 'กลางแจ้ง', 'เข้าร้านได้โดยไม่ต้องจอง']) assert.ok(facts.includes(text));
  assert.ok(stopFacts({ ...meal, diet: ['ข้าวกับผัก'] }, members).some(([text]) => text.includes('ตรงข้อจำกัด')));
  assert.ok(!stopFacts(meal, members, { state: 'done' }).some(([text]) => text.includes('ไม่ต้องจอง')));
  assert.deepEqual(stopFacts({ kind: 'museum', walkin: true }), []);
  assert.deepEqual(legFacts({ why: 'ลดการเดิน', breaks: ['จุดพักแรก', { n: 'จุดพักสอง' }] }),
    ['ลดการเดิน', 'แวะพักที่ จุดพักแรก · จุดพักสอง']);
});

test('optional provider facts retain false values and schedule the incoming fare, reason and rests', async () => {
  const input = normalize({ city: 'น่าน', startDate: '2026-11-21', days: 1, members: [{ name: 'บี' }] });
  const raw = { stops: [
    { id: 'a', name: 'จุดแรก', kind: 'sight', ll: [18.77,100.77], start: '10:00', end: '10:30' },
    { id: 'b', name: 'จุดถัดไป', kind: 'food', ll: [18.78,100.78], start: '12:00', end: '12:30',
      legCost: 80, visitFacts: { walkin: false, dress: true, legWhy: 'ลดการเดิน', restStops: ['จุดพักแรก'] } },
  ] };
  const { day } = await schedule(raw, 0, input, { signal: new AbortController().signal }, [], new Set(), { offline: true });
  const [first, second] = day.stops;
  assert.equal(first.walkin, undefined);
  assert.equal(second.walkin, false);
  assert.equal(second.dress, true);
  assert.equal(second.leg.cost, 80);
  assert.deepEqual(legFacts(second.leg), ['ลดการเดิน', 'แวะพักที่ จุดพักแรก']);
  assert.equal(second.visitFacts, undefined);
  const compact = claudeShapes.design.properties.days.items.properties.stops.items;
  assert.ok(compact.properties.visitFacts && !compact.required.includes('visitFacts'));
  const strict = openaiShapes.design.properties.days.items.properties.stops.items.properties.visitFacts;
  assert.ok(strict.anyOf.some((branch) => branch.type === 'null'));
});
