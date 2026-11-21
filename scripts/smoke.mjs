// Smoke test against a running server.  Usage: node scripts/smoke.mjs [baseUrl] [only]
//   baseUrl defaults to http://localhost:5173; only = health|plan|replan|place (comma-separated) to limit calls.
import { SAMPLE_SETUP, BASE, clone, schedule, allLegs, legKey, checks, explain } from '../src/plan.js';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const want = k => !only || only.has(k);
const ROUTES = JSON.parse(readFileSync(new URL('../src/routes.json', import.meta.url), 'utf8'));

async function ndjson(path, body) {
  const t = Date.now();
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.headers.get('content-type')?.includes('ndjson')) throw new Error(`${path}: content-type ${r.headers.get('content-type')}`);
  const dec = new TextDecoder(); let buf = '', terminal = null, steps = 0;
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'step') { steps++; console.log(`  ${((Date.now() - t) / 1000).toFixed(1).padStart(5)}s  step  ${ev.text}`); }
      else if (ev.type === 'day') console.log(`  ${((Date.now() - t) / 1000).toFixed(1).padStart(5)}s  day   ${ev.index} ${ev.day.label} · ${ev.day.stops.length} stops · ${Object.keys(ev.routes).length} routes`);
      else { if (terminal) throw new Error('two terminal events'); terminal = ev; }
    }
  }
  if (!terminal) throw new Error(`${path}: no terminal event`);
  console.log(`  ${((Date.now() - t) / 1000).toFixed(1).padStart(5)}s  ${terminal.type}${terminal.code ? ' ' + terminal.code + ': ' + terminal.message : ''}`);
  return terminal;
}

const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('  ok', m); };

console.log(`# ${base}`);
const h = await (await fetch(base + '/api/health')).json();
console.log('health', h);
assert(typeof h.claude === 'boolean' && typeof h.model === 'string' && h.model.length > 0, 'health shape');

