// Food-restriction rule (member.avoid) checks against the sample plan; no network.
// Usage: node scripts/test-diet.mjs
const P = await import('../src/plan.js');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail++; };
const setup = members => ({ ...P.SAMPLE_SETUP, members });
const txt = r => JSON.stringify(r);

// sample: ปาล์ม avoid meat, every BASE meal has veg -> rule present and passing
const s = txt(P.checks(P.BASE, P.SAMPLE_SETUP));
ok(s.includes('ไม่ทาน เนื้อสัตว์ (กินมังสวิรัติ)') && /มื้อที่ทานได้ (\d+)\/\1"/.test(s), 'sample vegetarian member passes on veg meals');

// shrimp allergy: veg flags do not count, diet needed
ok(txt(P.checks(P.BASE, setup([{ id: 'a', name: 'เอ', avoid: 'กุ้ง' }]))).includes('มื้อที่ทานได้ 0/'), 'shrimp allergy not satisfied by veg flags');
const p2 = P.clone(P.BASE); p2.days.forEach(d => d.stops.forEach(x => { if (x.meal) x.diet = 1; }));
ok(/มื้อที่ทานได้ (\d+)\/\1"/.test(txt(P.checks(p2, setup([{ id: 'a', name: 'เอ', avoid: 'กุ้ง' }])))), 'diet on every meal satisfies the allergy');

// one meal missing diet -> explain names it
const p3 = P.clone(p2); const miss = p3.days[0].stops.find(x => x.meal); delete miss.diet;
const ex = txt(P.explain ? P.explain(p3, setup([{ id: 'a', name: 'เอ', avoid: 'กุ้ง' }])) : P.checks(p3, setup([{ id: 'a', name: 'เอ', avoid: 'กุ้ง' }])));
ok(ex.includes(miss.id), `missing meal named (${miss.id})`);

// legacy veg:true member
ok(txt(P.checks(P.BASE, setup([{ id: 'a', name: 'เอ', veg: true }]))).includes('ไม่ทาน เนื้อสัตว์'), 'legacy veg:true read as avoid meat');

ok(P.vegAvoid('มังสวิรัติ') && P.vegAvoid('vegan') && !P.vegAvoid('กุ้ง'), 'vegAvoid detects vegetarian text');
ok(P.mealFits({ veg: 1 }, { avoid: 'มังสวิรัติ' }) && !P.mealFits({ veg: 1 }, { avoid: 'ถั่วลิสง' }) && P.mealFits({ diet: 1 }, { avoid: 'ถั่วลิสง' }), 'mealFits: veg covers vegetarians only');

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
