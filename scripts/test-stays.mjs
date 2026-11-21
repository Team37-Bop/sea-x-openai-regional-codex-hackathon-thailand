// Unit checks for booked stays that differ by night. Usage: node scripts/test-stays.mjs
// Normalisation (server + client), per-day start/end hotel, pinning and anchoring of hotel stops, prompt lines.
import { bookedStays, dayStays, stayLine, planBrief, buildPlan, schedule, checks, clone, BASE, SAMPLE_SETUP } from '../src/plan.js';
import { normalizeSetup, stayInternals } from '../server/agent.mjs';
import { toSetup, validate, stayRows, addStay, delStay } from '../src/ui/setup.js';
import { toSpec } from '../server/fake-llm.mjs';
import { readFileSync } from 'node:fs';

const { pinStay, anchorStays, stayPlan, pinEditStays } = stayInternals;
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const raw = (stay, days = 4, x = {}) => ({ startDate: '2026-11-20', days, members: [{ id: 'm1', name: 'มิ้น' }], stay, ...x });

/* ---------- normalisation ---------- */
ok(eq(normalizeSetup(raw({ mode: 'booked', name: 'Tamarind Village' })).stay, { mode: 'booked', stays: [{ name: 'Tamarind Village', nights: 3 }] }),
  'old { mode:booked, name } -> one stay covering every night');
ok(eq(normalizeSetup(raw({ mode: 'booked', stays: [{ name: 'A', nights: 2 }, { name: 'B', nights: 1 }] })).stay.stays, [{ name: 'A', nights: 2 }, { name: 'B', nights: 1 }]),
  'stays that add up are kept');
ok(eq(bookedStays({ mode: 'booked', stays: [{ name: 'A', nights: 5 }, { name: 'B', nights: 5 }] }, 4), [{ name: 'A', nights: 3 }]),
  'too many nights: trimmed from the end, empty stays dropped');
ok(eq(bookedStays({ mode: 'booked', stays: [{ name: 'A', nights: 1 }, { name: 'B', nights: 1 }] }, 5), [{ name: 'A', nights: 1 }, { name: 'B', nights: 3 }]),
  'too few nights: the last stay takes the rest');
ok(eq(bookedStays({ mode: 'booked', stays: [{ name: 'A' }, { name: ' ' }, { name: 'B', nights: 'x' }] }, 4), [{ name: 'A', nights: 1 }, { name: 'B', nights: 2 }]),
  'missing nights = 1, blank names dropped');
ok(normalizeSetup(raw({ mode: 'booked', stays: [] })).stay.mode === 'auto' && normalizeSetup(raw({ mode: 'booked', name: '' })).stay.mode === 'auto', 'booked without a name -> auto');
ok(normalizeSetup(raw(undefined)).stay.mode === 'auto', 'no stay -> auto');
ok(eq(normalizeSetup(raw({ mode: 'booked', name: 'Day Inn' }, 1)).stay.stays, [{ name: 'Day Inn', nights: 0 }]), '1-day trip: one stay with 0 nights');
ok(eq(normalizeSetup(raw({ mode: 'booked', stays: [{ name: 'A', nights: 1, lat: 1, lng: 2 }] }, 2)).stay.stays[0], { name: 'A', nights: 1 }), 'client coordinates are dropped (server geocodes)');
ok(eq(normalizeSetup({ ...raw({ mode: 'booked', stays: [{ name: 'A', nights: 1 }, { name: 'B', nights: 2 }] }, 3), endDate: '2026-11-23' }).stay.stays, [{ name: 'A', nights: 1 }, { name: 'B', nights: 2 }]),
  'endDate decides the nights (4 days = 3 nights)');

/* ---------- per-day start / end hotel ---------- */
const S3 = normalizeSetup(raw({ mode: 'booked', stays: [{ name: 'Chiang Mai Inn', nights: 2 }, { name: 'Pai Resort', nights: 1 }] }));
const ds = dayStays(S3).map(d => [d.start && d.start.name, d.end && d.end.name, d.move]);
ok(eq(ds, [[null, 'Chiang Mai Inn', false], ['Chiang Mai Inn', 'Chiang Mai Inn', false], ['Chiang Mai Inn', 'Pai Resort', true], ['Pai Resort', null, false]]),
  '2 nights + 1 night: day1 arrive->A, day2 A->A, day3 A->B (move), day4 B->depart');
ok(eq(dayStays(normalizeSetup(raw({ mode: 'booked', name: 'X' }, 3))).map(d => [d.start && d.start.name, d.end && d.end.name]), [[null, 'X'], ['X', 'X'], ['X', null]]),
  'single stay: every day starts/ends there (as before)');
