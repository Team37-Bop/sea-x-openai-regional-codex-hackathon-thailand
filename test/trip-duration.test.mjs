import assert from 'node:assert/strict';
import test from 'node:test';
import { requestedTripDays } from '../server/trip-duration.mjs';

process.env.BOP_FAKE_LLM = '1';
const { demoSetup } = await import('../server/http.mjs');
const { planTrip, replan } = await import('../server/plan.mjs');
const ctx = () => ({ signal: new AbortController().signal, step() {}, emit() {}, usage: {} });

test('duration commands distinguish relative changes, totals, Thai numerals and unrelated edits', () => {
  for (const [text, expected] of [
    ['เพิ่มวันเที่ยวอีก ๒ วัน', 5], ['ต่อทริปอีกวัน', 4], ['ลดทริปลงหนึ่งวัน', 2],
    ['ขอเพิ่มเป็น ๕ วัน', 5], ['อยากลดเหลือ 2 วัน', 2], ['ปรับทริปเป็น 4 วัน', 4],
    ['เปลี่ยนทริปจาก 3 วันเป็น 6 วัน', 6], ['ไม่อยากให้เพิ่มอีกวัน', null],
    ['add another day', 4], ['extend the trip by two days', 5], ['shorten the trip to two days', 2],
    ['เพิ่มอีกร้านในวันที่ 2', null], ['ไม่ต้องเพิ่มอีก 2 วัน', null], ['เลื่อนเที่ยวบินขากลับ 1 วัน', null],
  ]) assert.equal(requestedTripDays(text, 3), expected, text);
});

test('extending the bundled itinerary preserves earlier days, moves the return, and checks every dated day', async () => {
  const { plan } = await planTrip(demoSetup('2026-12-29'), ctx(), true);
  const saved = structuredClone(plan);
  const result = await replan({ plan, command: 'เพิ่มอีก 2 วัน', demo: true }, ctx());
  const candidate = result.options[0].plan;
  assert.deepEqual(structuredClone(plan), saved);
  assert.equal(candidate.setup.startDate, '2026-12-30');
  assert.equal(candidate.setup.endDate, '2027-01-03');
  assert.equal(candidate.setup.days, 5);
  assert.deepEqual(candidate.days.map((d) => d.date), [
    '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
  ]);
  assert.deepEqual(candidate.days[0], saved.days[0]);
  const returning = saved.days.at(-1).stops.at(-1).id;
  assert.equal(candidate.days.at(-1).stops.at(-1).id, returning);
  const stops = candidate.days.flatMap((d) => d.stops);
  assert.equal(new Set(stops.map((s) => s.id)).size, stops.length);
  for (const day of candidate.days.slice(3)) {
    assert.ok(day.stops.some((s) => !['hotel', 'transit'].includes(s.kind)));
    for (const [i, s] of day.stops.entries()) {
      assert.ok(s.ll.every(Number.isFinite));
      if (i) assert.ok(result.routes[s.leg.key].geom.length >= 2);
    }
  }
  assert.equal(candidate.report.ds.length, 5);
  assert.equal(candidate.setup.stayPlan.length, 5);
  assert.ok(!saved.days.flatMap((d) => d.stops).some((s) => s.name === candidate.days[3].stops[0].name));
});

test('a one-day alternative drops expired return offers but the original remains bookable for its original date', async () => {
  const { plan } = await planTrip(demoSetup('2026-11-20'), ctx(), true);
  const choice = { id: 'flight', by: 'flight', carrier: 'Air', dep: '20:30', arr: '22:00', checked: 'live',
    offerId: 'off_abc', bookable: true };
  plan.setup.depart.choice = choice;
  plan.flags.transport.back = { chosen: 'flight', chosenOption: choice, options: [choice] };
  const result = await replan({ plan, command: 'ลดเหลือหนึ่งวัน', demo: true }, ctx());
  const [shorter, kept] = result.options.map((row) => row.plan);
  assert.equal(shorter.days.length, 1);
  assert.equal(shorter.setup.startDate, shorter.setup.endDate);
  assert.equal(shorter.setup.depart.choice, undefined);
  assert.equal(shorter.flags.transport.back, undefined);
  assert.equal(shorter.days[0].stops.at(-1).id, plan.days.at(-1).stops.at(-1).id);
  assert.equal(kept.setup.depart.choice.offerId, choice.offerId);
  assert.equal(kept.flags.transport.back.chosenOption.offerId, choice.offerId);
});