if (want('plan')) {
  console.log('POST /api/plan');
  const d = await ndjson('/api/plan', { setup: SAMPLE_SETUP });
  if (!h.claude) assert(d.type === 'error' && d.code === 'no_key', 'no_key without a model');
  else if (d.type === 'done') {
    assert(d.plan.days.length === SAMPLE_SETUP.days, `plan has ${d.plan.days.length} days`);
    assert(Object.keys(d.routes).length > 0, `${Object.keys(d.routes).length} routes`);
    const stops = d.plan.days.flatMap(x => x.stops);
    console.log('  sources', stops.reduce((a, s) => (a[s.place?.source] = (a[s.place?.source] || 0) + 1, a), {}),
      'web-checked', stops.filter(s => s.src?.checked === 'web').length, '/', stops.length, 'ms', d.ms, 'repaired', d.repaired);
    const od = explain(d.plan, SAMPLE_SETUP).find(f => f.rule === 'เปิดวันที่ไป');
    assert(!od, `open-day violations: ${od ? od.why.join(' | ') : 0} · checks ${checks(d.plan, SAMPLE_SETUP).pass}/${checks(d.plan, SAMPLE_SETUP).list.length}`);
    console.log('   open-day data:', stops.filter(s => s.days || s.closures).map(s => `${s.n}:${JSON.stringify(s.days || {})}${s.closures ? JSON.stringify(s.closures) : ''}`).join(' · '));
  }
}
if (want('replan')) {
  console.log('POST /api/replan');
  const plan = schedule(clone(BASE), ROUTES);
  const d = await ndjson('/api/replan', { setup: SAMPLE_SETUP, plan, command: 'ฝนตกหนักที่แม่แตงบ่ายวันเสาร์ ไปน้ำตกไม่ได้', day: 1 });
  if (d.type === 'done') {
    assert(d.options.length >= 1 && (d.needs_vote || d.options.length === 1), `options ${d.options.map(o => o.key).join(',')} needs_vote=${d.needs_vote}`);
    assert(d.options.every(o => o.plan && o.plan.days.length === 3), 'every option has a full plan');
  }
}
if (want('place')) {
  console.log('POST /api/place-info');
  const st = BASE.days[0].stops.find(s => s.id === 'khaosoi');
  const d = await ndjson('/api/place-info', { city: 'เชียงใหม่', stop: { id: st.id, n: st.n, k: st.k, ll: st.ll, note: st.note } });
  if (d.type === 'done') {
    assert(Array.isArray(d.info.dishes) && Array.isArray(d.info.sources), `info: ${d.info.dishes.length} dishes, ${d.info.sources.length} sources, ${d.info.confidence}`);
    console.log('  ', JSON.stringify(d.info).slice(0, 400));
  }
}
if (want('transport')) {
  console.log('POST /api/transport-options');
  const setup = { ...SAMPLE_SETUP, arrive: { by: 'flight', from: 'DMK' }, depart: { by: 'flight', to: 'DMK' } };
  const d = await ndjson('/api/transport-options', { setup, dir: 'go' });
  if (d.type === 'done') {
    assert(Array.isArray(d.options) && d.options.filter(o => o.recommended).length === (d.options.length ? 1 : 0), `${d.options.length} options, one recommended`);
    for (const o of d.options) console.log(`   ${o.recommended ? '*' : ' '} ${o.carrier} ${o.code || ''} ${o.from} ${o.dep} → ${o.to} ${o.arr} ฿${o.price ?? '?'} ${o.bag || ''} [${o.checked}] ${o.src.url}${o.why ? ' · ' + o.why : ''}`);
  }
}
if (want('plan-notime')) {
  console.log('POST /api/plan (no flight times: Bop finds flights)');
  const setup = { ...SAMPLE_SETUP, arrive: { by: 'flight', from: 'DMK' }, depart: { by: 'flight', to: 'DMK' } };
  const d = await ndjson('/api/plan', { setup });
  if (d.type === 'done') {
    const t = d.plan.flags.transport || {};
    assert(!!(t.go && t.back), `flags.transport go=${t.go && t.go.chosen} back=${t.back && t.back.chosen}`);
    const days = d.plan.days, f = days[0].stops[0], l = days[days.length - 1].stops.at(-1);
    console.log(`   first ${f.t0} ${f.n} · last ${l.t0} ${l.n} · ms ${d.ms}`);
  }
}
if (want('replan-flight')) {
  console.log('POST /api/replan (change flight)');
  const plan = schedule(clone(BASE), ROUTES);
  plan.flags.transport = { go: { chosen: 'go-1', options: [{ id: 'go-1', by: 'flight', carrier: 'Thai AirAsia', code: 'FD3433', from: 'DMK', to: 'CNX', dep: '08:00', arr: '09:15', price: 1190, src: { url: '', title: '' }, checked: 'estimate', recommended: true }] } };
  const d = await ndjson('/api/replan', { setup: SAMPLE_SETUP, plan, command: 'เปลี่ยนเที่ยวบินขาไปเป็น Nok Air DD8302 ออก 08:00 ถึง 09:15', day: 0 });
  if (d.type === 'done') {
    const t = d.options[0].plan.flags.transport.go, ch = t.options.find(o => o.id === t.chosen);
    assert(ch && ch.code === 'DD8302', `chosen ${ch && ch.carrier} ${ch && ch.code} · first stop ${d.options[0].plan.days[0].stops[0].t0} · setup.arrive ${JSON.stringify(d.setup && d.setup.arrive)}`);
  }
}
const DANANG = { title: 'ดานังกับเพื่อน', city: 'ดานัง', country: 'VN', currency: 'VND', startDate: '2026-12-10', endDate: '2026-12-15', days: 6,
  arrive: { by: 'flight', from: 'BKK', time: '10:30' }, depart: { by: 'flight', to: 'BKK', time: '16:30' }, pace: 'normal',
  members: [{ id: 'm1', name: 'เอ', role: 'organizer', wants: ['ถึงเวียดนามตอนเช้า'] }, { id: 'm2', name: 'บี', avoid: 'เนื้อสัตว์ (กินมังสวิรัติ)' }, { id: 'm3', name: 'ซี', budget: 25000 }] };
