// Unit checks for the "เปิดวันที่ไป" rule (weekday / only-days / dated closures). Usage: node scripts/test-closed.mjs
import { checks, explain, stopFromSpec, BASE, SCEN, SAMPLE_SETUP, clone, schedule } from '../src/plan.js';
import { readFileSync } from 'node:fs';

let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
const rule = (p, setup) => checks(p, setup).list.find(x => x.l === 'เปิดวันที่ไป');
const S = (id, n, x = {}) => Object.assign({ id, n, k: 'sight', t0: '10:00', t1: '11:00', ll: [16.06, 108.22], cost: 0, walk: 0 }, x);
// 2026-11-23 is a Monday
const setup = { startDate: '2026-11-23', days: 2, members: [] };
const plan = stops => ({ flags: {}, days: [{ label: 'จ.', stops: [S('hotel', 'โรงแรม', { k: 'stay' }), ...(stops[0] || [])] }, { label: 'อ.', stops: [S('hotel2', 'โรงแรม', { k: 'stay' }), ...(stops[1] || [])] }] });

const museum = S('museum', 'Shamballa', { k: 'food', days: { closed: ['mon'] } });
let r = rule(plan([[museum]]), setup);
ok(!r.ok, 'closed:[mon] on a Monday fails');
console.log('     ', explain(plan([[museum]]), setup).find(f => f.rule === 'เปิดวันที่ไป').why[0]);
ok(rule(plan([[], [museum]]), setup).ok, 'moved to Tuesday passes');

const walking = S('sunwalk', 'ถนนคนเดินวันอาทิตย์', { k: 'market', days: { only: ['sun'] } });
ok(!rule({ flags: {}, days: [{ stops: [S('h', 'h', { k: 'stay' }), walking] }] }, { startDate: '2026-11-21', members: [] }).ok, 'only:[sun] on a Saturday fails');
ok(rule({ flags: {}, days: [{ stops: [S('h', 'h', { k: 'stay' }), walking] }] }, { startDate: '2026-11-22', members: [] }).ok, 'only:[sun] on a Sunday passes');

const tet = S('temple', 'วัดลินห์อึ๋ง', { closures: [{ date: '2026-11-24', why: 'งานพิธี' }] });
ok(!rule(plan([[], [tet]]), setup).ok, 'closure date fails');
ok(rule(plan([[tet], []]), setup).ok, 'other date passes');

const hours = S('mkt', 'ตลาดเช้า', { k: 'market', open: '06:00-12:00', days: { hours: { sat: '06:00-09:00' } }, t0: '10:00', t1: '11:00' });
ok(!checks({ flags: {}, days: [{ stops: [S('h', 'h', { k: 'stay' }), hours] }] }, { startDate: '2026-11-21', members: [] }).list.find(x => x.l === 'เวลาเปิด–ปิด').ok, 'weekday hours override (sat 06-09) fails at 10:00');

// model spec -> stop
const st = stopFromSpec({ id: 'x', n: 'Museum', k: 'sight', closedDays: ['mon', 'xx'], onlyDays: [], closures: [{ date: '2026-12-25', why: 'คริสต์มาส' }, { date: 'bad' }] });
ok(JSON.stringify(st.days) === '{"closed":["mon"]}' && st.closures.length === 1, 'stopFromSpec maps closedDays/closures');

// sample + scenarios
const R = JSON.parse(readFileSync(new URL('../src/routes.json', import.meta.url), 'utf8'));
const base = schedule(clone(BASE), R);
ok(rule(base, SAMPLE_SETUP).ok && checks(base, SAMPLE_SETUP).pass === checks(base, SAMPLE_SETUP).list.length, 'Chiang Mai sample passes every rule');
for (const k of Object.keys(SCEN)) for (const o of SCEN[k].options) { const p = clone(base); o.build(p); schedule(p, R); ok(rule(p, SAMPLE_SETUP).ok, `scenario ${k}/${o.key} open-day rule passes`); }
const moved = clone(base); const w = moved.days[1].stops.find(s => s.id === 'wualai'); moved.days[2].stops.splice(3, 0, w);
ok(!rule(moved, SAMPLE_SETUP).ok, 'Wua Lai (sat only) on Sunday fails');
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