test('shortening offers the original itinerary when a removed day holds a confirmed booking or wish', async () => {
  const draft = demoSetup('2026-11-20');
  draft.stay = { mode: 'booked', stays: [{ name: 'ที่พักเดิม', nights: 2, ll: draft.cityLL }] };
  const { plan } = await planTrip(draft, ctx(), true);
  const wish = plan.days[2].stops.find((s) => s.kind === 'food');
  wish.res = { done: true };
  wish.star = draft.members[0].id;
  const old = structuredClone(plan);
  const result = await replan({ plan, command: 'ลดเหลือ 2 วัน', demo: true }, ctx());
  assert.equal(result.needs_vote, true);
  assert.ok(result.vote_reason.includes(wish.n));
  assert.deepEqual(structuredClone(plan), old);
  const [shorter, keep] = result.options.map((o) => o.plan);
  assert.equal(shorter.days.length, 2);
  assert.equal(shorter.setup.endDate, '2026-11-22');
  assert.equal(shorter.setup.stay.stays[0].nights, 1);
  assert.equal(shorter.flags.stay.stays[0].checkOut, shorter.setup.endDate);
  assert.deepEqual(keep.days, old.days);
  assert.equal(keep.setup.endDate, old.setup.endDate);
  for (const command of ['เพิ่มอีก 5 วัน', 'ลด 3 วัน', 'ปรับเป็น 1.5 วัน'])
    await assert.rejects(replan({ plan, command, demo: true }, ctx()), { code: 'bad_request' });
});

test('adding the first night schedules and charges the recommended stay, including after a round trip to one day', async () => {
  const draft = demoSetup('2026-11-20');
  draft.days = 1;
  draft.endDate = draft.startDate;
  const { plan } = await planTrip(draft, ctx(), true);
  const hotel = { name: 'Hotel A', ll: draft.cityLL, priceNight: 2400 };
  plan.flags.stay.examples = [hotel];
  let dayTrip = plan;
  for (let pass = 0; pass < 2; pass++) {
    const result = await replan({ plan: dayTrip, command: 'เพิ่มอีกหนึ่งวัน', demo: true }, ctx());
    const overnight = result.options[0].plan;
    const stay = overnight.flags.stay.stays[0];
    assert.equal(stay.name, hotel.name);
    assert.equal(stay.nights, 1);
    assert.equal(stay.checkIn, overnight.setup.startDate);
    assert.equal(stay.checkOut, overnight.setup.endDate);
    assert.equal(stay.cost, 1200);
    const checkIn = overnight.days[0].stops.at(-1);
    assert.equal(checkIn.name, hotel.name);
    assert.equal(checkIn.cost, 1200);
    const checkOut = overnight.days[1].stops[0];
    assert.equal(checkOut.name, hotel.name);
    assert.equal(checkOut.cost, 0);
    const total = overnight.days.flatMap((d) => d.stops).reduce((sum, s) => sum + s.cost + (s.leg?.cost || 0), 0);
    assert.equal(overnight.report.total, total);
    assert.equal(result.needs_vote, true);
    const shortened = await replan({ plan: overnight, command: 'ลดเหลือหนึ่งวัน', demo: true }, ctx());
    dayTrip = shortened.options[0].plan;
    assert.deepEqual(dayTrip.flags.stay.stays, []);
    assert.equal(dayTrip.days[0].stops.some((s) => s.name === hotel.name), false);
  }
});

test('ending a trip on a former hotel move day replaces its transfer note with final checkout', async () => {
  const draft = demoSetup('2026-11-20');
  draft.days = 4;
  draft.endDate = '2026-11-24';
  draft.stay = { mode: 'booked', stays: [
    { name: 'Hotel A', nights: 2, ll: draft.cityLL },
    { name: 'Hotel B', nights: 1, ll: [18.75, 98.91] },
  ] };
  const { plan } = await planTrip(draft, ctx(), true);
  assert.equal(plan.days[2].stops[0].note, 'เช็กเอาต์ ขนกระเป๋าไปHotel B');
  const [shorter, keep] = (await replan({ plan, command: 'ลดเหลือ 3 วัน', demo: true }, ctx())).options;
  assert.deepEqual(shorter.plan.flags.stay.stays.map((s) => s.name), ['Hotel A']);
  assert.equal(shorter.plan.days[2].stops[0].note, 'เช็กเอาต์และนำสัมภาระ');
  assert.equal(keep.plan.days[2].stops[0].note, plan.days[2].stops[0].note);
});