function checkMap(plan, routes, lat, lng) {
  const stops = plan.days.flatMap(d => d.stops);
  const bad = stops.filter(s => !Array.isArray(s.ll) || !Number.isFinite(s.ll[0]) || !Number.isFinite(s.ll[1]) || Math.abs(s.ll[0] - lat) > 1.5 || Math.abs(s.ll[1] - lng) > 1.5);
  assert(!bad.length, `all ${stops.length} stops have valid ll near ${lat},${lng}${bad.length ? ' BAD: ' + bad.map(s => s.id + '=' + JSON.stringify(s.ll)).join(' ') : ''}`);
  const keys = allLegs(plan).map(l => legKey(l.a, l.b, l.m)), missing = keys.filter(k => !routes[k]);
  assert(keys.length && !missing.length, `routes cover ${keys.length - missing.length}/${keys.length} legs (keys = legKey)`);
  const wi = stops.filter(s => (s.walkin || s.res) && !(s.k === 'food' || (s.k === 'market' && s.meal)));
  assert(!wi.length, `no walkin/res outside food${wi.length ? ': ' + wi.map(s => s.id).join(',') : ''}`);
}
if (want('danang')) {
  console.log('POST /api/plan (Da Nang, 3 people, 6 days)');
  const d = await ndjson('/api/plan', { setup: DANANG });
  if (d.type === 'done') { checkMap(d.plan, d.routes, 16.05, 108.2); console.log('   stars', d.plan.days.flatMap(x => x.stops).filter(s => s.star).map(s => s.id + '→' + s.star).join(', ')); }
}
if (want('candidates')) {
  console.log('POST /api/plan/candidates (Da Nang)');
  const d = await ndjson('/api/plan/candidates', { setup: { ...DANANG, autonomy: 'ask' } });
  if (d.type === 'done') {
    const opts = d.questions.flatMap(q => q.options);
    assert(d.questions.length >= 1 && opts.length >= 4, `${d.questions.length} questions, ${opts.length} options, ${opts.filter(o => o.photo).length} photos`);
    for (const q of d.questions) { console.log(`   ${q.kind}: ${q.title}`); for (const o of q.options) console.log(`     - ${o.name} [${o.tags.join(', ')}] ${o.why} ${o.ll ? o.ll.join(',') : 'no ll'}${o.photo ? `\n       photo ${o.photo.url.slice(0, 90)} (${o.photo.credit})` : ''}`); }
    if (want('picks') && opts.length >= 3) {
      console.log('POST /api/plan (Da Nang with picks)');
      const must = [opts[0], opts[opts.length - 1]], avoid = [opts[1].id];
      const p = await ndjson('/api/plan', { setup: { ...DANANG, autonomy: 'ask', picks: { must, avoid } } });
      if (p.type === 'done') checkMap(p.plan, p.routes, 16.05, 108.2);
    }
  }
}
if (want('place-sight')) {
  console.log('POST /api/place-info (sight: Ba Na Hills)');
  const d = await ndjson('/api/place-info', { city: 'ดานัง', stop: { id: 'bana_test', n: 'บานาฮิลล์', k: 'sight', ll: [15.9977, 107.9884], place: { query: 'Ba Na Hills' } } });
  if (d.type === 'done') {
    assert(d.info.details && Array.isArray(d.info.photos), `details + ${d.info.photos.length} photos, ${d.info.sources.length} sources, ${d.info.confidence}`);
    console.log('   ', JSON.stringify(d.info.details).slice(0, 500));
    for (const p of d.info.photos) console.log(`    photo [${p.source}] ${p.url.slice(0, 100)} · ${p.credit} · ${p.page}`);
  }
}
console.log('POST /api/replan (bad request)');
const bad = await ndjson('/api/replan', { setup: SAMPLE_SETUP, plan: { days: [] }, command: 'x' });
assert(bad.type === 'error' && (bad.code === 'bad_request' || bad.code === 'no_key'), 'bad plan rejected');