ok(dayStays(normalizeSetup(raw({ mode: 'booked', name: 'X' }, 1))).every(d => !d.start && !d.end), '1-day trip: no start/end hotel');
ok(dayStays(normalizeSetup(raw(undefined, 3))).every(d => !d.start && !d.end), 'auto mode: no booked start/end');
ok(/เช็กเอาต์/.test(stayLine(S3, 2)) && /Pai Resort/.test(stayLine(S3, 2)) && /ย้ายที่พัก/.test(stayLine(S3, 2)), 'move-day line names both hotels and the check-out');
const sp = stayPlan(S3);
ok(sp.length === 4 && sp[0].startsWith('วัน 1:') && /Pai Resort/.test(sp[3]), 'stayPlan has one line per day for the model');
ok(eq(stayPlan(normalizeSetup(raw(undefined))), []), 'stayPlan empty in auto mode');
ok(/วันย้ายที่พัก/.test(stayInternals.stayRole(S3, 2, 4)) && /Pai Resort/.test(stayInternals.stayRole(S3, 3, 4)), 'day-design role names the day\'s hotels');

/* ---------- pinning + anchoring the model's stops ---------- */
const A = { lat: 18.788, lng: 98.988 }, B = { lat: 19.359, lng: 98.441 };
const G = clone(S3); Object.assign(G.stay.stays[0], A); Object.assign(G.stay.stays[1], B);
const st = (id, n, k, t0, t1, ll, x = {}) => ({ id, n, k, t0, t1, query: n, catalog: '', lat: ll[0], lng: ll[1], mode: 'car', legCost: -1, ...x });
// day 3 (move): the model starts at "โรงแรม" near A, forgets to end at B
const d3 = [st('h', 'โรงแรมเดิม', 'stay', '08:30', '08:30', [18.79, 98.99], { mode: 'none' }), st('lunch', 'ร้านกลางทาง', 'food', '12:00', '13:00', [19.1, 98.7]), st('cafe', 'คาเฟ่ปาย', 'food', '15:00', '16:00', [19.36, 98.44])];
pinStay(d3, G, 2); anchorStays(d3, G, 2);
ok(d3[0].n === 'Chiang Mai Inn' && d3[0].lat === A.lat && /เช็กเอาต์/.test(d3[0].note || ''), 'move day: first hotel stop pinned to the old hotel with a check-out note');
ok(d3[d3.length - 1].n === 'Pai Resort' && d3[d3.length - 1].lat === B.lat && d3[d3.length - 1].t0 === '16:30', 'move day: missing end hotel appended (new hotel, after the last stop)');
// day 2: model forgot the hotel at both ends
const d2 = [st('m', 'ตลาด', 'market', '09:00', '10:00', [18.79, 98.99], { mode: 'none' }), st('t', 'วัด', 'temple', '11:00', '12:00', [18.8, 98.98])];
anchorStays(d2, G, 1);
ok(d2[0].k === 'stay' && d2[0].n === 'Chiang Mai Inn' && d2[0].t0 === '08:40' && d2[1].mode === 'car', 'missing start hotel prepended; old first stop gets a leg');
ok(d2[d2.length - 1].n === 'Chiang Mai Inn', 'same hotel at the end');
// pinning by name wins over position
const d3b = [st('x', 'Pai Resort', 'stay', '09:00', '09:00', [0, 0], { mode: 'none' })];
pinStay(d3b, G, 2);
ok(d3b[0].lat === B.lat, 'name match pins to that hotel even as first stop');
// drive home is never pinned
const home = clone(G); home.arrive = { by: 'drive', from: 'กรุงเทพฯ' };
const d1 = [st('home', 'บ้าน กรุงเทพฯ', 'stay', '06:00', '06:00', [13.75, 100.5], { query: 'กรุงเทพฯ', mode: 'none' })];
pinStay(d1, home, 0);
ok(d1[0].lat === 13.75, 'drive: the home stop is not pinned');
// idempotent
const again = clone(d3); pinStay(again, G, 2); anchorStays(again, G, 2);
ok(again.length === d3.length, 'pin + anchor twice adds nothing');
// first/last day: arrival and departure stay as the model made them
const dl = [st('h3', 'ที่พัก', 'stay', '08:00', '08:00', [19.35, 98.44], { mode: 'none' }), st('air', 'สนามบิน', 'transit', '18:00', '18:00', [18.77, 98.96])];
pinStay(dl, G, 3); anchorStays(dl, G, 3);
ok(dl.length === 2 && dl[0].n === 'Pai Resort' && dl[1].k === 'transit', 'last day: starts at the last hotel, ends at departure (no hotel appended)');
// replan edits: insert a hotel stop on day 3 -> nearest of that day's hotels
const plan = { days: [{ stops: [] }, { stops: [] }, { stops: [{ id: 'q' }] }, { stops: [] }] };
const edits = [{ op: 'insert', day: 2, after: 'q', stop: st('rest', 'ที่พักใหม่', 'stay', '17:00', '17:00', [19.30, 98.45]) }];
pinEditStays(edits, plan, G);
ok(edits[0].stop.lat === B.lat && edits[0].stop.pinned, 'replan insert of a hotel stop pinned to the day\'s nearest booked hotel');

