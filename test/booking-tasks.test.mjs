import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingReservationMessage, reconcileReservations, reservationStatus, setReservationDone } from '../web/booking-tasks.js';

test('LINE reservation work names the organizer, dates and pending calls, moves and cancellations', () => {
  const state = {
    setup: { members: [{ name: 'เอ' }, { name: 'บี', role: 'organizer' }] },
    plan: { days: [{ date: '2026-12-10', stops: [
      { id: 'a', name: 'ร้านใหม่', start: '12:00', res: { todo: true } },
      { id: 'b', name: 'ร้านเลื่อนเวลา', start: '19:15' },
      { id: 'c', name: 'จองแล้ว', res: { done: true } },
      { id: 'd', name: 'เดินเล่น' },
    ] }] },
    bookings: { b: { state: 'move' } },
    cancellations: [
      { name: 'ร้านที่นำออก', day: '2026-12-09', time: '18:00' },
      { name: 'ยกเลิกแล้ว', handled: true },
    ],
  };
  const text = pendingReservationMessage(state);
  assert.match(text, /งานโทรจองของบี/);
  assert.match(text, /โทรจอง ร้านใหม่ · 10 .*12:00/);
  assert.match(text, /โทรเลื่อน ร้านเลื่อนเวลา · 10 .*19:15/);
  assert.match(text, /โทรยกเลิก ร้านที่นำออก · 9 .*18:00/);
  assert.doesNotMatch(text, /จองแล้ว|ยกเลิกแล้ว|เดินเล่น/);
  assert.equal(pendingReservationMessage({}), '');
});

test('reservation state keeps the date, contact and newly confirmed time for subsequent itinerary edits', () => {
  const stop = {
    id: 'd2-dinner',
    name: 'ร้านอาหาร',
    start: '18:30',
    res: { todo: true, phone: '02-000-0000' },
  };
  const state = { plan: { days: [null, { date: '2026-12-10', stops: [stop] }] }, bookings: {} };
  assert.equal(reservationStatus(state, stop), 'todo');
  setReservationDone(state, stop, true);
  assert.deepEqual(state.bookings[stop.id], {
    state: 'done',
    name: stop.name,
    time: '18:30',
    day: '2026-12-10',
    phone: stop.res.phone,
  });
  state.bookings[stop.id].state = 'move';
  state.bookings[stop.id].next = '19:00';
  stop.start = '19:00';
  assert.equal(reservationStatus(state, stop), 'move');
  setReservationDone(state, stop, true);
  assert.equal(state.bookings[stop.id].time, '19:00');
  assert.equal(reservationStatus(state, stop), 'done');
});

test('a confirmed reservation restored with a plan can return to pending', () => {
  const stop = { id: 'old', name: 'โรงแรม', start: '14:00', res: { done: true, note: 'โทรยืนยันเวลา' } };
  const state = { plan: { days: [{ stops: [stop] }] } };
  assert.equal(reservationStatus(state, stop), 'done');
  setReservationDone(state, stop, false);
  assert.equal(reservationStatus(state, stop), 'todo');
  assert.equal(stop.res.todo, true);
  assert.equal(stop.res.done, false);
  assert.equal(stop.res.note, 'โทรยืนยันเวลา');
});

test('calling script for a pending or moved table uses booking state and organizer details', async () => {
  const { reservationCallScript } = await import('../web/booking-tasks.js');
  const stop = { id: 'a', name: 'ร้าน', start: '18:00', res: { ask: 'ขอที่นั่งด้านใน' } };
  const day = { date: '2026-12-09', stops: [stop] };
  const state = {
    plan: { days: [null, day] },
    setup: {
      members: [
        { name: 'เอ', avoid: 'ถั่ว' },
        { name: 'บี', role: 'organizer', avoid: 'ถั่ว' },
      ],
    },
    bookings: {},
  };
  const pending = reservationCallScript(state, stop, day);
  for (const value of ['2 คน', '18:00', 'บี', 'ถั่ว', 'ขอที่นั่งด้านใน']) assert.ok(pending.includes(value));
  assert.equal(pending.split('ถั่ว').length, 2);
  stop.res.script = 'บทพูดของผู้จัด';
  setReservationDone(state, stop, true);
  assert.equal(state.bookings.a.script, 'บทพูดของผู้จัด');
  state.bookings.a.state = 'move';
  stop.start = '19:15';
  const moved = reservationCallScript(state, stop, day);
  assert.ok(moved.includes('18:00') && moved.includes('19:15'));
});


test('moving a hotel slot keeps the confirmed original reservation as organizer follow-up', () => {
  const original = { id: 'stay', kind: 'hotel', name: 'Original Hotel', start: '15:00',
    res: { done: true, phone: '+44001', script: 'Original Hotel desk' } };
  const same = { id: 'dinner', kind: 'food', name: 'The Grill', start: '18:00', res: { done: true } };
  const oldDay = { date: '2026-12-01', stops: [original, same] };
  const state = { plan: { days: [oldDay] }, bookings: {}, cancellations: [] };
  const hotel = { ...structuredClone(original), name: 'Chosen Hotel' };
  const next = { days: [{ ...oldDay, stops: [hotel, { ...same, start: '19:00' }] }] };
  const changes = reconcileReservations(state, next);
  assert.equal(changes.bookings.stay, undefined);
  assert.equal(reservationStatus(changes, hotel), 'todo');
  assert.deepEqual(changes.cancellations.map(row => [row.name, row.phone, row.time]),
    [['Original Hotel', '+44001', '15:00']]);
  assert.equal(changes.bookings.dinner.state, 'move');
  assert.equal(hotel.res.phone, undefined);
  assert.equal(hotel.res.script, undefined);
  assert.equal(original.res.done, true);
});
