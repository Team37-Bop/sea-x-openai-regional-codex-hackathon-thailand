import assert from 'node:assert/strict';
import test from 'node:test';
import { reservationStatus, setReservationDone } from '../web/booking-tasks.js';

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