/* ---------- through buildPlan / schedule / checks (sample) ---------- */
const R = JSON.parse(readFileSync(new URL('../src/routes.json', import.meta.url), 'utf8'));
const cm = { ...SAMPLE_SETUP, stay: { mode: 'booked', stays: [{ name: 'บ้านไม้ในเมืองเก่า', nights: 1, lat: 18.7905, lng: 98.9886 }, { name: 'นิมมานเฮาส์', nights: 1, lat: 18.7965, lng: 98.9675 }] } };
const specs = BASE.days.map((d, i) => { const s = d.stops.map(x => toSpec(x)); pinStay(s, cm, i); anchorStays(s, cm, i); return { stops: s }; });
const p = schedule(buildPlan(specs, cm), R);
const first = p.days[1].stops[0], last = p.days[1].stops[p.days[1].stops.length - 1];
ok(first.k === 'stay' && first.ll[0] === 18.7905 && last.k === 'stay' && last.ll[0] === 18.7965, 'sample 3 days: day 2 starts at stay 1 and ends at stay 2');
ok(p.days[2].stops[0].ll[0] === 18.7965 && p.days[0].stops.filter(s => s.k === 'stay').every(s => s.ll[0] === 18.7905), 'day 3 starts at stay 2; day 1 hotel stops are stay 1');
const ck = checks(p, cm);
ok(ck.list.length > 0 && ck.list.every(x => typeof x.ok === 'boolean'), `checks() runs on a multi-stay plan (${ck.pass}/${ck.list.length})`);
ok(/ที่พัก: เริ่มวันจาก บ้านไม้ในเมืองเก่า .*นอนที่ นิมมานเฮาส์/.test(planBrief(p, cm).split('\n').find(l => l.startsWith('วันที่ 2'))), 'planBrief shows the day\'s start/end hotel');
ok(!/ที่พัก:/.test(planBrief(p)), 'planBrief without setup unchanged');
const base = schedule(clone(BASE), R);
ok(checks(base, SAMPLE_SETUP).pass === checks(base, SAMPLE_SETUP).list.length, 'Chiang Mai sample (no stay) still passes every rule');

/* ---------- client draft -> TripSetup, validation ---------- */
const draft = (stay, end = '2026-11-23') => ({ city: 'เชียงใหม่', startDate: '2026-11-20', endDate: end, days: 4, members: [{ id: 'm1', name: 'มิ้น' }], stay });
ok(eq(toSetup(draft({ mode: 'booked', name: 'Old Inn' })).stay, { mode: 'booked', stays: [{ name: 'Old Inn', nights: 3 }] }), 'client: old draft shape -> one stay');
ok(eq(toSetup(draft({ mode: 'auto' })).stay, { mode: 'auto' }), 'client: auto unchanged');
const d = draft({ mode: 'booked', stays: [{ name: 'A', nights: 3 }] });
ok(addStay(d) === 1 && eq(d.stay.stays.map(x => x.nights), [2, 1]), 'client: + เพิ่มที่พัก takes a night from the previous stay');
ok(validate(d) && validate(d).field === 'f-stayname-1', 'client: empty second name -> error on that row');
d.stay.stays[1].name = 'B';
ok(validate(d) === null && eq(toSetup(d).stay.stays, [{ name: 'A', nights: 2 }, { name: 'B', nights: 1 }]), 'client: rows that add up are valid and sent in order');
d.stay.stays[1].nights = 3;
const bad = validate(d);
ok(bad && /จำนวนคืนรวม 5 คืน ไม่ตรงกับทริป 3 คืน/.test(bad.msg), `client: nights mismatch -> Thai message (${bad && bad.msg})`);
d.stay.stays[1].nights = 0;
ok(/อย่างน้อย 1 คืน/.test((validate(d) || {}).msg || ''), 'client: 0 nights on a row -> error');
delStay(d, 1);
ok(eq(d.stay.stays, [{ name: 'A', nights: 3 }]), 'client: removing the last extra row gives all nights back');
const one = draft({ mode: 'booked', stays: [{ name: '', nights: 0 }] }, '2026-11-20');
ok(validate(one) === null && eq(toSetup(one).stay, { mode: 'auto' }), 'client: 1-day trip with no name is fine (auto)');
const one2 = draft({ mode: 'booked', stays: [{ name: 'Day Inn', nights: 0 }] }, '2026-11-20');
ok(eq(toSetup(one2).stay, { mode: 'booked', stays: [{ name: 'Day Inn', nights: 0 }] }) && addStay(one2) === -1, 'client: 1-day trip keeps the base hotel, cannot add a second');
ok(eq(stayRows(draft({ mode: 'booked', name: 'Z' })), [{ name: 'Z', nights: 3 }]), 'client: stayRows migrates the old draft');

console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
