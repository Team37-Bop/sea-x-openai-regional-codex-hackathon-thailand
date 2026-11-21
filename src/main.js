import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as P from './plan.js';
import ROUTES from './routes.json';
import { api, health, errText } from './ui/api.js';
import { sheetHTML, candCard, askHTML, safeUrl as normalizeMediaUrl } from './ui/place.js';
import { esc, sampleSetup, renderSetup, readField, addMember, addStay, delStay, validate, toSetup, initials, organizer, memberName, avClass,
  memberWants, rangeText, nightsText, dateOf, PACE, CITY_LL, cityTuple, transportHTML, optRow, NOUN } from './ui/setup.js';

const { clone, toM, baht, sbaht, km, MODES, KCOL, BASE, dayStats, checks, diff, idx, has, SCEN, schedule } = P;
const MODE_ADJ = P.MODE_ADJ || {};
const MODE_TH = { walk:'เดิน', red:'รถแดง', car:'รถแอป', van:'รถตู้เหมา', transit:'รถไฟ/รถไฟฟ้า', own:'รถส่วนตัว', ...P.MODES };
const MODE_ORDER = ['walk','transit','red','car','van','own'];
const fmtMin = m => m >= 60 ? `${Math.floor(m/60)} ชม.${m%60 ? ` ${m%60} นาที` : ''}` : `${m} นาที`;
const OSRM = P.OSRM_PROFILE || { walk:'routed-foot', red:'routed-car', car:'routed-car', van:'routed-car' };
const legKey = P.legKey || ((a,b,m) => `${OSRM[m]}|${a[1]},${a[0]};${b[1]},${b[0]}`);
const fresh = () => schedule(clone(BASE), ROUTES);

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const say = t => { const l = $('#live'); l.textContent = ''; setTimeout(() => { l.textContent = t; }, 30); };
const safeUrl = normalizeMediaUrl;
const kcol = k => KCOL[k] || '--k-sight';

const IC = {
  ok:'<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
  no:'<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  phone:'<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h2.6l1 3-1.6 1a8 8 0 003 3l1-1.6 3 1v2.6a1.5 1.5 0 01-1.6 1.5A10.5 10.5 0 012 4.1 1.5 1.5 0 013.5 2.5z"/></svg>',
  sun:'<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12h12M4.5 12a3.5 3.5 0 017 0M8 3v2M3.5 5.5L5 7M12.5 5.5L11 7"/></svg>',
  menu:'<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v5a2 2 0 004 0V2M6 2v12M11.5 14V2c-1.7.8-2.5 2.6-2.5 5h2.5"/></svg>',
  ext:'<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5"/></svg>',
};

/* ---------- state ---------- */
const st = {
  screen:'setup', health:{ claude:false, reachable:false, checked:false },
  draft: sampleSetup(), setup:null, sample:false, summary:null,
  plan:null, origin:null, hist:[], lastDiff:null, preview:null, card:null,
  day:0, sel:null, tab:'plan', all:false, busy:false, approved:{}, resv:{}, cancels:[],
  planning:null, ctl:null, info:{}, reveal:false,
  topts:{ arrive:{}, depart:{} }, tripTopts:{}, tchg:{}, wx:null, fb:{},
  line:{ enabled:null, state:'idle', linked:false, tripId:null, token:null, code:null, error:null },
};
const infoCache = new Map();          // `${id}|${name}` → place-info result (per page)
const EXTRA = {};                     // route geometries returned by the agent, merged over routes.json
const mergeRoutes = r => { if (r && typeof r === 'object') Object.entries(r).forEach(([k,v]) => { if (v && Array.isArray(v.geom) && v.geom.length > 1) EXTRA[k] = v; }); };

const view = () => st.preview || st.plan;
function safeDiff(a,b){ try { return a && b && a.days.length === b.days.length ? diff(a,b) : null; } catch (e) { console.warn(e); return null; } }
const curDiff = () => st.preview ? safeDiff(st.plan, st.preview) : st.lastDiff;
function ck(p){
  try { const r = checks(p, st.setup); if (r && Array.isArray(r.list)) return r; } catch (e) { console.warn('checks()', e); }
  const ds = p.days.map(dayStats);
  return { mem:{}, list:[], pass:0, total:ds.reduce((a,d)=>a+d.cost,0), maxWalk:Math.max(0, ...ds.map(d=>d.walk)), ds };
}
/* positions from the agent may be [lat,lng], {lat,lng}, "lat,lng", strings, or swapped; normalise or drop */
function normLL(ll){
  let a, b;
  if (Array.isArray(ll)) [a, b] = ll.map(Number);
  else if (ll && typeof ll === 'object') { a = Number(ll.lat ?? ll.latitude); b = Number(ll.lng ?? ll.lon ?? ll.longitude); }
  else if (typeof ll === 'string') [a, b] = ll.split(',').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  return Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null;
}
const okLL = ll => Array.isArray(ll) && ll.length === 2 && Number.isFinite(ll[0]) && Number.isFinite(ll[1]);
function normPlan(p){
  if (!p || !Array.isArray(p.days)) return p;
  p.flags = p.flags || {};
  p.days.forEach((d, i) => {
    d.label = d.label || `วันที่ ${i+1}`;
    d.stops = (Array.isArray(d.stops) ? d.stops : []).filter(s => s && typeof s === 'object');
    d.stops.forEach((s, j) => {
      s.id = s.id != null ? String(s.id) : `s${i}-${j}`;
      s.n = String(s.n || s.name || 'จุดแวะ');
      s.t0 = /^\d{1,2}:\d{2}$/.test(s.t0 || '') ? s.t0 : (s.t1 || '00:00'); s.t1 = /^\d{1,2}:\d{2}$/.test(s.t1 || '') ? s.t1 : s.t0;
      s.ll = normLL(s.ll);
      s.cost = +s.cost || 0; s.walk = +s.walk || 0;
      if (s.leg && typeof s.leg === 'object') { s.leg.min = +s.leg.min || 0; s.leg.km = +s.leg.km || 0; s.leg.cost = +s.leg.cost || 0; } else delete s.leg;
    });
  });
  return p;
}
const lineOf = (o, dc) => typeof o.line === 'function' ? o.line(dc) : (o.line || '');

/* ---------- screens ---------- */
function show(screen){
  st.screen = screen;
  $('#app').dataset.screen = screen;
  const inTrip = screen !== 'setup';
  $('#setup').hidden = inTrip;
  $('#split').hidden = !inTrip;
  $('#cmd').hidden = screen !== 'planner';
  $('#tabs').hidden = screen !== 'planner';
  $('#mapbar').hidden = screen !== 'planner';
  $('#trip').hidden = !inTrip;
  $('#members').hidden = screen !== 'planner';
  $('#topr').hidden = screen === 'planner';
  if (inTrip) ensureMap();
  if (screen !== 'planner') closeSheet(true);
  window.scrollTo(0, 0);
  if (map) requestAnimationFrame(() => { try { map.resize(); } catch (_) {} if (screen === 'planner') goBox(); });
}
function renderAgent(){
  const h = st.health;
  document.querySelectorAll('.agent').forEach(a => { a.className = 'agent ' + (!h.checked ? '' : h.claude ? 'on' : 'off');
  a.querySelector('span').textContent = !h.checked ? 'กำลังเช็ก agent…' : h.claude ? 'Bop พร้อม' : 'Bop · โหมดตัวอย่าง';
  a.title = !h.checked ? '' : h.claude ? `Bop เชื่อมต่อแล้ว${h.provider ? ' · ' + h.provider : ''}${h.search ? ' · ค้นเว็บได้' : ''}` : (h.reachable ? 'ยังไม่ได้ตั้งค่า service-account API key ใน .env.local' : 'ไม่พบเซิร์ฟเวอร์ agent · ใช้แผนตัวอย่างแบบออฟไลน์');
  });
}

/* ---------- onboarding ---------- */
function setupMsg(){
  if (!st.health.checked) return '';
  if (st.health.claude) return '';
  return st.health.reachable
    ? 'โหมดตัวอย่าง: Bop ยังไม่ได้ตั้งค่า API key · เปิดแผนตัวอย่างดูได้ทันที'
    : 'โหมดตัวอย่าง: ไม่พบเซิร์ฟเวอร์ agent · เปิดแผนตัวอย่างแบบออฟไลน์ดูได้ทันที';
}
function renderSetupScreen(){
  renderSetup($('#setup'), st.draft, { claude: st.health.claude, hasPlan: !!st.plan, msg: setupMsg(), topts: st.topts });
}
function openSetup(){
  if (st.ctl) st.ctl.abort();
  st.draft = clone(st.setup || st.draft);
  if (st.setup) st.draft._titleTouched = true;
  st.draft.members.forEach(m => { if (Array.isArray(m.wants)) m.wants = m.wants.slice(); });
  show('setup'); renderSetupScreen();
  $('#f-title') && $('#f-title').focus();
}
$('#setup').addEventListener('input', e => { if (e.target.matches('[data-f],[data-k],[data-s]') && !/radio|checkbox/.test(e.target.type)) readField(st.draft, e.target); });
$('#setup').addEventListener('change', e => {
  if (!e.target.matches('[data-f],[data-k],[data-s]')) return;
  if (readField(st.draft, e.target)) { const n = e.target.name; if (/^by-/.test(n || '')) st.topts[n.slice(3)] = {}; renderSetupScreen(); const r = n && document.querySelector(`[name="${n}"]:checked`); if (r) r.focus(); }
});
$('#setup').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const i = st.draft.members.findIndex(m => m.id === del.dataset.del);
    if (i >= 0) { const wasOrg = st.draft.members[i].role === 'organizer'; st.draft.members.splice(i,1); if (wasOrg && st.draft.members[0]) st.draft.members[0].role = 'organizer'; }
    renderSetupScreen(); $('#f-newmem').focus(); return;
  }
  if (e.target.closest('#addmem')) { addFromInput(); return; }
  if (e.target.closest('#addstay')) { const i = addStay(st.draft); renderSetupScreen(); const f = document.getElementById(i > 0 ? `f-stayname-${i}` : 'f-stayname'); if (f) f.focus(); return; }
  const sdel = e.target.closest('[data-sdel]');
  if (sdel) { const i = +sdel.dataset.sdel; delStay(st.draft, i); renderSetupScreen(); const f = document.getElementById(i > 1 ? `f-stayname-${i - 1}` : 'f-stayname'); if (f) f.focus(); say('ลบที่พักแล้ว'); return; }
  const tf = e.target.closest('[data-tfind]'); if (tf) { findTransport(tf.dataset.tfind); return; }
  const to = e.target.closest('[data-topt]');
  if (to) {
    const dir = to.dataset.topt, o = (st.topts[dir].options || [])[+to.dataset.i], t = st.draft[dir]; if (!o || !t) return;
    t.choice = o;
    if (dir === 'arrive') { if (o.arr) t.time = o.arr; if (o.from) t.from = o.from; }
    else { if (o.dep) t.time = o.dep; if (o.to) t.to = o.to; }
    renderSetupScreen();
    const b = document.querySelector(`[data-topt="${dir}"][data-i="${to.dataset.i}"]`); if (b) b.focus();
    say(`เลือก ${o.carrier || ''} ${o.code || ''} ${o.dep || ''} ถึง ${o.arr || ''} แล้ว`);
    return;
  }
  if (e.target.closest('#usesample')) { openSample(); return; }
  if (e.target.closest('#backplan')) { show('planner'); renderAll(); return; }
});
/* POST /api/transport-options from the setup screen */
async function findTransport(dir){
  const T = st.topts[dir] = { state:'run', steps:[] };
  const paint = () => { const el = document.getElementById('tf-' + dir); if (el) el.innerHTML = transportHTML(st.draft, dir, T); };
  paint();
  const ev = await api.transport(toSetup(st.draft), dir === 'arrive' ? 'go' : 'back', { onEvent: e => {
    if (e.type === 'step' && st.topts[dir] === T) { T.steps.push(String(e.text||'')); say(e.text); paint(); }
  }});
  if (st.topts[dir] !== T) return;
  if (ev.type === 'error') { T.state = 'error'; T.msg = errText(ev) + (ev.code === 'no_key' || ev.code === 'offline' ? ' · ใส่เวลาเองได้โดยปิด “ให้ Bop หา”' : ''); }
  else { T.state = 'done'; T.options = (ev.options || []).filter(o => o && (o.dep || o.arr)); say(`ได้ตัวเลือก ${T.options.length} รายการ`); }
  paint();
}
function addFromInput(){
  const inp = $('#f-newmem'), name = inp.value.trim();
  if (!name) { inp.focus(); return; }
  const id = addMember(st.draft, name);
  if (!st.draft.members.some(m => m.role === 'organizer')) st.draft.members[0].role = 'organizer';
  renderSetupScreen();
  const ni = document.getElementById('mn-' + id); if (ni) ni.focus();
}
$('#setup').addEventListener('keydown', e => { if (e.target.id === 'f-newmem' && e.key === 'Enter') { e.preventDefault(); addFromInput(); } });
$('#setup').addEventListener('submit', e => {
  e.preventDefault();
  const bad = validate(st.draft);
  if (bad) { $('#setupmsg').textContent = bad.msg; $('#setupmsg').classList.add('bad'); const f = document.getElementById(bad.field); if (f) f.focus(); return; }
  const setup = toSetup(st.draft);
  if (setup.autonomy === 'ask') startAsk(setup); else startPlanning(setup);
});

/* ---------- planning (POST /api/plan) ---------- */
let tick = null;
async function startPlanning(setup){
  if (st.ctl) st.ctl.abort();
  const ctl = new AbortController(); st.ctl = ctl;
  closeAsk();
  st.planning = { setup, steps:[], state:'run', t0:performance.now(), err:null, phase:'plan', days:[] };
  st.tripTopts = { arrive: st.topts.arrive.options || [], depart: st.topts.depart.options || [] };
  show('planning'); renderHeader(); renderPlanning(); flyToCity(setup.city);
  clearInterval(tick); tick = setInterval(() => { const e = $('#elapsed'); if (e && st.planning) e.textContent = Math.round((performance.now()-st.planning.t0)/1000); }, 1000);
  const ev = await api.plan(setup, { signal:ctl.signal, onEvent: e => {
    if (e.type === 'step' && st.planning && st.ctl === ctl) { st.planning.steps.push(String(e.text||'')); say(e.text); renderPlanning(); }
    if (e.type === 'day' && st.planning && st.ctl === ctl && e.day && Number.isInteger(+e.index)) {   // progressive: draw each day as it lands
      const pl = st.planning, i = +e.index;
      mergeRoutes(e.routes);
      pl.days = pl.days || []; pl.days[i] = normPlan({ days:[e.day] }).days[0]; pl.newest = i;
      say(`วันที่ ${i+1} พร้อมแล้ว`); renderPlanning(); drawMap(); fitPlanning();
    }
  }});
  if (st.ctl !== ctl) return;           // superseded or cancelled
  st.ctl = null; clearInterval(tick);
  if (ev.type === 'error') {
    if (ev.code === 'aborted') return;
    st.planning.state = 'error'; st.planning.err = ev; say(errText(ev)); renderPlanning(); return;
  }
  if (!ev.plan || !Array.isArray(ev.plan.days) || !ev.plan.days.length) {
    st.planning.state = 'error'; st.planning.err = { code:'upstream', message:'Bop ส่งแผนกลับมาไม่ครบ ลองใหม่อีกครั้ง' }; renderPlanning(); return;
  }
  mergeRoutes(ev.routes);
  loadPlan(setup, normPlan(ev.plan), false, ev.summary || null);
  say('แผนพร้อมแล้ว ' + (ev.summary || ''));
}
/* ---------- "ask first": POST /api/plan/candidates → one question at a time → /api/plan with picks ---------- */
function normQuestions(ev){
  let qs = Array.isArray(ev.questions) ? ev.questions : [];
  if (!qs.length && Array.isArray(ev.candidates)) {
    const by = new Map();
    ev.candidates.forEach(o => { const g = o.group || o.cat || o.k || 'sight'; if (!by.has(g)) by.set(g, []); by.get(g).push(o); });
    qs = [...by].map(([g, options]) => ({ id:g, title: g === 'food' ? 'ร้านพวกนี้น่าสนใจ อยากให้ใส่ในแผนไหม' : g === 'stay' ? 'ที่พักแบบไหนดี' : 'ที่เที่ยวพวกนี้น่าสนใจ อยากให้ใส่ในแผนไหม', options }));
  }
  return qs.map((q, qi) => ({ ...q, options: (q.options || []).filter(Boolean).map((o, i) => ({ ...o, id: String(o.id ?? `q${qi}-${i}`) })) })).filter(q => q.options.length);
}
async function startAsk(setup){
  if (st.ctl) st.ctl.abort();
  const ctl = new AbortController(); st.ctl = ctl;
  st.planning = { setup, steps:[], state:'run', t0:performance.now(), err:null, phase:'cand' };
  show('planning'); renderHeader(); renderPlanning(); flyToCity(setup.city);
  clearInterval(tick); tick = setInterval(() => { const e = $('#elapsed'); if (e && st.planning) e.textContent = Math.round((performance.now()-st.planning.t0)/1000); }, 1000);
  const ev = await api.candidates(setup, { signal:ctl.signal, onEvent: e => {
    if (e.type === 'step' && st.planning && st.ctl === ctl) { st.planning.steps.push(String(e.text||'')); say(e.text); renderPlanning(); }
  }});
  if (st.ctl !== ctl) return;
  st.ctl = null; clearInterval(tick);
  if (ev.type === 'error') { if (ev.code === 'aborted') return; st.planning.state = 'error'; st.planning.err = ev; renderPlanning(); return; }
  const qs = normQuestions(ev);
  if (!qs.length) { startPlanning(setup); return; }
  st.ask = { setup, qs, qi:0, ans:{} };
  st.planning.phase = 'ask'; renderPlanning();
  openAsk();
}
let askReturn = null;
function openAsk(){
  if (!st.ask) return;
  askReturn = document.activeElement;
  $('#ask').hidden = false; document.body.classList.add('modal-open');
  renderAsk(true);
}
function closeAsk(){ $('#ask').hidden = true; $('#ask').innerHTML = ''; document.body.classList.remove('modal-open'); }
function renderAsk(focus){
  const A = st.ask; if (!A) return;
  const q = A.qs[A.qi];
  $('#ask').innerHTML = `<div class="ask-card">${askHTML(q, A.qi, A.qs.length, A.ans)}</div>`;
  if (focus) { const t = $('#ask-title'); if (t) t.focus(); }
}
function askAct(a){
  const A = st.ask; if (!A) return;
  if (a === 'skip') { A.qs[A.qi].options.forEach(o => { delete A.ans[o.id]; }); a = 'next'; }
  if (a === 'next' && A.qi + 1 < A.qs.length) { A.qi++; renderAsk(true); $('#ask').scrollTop = 0; say(`คำถามที่ ${A.qi+1}`); return; }
  const all = A.qs.flatMap(q => q.options);
  const must = all.filter(o => A.ans[o.id] === 'yes'), avoid = all.filter(o => A.ans[o.id] === 'no').map(o => o.id);
  const setup = { ...A.setup, picks:{ must, avoid } };
  st.ask = null; closeAsk();
  startPlanning(setup);
}
$('#ask').addEventListener('click', e => {
  const A = st.ask; if (!A) return;
  const b = e.target.closest('[data-ans]');
  if (b) { const o = A.qs[A.qi].options[+b.dataset.cand]; if (!o) return; A.ans[o.id] = A.ans[o.id] === b.dataset.ans ? undefined : b.dataset.ans; renderAsk(false);
    const f = $('#ask').querySelector(`[data-cand="${b.dataset.cand}"][data-ans="${b.dataset.ans}"]`); if (f) f.focus(); return; }
  const k = e.target.closest('[data-ask]'); if (k) askAct(k.dataset.ask);
});
$('#ask').addEventListener('keydown', e => {           // keep focus inside the dialog
  if (e.key !== 'Tab') return;
  const f = [...$('#ask').querySelectorAll('button:not([disabled]),a[href],[tabindex="-1"]')].filter(x => x.offsetParent);
  if (!f.length) return;
  const first = f[0], last = f[f.length-1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function loadPlan(setup, plan, sample, summary){
  const lineEnabled = st.line.enabled;
  Object.assign(st, { setup, sample, summary, plan, origin:clone(plan), hist:[], lastDiff:null, preview:null, card:null,
    day:0, sel:null, tab:'plan', all:!sample, approved:{}, resv:{}, cancels:[], planning:null, info:{}, reveal:!reduced,
    line:{ enabled:lineEnabled, state:'idle', linked:false, tripId:null, token:null, code:null, error:null } });
  st.wx = null;
  show('planner'); syncViewBtns(); renderAll();
  setTimeout(() => { st.reveal = false; }, 1600);
  checkWeather();
}
/* ---------- live rain check (POST /api/weather-check, Open-Meteo, no model) ---------- */
let wxCtl = null;
async function checkWeather(){
  if (st.sample || !st.plan || !st.setup) return;       // offline sample keeps the simulated rain scenario
  if (wxCtl) wxCtl.abort();
  const ctl = new AbortController(); wxCtl = ctl;
  const dismissed = (st.wx && st.wx.dismissed) || {};
  const ev = await api.weather(st.setup, st.plan, { signal: ctl.signal });
  if (wxCtl !== ctl) return;
  wxCtl = null;
  if (ev.type !== 'done') { st.wx = { alerts:[], reason:'unavailable', dismissed }; }
  else st.wx = { alerts: Array.isArray(ev.alerts) ? ev.alerts : [], reason: ev.reason || null, horizon: ev.horizon, dismissed };
  if(st.line.linked&&st.wx.alerts.length){
    const alert=st.wx.alerts[0], key=`${alert.stopId}|${alert.date}|${alert.level}`;
    st.line.weatherPosted=st.line.weatherPosted||{};
    if(!st.line.weatherPosted[key]){ st.line.weatherPosted[key]=true; void postLineText(`Bop: ${wxLine(alert)}`); }
  }
  if (st.screen === 'planner') renderPanel();
}
const WX_RANK = { heavy:2, likely:1 };
const wxKey = a => `${a.stopId}|${a.date}|${a.level}`;
function wxFor(di){
  const w = st.wx; if (!w || !w.alerts) return null;
  const xs = w.alerts.filter(a => a.day === di && !w.dismissed[wxKey(a)] && view().days[di] && view().days[di].stops.some(s => s.id === a.stopId));
  return xs.sort((a, b) => WX_RANK[b.level] - WX_RANK[a.level] || (b.prob||0) - (a.prob||0))[0] || null;
}
const wxLine = a => `${a.level === 'heavy' ? 'ฝนอาจตกหนัก' : 'มีโอกาสฝนตก'} ${a.from}–${a.to} ที่${a.n || 'จุดกลางแจ้ง'}`;
function wxCommand(a){
  return `พยากรณ์${a.level === 'heavy' ? 'ฝนตกหนัก' : 'มีฝน'} ${a.from}–${a.to} วันที่ ${a.day + 1} ที่${a.n} (โอกาส ${a.prob}% ~${a.mm} มม./ชม.) ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม`;
}
function wxStrip(){
  const w = st.wx; if (!w || st.sample) return '';
  const a = wxFor(st.day);
  const credit = `<a class="wx-src" href="https://open-meteo.com/" target="_blank" rel="noopener">ข้อมูลอากาศ: Open-Meteo.com</a>`;
  if (!a) {
    if (w.reason === 'beyond_horizon') return `<p class="wx-none gut">ยังไม่มีพยากรณ์อากาศ (ดูได้ล่วงหน้าไม่เกิน 16 วัน)</p>`;
    if (w.reason === 'unavailable') return `<p class="wx-none gut">ยังไม่มีพยากรณ์อากาศ</p>`;
    return '';
  }
  const offer = !a.trend || a.level === 'heavy';
  return `<div class="wx gut ${a.level}" role="status"><div class="wx-t"><b>${esc(wxLine(a))}</b>${a.trend ? ' <span class="wx-trend">แนวโน้ม</span>' : ''}
    <span class="wx-d">โอกาส ${esc(a.prob)}% · ~${esc(a.mm)} มม./ชม.</span></div>
    <div class="wx-a">${offer && !st.busy ? `<button class="btn sm" type="button" data-wx="go">ให้ Bop ปรับแผน</button>` : ''}<button class="btn sm ghost" type="button" data-wx="dismiss">ไม่เป็นไร</button>${credit}</div></div>`;
}
function openSample(){ loadPlan(sampleSetup(), fresh(), true, null); }

function keyHelp(code){
  if (code === 'offline') return `<p class="lead">หน้านี้ยังไม่มีเซิร์ฟเวอร์ agent รันอยู่ เปิดด้วย <code>npm run dev</code> หลังจาก backend พร้อม หรือดูแผนตัวอย่างแบบออฟไลน์ไปก่อน</p>`;
  if (code !== 'no_key') return '';
  return `<div class="keyhelp"><p>ใส่ service-account key ให้ Bop ในไฟล์ <code>~/bop/.env.local</code></p><pre>OPENAI_APIKEY=...</pre><p>แล้วรีสตาร์ต <code>npm run dev</code> ระหว่างนี้ดูแผนตัวอย่างแบบออฟไลน์ได้</p></div>`;
}
function traceHTML(steps, running){
  if (!steps.length && running) return `<ol class="trace"><li class="run"><i class="ic"></i><span>กำลังเริ่ม…</span></li></ol>`;
  return `<ol class="trace">${steps.map((t,i)=>`<li class="${running && i===steps.length-1 ? 'run' : 'done'}"><i class="ic"></i><span>${esc(t)}</span></li>`).join('')}</ol>`;
}
function renderPlanning(){
  const pl = st.planning; if (!pl || st.screen !== 'planning') return;
  const s = pl.setup, err = pl.state === 'error';
  const ph = pl.phase || 'plan';
  let h = `<div class="planning gut"><p class="kicker">${err ? (ph==='plan'?'วางแผนไม่สำเร็จ':'หาตัวเลือกไม่สำเร็จ') : ph==='cand' ? 'Bop กำลังหาร้านและที่เที่ยวมาให้เลือก' : ph==='ask' ? 'รอคุณเลือก' : 'Bop กำลังวางแผน'}</p>
    <h2>${esc(s.title)}</h2>
    <p class="sub">${esc(s.city)} · ${esc(rangeText(s))} · ${s.members.length} คน · ${esc(PACE[s.pace] || '')}</p>`;
  h += traceHTML(pl.steps, !err);
  const got = (pl.days || []).map((d, i) => d ? { d, i } : null).filter(Boolean);
  if (got.length) h += `<div class="pdays"><p class="kicker">พร้อมแล้ว ${got.length} จาก ${s.days} วัน · ดูบนแผนที่ได้เลย</p><ol>${got.map(({ d, i }) => `<li class="${i === pl.newest ? 'new' : ''}"><b>วันที่ ${i+1} พร้อมแล้ว</b><span class="pd-l">${esc(d.label || '')}</span><span class="pd-s">${esc(d.stops.filter(x => !['stay','transit'].includes(x.k)).map(x => x.n.split(' · ')[0]).slice(0, 4).join(' · '))}</span></li>`).join('')}</ol></div>`;
  if (err) {
    h += `<div class="errbox" role="alert"><b>${esc(errText(pl.err))}</b>${keyHelp(pl.err.code)}</div>
      <div class="actions"><button class="btn sm" type="button" data-pl="retry">ลองใหม่</button>${ph!=='plan'?'<button class="btn sm ghost" type="button" data-pl="auto">ให้ Bop จัดให้เลย</button>':''}<button class="btn sm ghost" type="button" data-pl="sample">ใช้แผนตัวอย่าง</button><button class="btn sm ghost" type="button" data-pl="edit">แก้ข้อมูลทริป</button></div>`;
  } else if (ph === 'ask') {
    h += `<p class="elapsed">Bop เจอตัวเลือกแล้ว เลือกสิ่งที่กลุ่มสนใจ แล้ว Bop จะจัดแผนให้</p><div class="actions"><button class="btn sm" type="button" data-pl="reopen">เปิดคำถามอีกครั้ง</button><button class="btn sm ghost" type="button" data-pl="cancel">ยกเลิก</button></div>`;
  } else {
    h += `<p class="elapsed">ผ่านไป <span id="elapsed" class="mono">${Math.round((performance.now()-pl.t0)/1000)}</span> วินาที · ปกติใช้ราว 30–90 วินาที เพราะ Bop ค้นข้อมูลร้านและที่เที่ยวจากเว็บจริง เช็กเงื่อนไขของทุกคน แล้วคำนวณเส้นทาง</p>
      <div class="actions"><button class="btn sm ghost" type="button" data-pl="cancel">ยกเลิก</button></div>`;
  }
  h += `<div class="who"><p class="kicker">เงื่อนไขที่ Bop ต้องผ่าน</p><ul>${s.members.map(m=>`<li><span class="av ${avClass(s,m.id)}" aria-hidden="true">${esc(initials(m.name))}</span><span><b>${esc(m.name)}</b> ${esc(memberWants(m).join(' · ') || 'ไม่มีเงื่อนไขพิเศษ')}</span></li>`).join('')}</ul></div></div>`;
  $('#panelbody').innerHTML = h;
}

/* ---------- header ---------- */
function renderHeader(){
  const s = st.screen === 'planning' && st.planning ? st.planning.setup : st.setup;
  if (!s) return;
  $('#triptitle').textContent = s.title;
  $('#tripmeta').textContent = [rangeText(s), nightsText(s.days), `${s.members.length} คน`, (() => { if (st.screen !== 'planner' || !st.plan) return ''; const S = stayOf(st.plan); return S.booked ? (S.stays.length > 1 ? `พัก ${S.stays.map(x => x.name).join(' → ')}` : `พักที่ ${S.name}`) : S.area ? `พักย่าน${S.area}` : ''; })()].filter(Boolean).join(' · ');
  document.title = `Bop · ${s.title}`;
  if (st.screen !== 'planner' || !st.plan) return;
  const c = ck(view());
  $('#members').innerHTML = s.members.map(m => {
    const r = c.mem && c.mem[m.id], wants = memberWants(m);
    const txt = r ? r.txt : (wants[0] || 'ไม่มีเงื่อนไขพิเศษ');
    return `<div class="mem" title="${esc(wants.join(' · '))}">
      <div class="av ${avClass(s,m.id)}">${esc(initials(m.name))}${r ? `<i class="dotst ${r.ok?'':'bad'}" role="img" aria-label="${r.ok?'ผ่าน':'ไม่ผ่าน'}"></i>` : ''}</div>
      <div class="t"><b>${esc(m.name)}${m.role==='organizer'?'<span class="role"> · คนจัดทริป</span>':''}</b><span class="s ${r && !r.ok ? 'bad' : ''}">${esc(txt)}</span></div>
    </div>`; }).join('');
}

/* ---------- restaurant call tasks ---------- */
const rstat = id => (st.resv[id] && st.resv[id].st) || 'todo';
const fDM = new Intl.DateTimeFormat('th-TH', { day:'numeric', month:'short' });
function dayWhen(di){
  const d = view().days[di]; const dt = d.date ? new Date(d.date + 'T00:00') : dateOf(st.setup, di);
  return `${d.short || d.label}${dt && !isNaN(dt) ? 'ที่ ' + fDM.format(dt) : ''}`;
}
function scriptFor(s,di){
  const r = st.resv[s.id], who = organizer(st.setup).name, n = st.setup.members.length, av = st.setup.members.map(m=>P.avoidOf(m)).filter(Boolean);
  if (r && r.st === 'move') return `สวัสดีครับ/ค่ะ ขอเลื่อนโต๊ะ ${n} ท่าน ชื่อ${who} ${dayWhen(di)} จาก ${r.oldT} น. เป็น ${s.t0} น. ได้ไหม`;
  return `สวัสดีครับ/ค่ะ ขอจองโต๊ะ ${n} ท่าน ${dayWhen(di)} เวลา ${s.t0} น.${s.res.ask?' '+s.res.ask:''}${av.length?` มีคนแพ้/ไม่ทาน: ${[...new Set(av)].join(', ')}`:''} ชื่อผู้จอง ${who} เบอร์ 08x-xxx-xxxx`;
}
function callBox(s,di){
  const r = rstat(s.id);
  if (r === 'done') return `<div class="call done"><span>จองแล้ว${s.res.phone?' · '+esc(s.res.phone):''} · ตอนปรับแผนจะไม่ย้ายร้านนี้</span><button class="linkbtn" type="button" data-resv="todo" data-id="${esc(s.id)}">แก้สถานะ</button></div>`;
  const mv = r === 'move', sid = 'sc-' + String(s.id).replace(/[^\w-]/g,'_');
  return `<div class="call"><div class="call-h">${IC.phone}${mv?'ต้องโทรเลื่อนเวลา':'ต้องโทรจอง'}${s.res.by?` · ควรทำภายใน ${esc(s.res.by)}`:''}</div>
    <div class="call-ph">${s.res.phone ? `โทร <span class="mono">${esc(s.res.phone)}</span>${st.sample?' <span class="hint">เบอร์ตัวอย่าง</span>':''}` : '<span class="hint">Bop ไม่มีเบอร์ร้านที่ยืนยันได้ หาเบอร์จาก Google Maps หรือเพจร้าน</span>'}</div>
    <div class="script" id="${sid}">“${esc(scriptFor(s,di))}”</div>
    ${mv?'':'<div class="call-q">ถามเพิ่ม: มีมัดจำไหม · มาช้าเก็บโต๊ะให้กี่นาที</div>'}
    <div class="call-a"><button class="btn sm" type="button" data-resv="done" data-id="${esc(s.id)}">${mv?'เลื่อนแล้ว':'จองแล้ว'}</button>${mv?'':`<button class="btn sm ghost" type="button" data-resv="full" data-id="${esc(s.id)}">ร้านเต็ม</button>`}<button class="btn sm ghost" type="button" data-copy="${sid}">คัดลอกบทพูด</button></div></div>`;
}
function pendingCalls(p){ const out=[]; p.days.forEach((d,di)=>d.stops.forEach(s=>{ if(s.res && isFood(s) && rstat(s.id)!=='done') out.push({s,di}); })); return out; }
function syncResv(oldP,newP){
  const df = safeDiff(oldP,newP); if (!df) return;
  df.days.forEach((dd,di)=>{
    dd.removed.forEach(s=>{ if(s.res && rstat(s.id)==='done') st.cancels.push({n:s.n, phone:s.res.phone, day:oldP.days[di].label, t:s.t0}); delete st.resv[s.id]; });
    dd.retimed.forEach((o,id)=>{ const n=newP.days[di].stops[idx(newP.days[di],id)]; if(n.res && rstat(id)==='done' && o.t0!==n.t0) st.resv[id]={st:'move',oldT:o.t0}; });
  });
}

/* ---------- bookings ---------- */
function bookingsOf(p){
  const s = st.setup, n = s.members.length;
  if (!st.sample) {
    const rows = [], todo = ['hold','ยังไม่ได้จอง · Bop ยังจองแทนไม่ได้'];
    const BYN = { flight:'เที่ยวบิน', drive:'ขับรถ', bus:'รถทัวร์', train:'รถไฟ', undecided:'การเดินทาง' };
    const a = s.arrive, dp = s.depart, last = p.days[p.days.length-1].label;
    if (a && a.by !== 'drive' && !transportOf('arrive')) rows.push({ n:`${BYN[a.by||'flight']}ขาไป ${a.from || ''} → ${s.city}`, d:`${p.days[0].label}${a.time?` ถึง ${a.time}`:''} · ${n} คน`, p:null, s: a.by==='undecided'?['chg','Bop จะเสนอวิธีเดินทางในแผน']:todo });
    if (dp && dp.by !== 'drive' && !transportOf('depart')) rows.push({ n:`${BYN[dp.by||'flight']}ขากลับ ${s.city} → ${dp.to || ''}`, d:`${last}${dp.time?` ออก ${dp.time}`:''} · ${n} คน`, p:null, s: dp.by==='undecided'?['chg','Bop จะเสนอวิธีเดินทางในแผน']:todo });
    if (s.hasCar) rows.push({ n:'รถส่วนตัว', d:'ใช้ตลอดทริป · ไม่ต้องจอง', p:null, s:['ok','ไม่ต้องจอง'] });
    return rows;
  }
  const f = p.flags || {};
  const rows=[
    { n:'เที่ยวบินขาไป DMK → CNX', d:'ศ. 20 พ.ย. 08:00 · 4 ที่นั่ง · ถือขึ้นเครื่อง', p:6360, s: f.delay?['chg','สายการบินเลื่อนเป็น 09:30 · Bop ปรับแผนวันศุกร์แล้ว']:['ok','ยืนยันแล้ว'] },
    { n:'บ้านไม้ในเมืองเก่า', d:'2 ห้อง × 2 คืน · 20–22 พ.ย.', p:5600, s:['ok','ยืนยันแล้ว · ฝากกระเป๋าได้ตั้งแต่ 09:30'] },
    { n:'รถตู้เหมาพร้อมคนขับ', d: f.half?'ส. 21 พ.ย. ครึ่งวัน 05:00–12:00':'ส. 21 พ.ย. เต็มวัน 05:00–17:00', p: f.half?1000:1800, s: f.half?['chg','แก้การจองแล้ว · ได้คืน ฿800']:['ok','ยืนยันแล้ว'] },
  ];
  if(has(p,'class')) rows.push({ n:'คลาสทำอาหารไทย (มังสวิรัติ)', d:'ส. 21 พ.ย. 11:55 · 4 ที่ · ว่างอีก 6 ที่', p:4000, s:['hold','ถือที่ไว้ 30 นาที · ยังไม่จ่าย รอ approve'], hold:'class' });
  if(has(p,'bankangwat')) rows.push({ n:'เวิร์กช็อปบ้านข้างวัด', d:'อา. 22 พ.ย. 12:35 · 4 ที่', p:800, s:['ok','ยืนยันแล้ว'] });
  rows.push({ n:'เที่ยวบินขากลับ CNX → DMK', d:'อา. 22 พ.ย. 21:15 · 4 ที่นั่ง', p:5960, s:['ok','ยืนยันแล้ว'] });
  return rows;
}

/* chosen flight/bus/train per direction: from plan.flags.transport (agent) or the setup choice */
function transportOf(dir){
  if (!st.plan || st.sample) return null;
  const ft = st.plan.flags && st.plan.flags.transport && st.plan.flags.transport[dir === 'arrive' ? 'go' : 'back'];
  const t = st.setup[dir] || {};
  const options = ((ft && ft.options) || st.tripTopts[dir] || []).filter(Boolean);
  // flags.transport.<dir>.chosen is an option id (API.md); older plans may carry the option object itself
  const c = ft && ft.chosen, chosen = (c && typeof c === 'object' ? c : options.find(o => o.id === c)) || t.choice; if (!chosen) return null;
  return { chosen, options, by: chosen.by || t.by || 'flight' };
}
/* stay: booked by the group, or recommended by Bop (plan.flags.stay, see API.md v10 UI) */
/* booked stays in trip order with nights and check-in/out dates: flags.stay.stays from the server, else from the setup
   (old setups { mode:'booked', name } = one stay for every night) */
function bookedList(p){
  const s = st.setup || {}, f = (p && p.flags && p.flags.stay) || {};
  const list = Array.isArray(f.stays) && f.stays.length ? f.stays : P.bookedStays(s.stay, s.days || 1);
  let night = 0;
  return list.map(x => { const n = Math.max(0, +x.nights || 0), a = dateOf(s, night), b = dateOf(s, night + n); night += n; return { name: x.name, nights: n, a, b }; });
}
function stayOf(p){
  const s = st.setup || {}, f = (p && p.flags && p.flags.stay) || {};
  if (s.stay && s.stay.mode === 'booked') { const stays = bookedList(p); return { booked:true, name: (stays[0] && stays[0].name) || f.name || s.stay.name || '', stays, why: f.why || '' }; }
  return { booked:false, area: f.area || s.hotelArea || '', why: f.why || '', name: f.name || '', options: (f.options || f.examples || []).filter(Boolean) };
}
function staySection(){
  if (!st.plan || st.sample) return '';
  const S = stayOf(st.plan), nights = Math.max(1, (st.setup.days || 1) - 1), n = st.setup.members.length;
  let h = `<div class="sec gut"><h2 class="sh">ที่พัก<small>${nights} คืน · ${n} คน</small></h2>`;
  if (S.booked && S.stays.length) {
    // one row per booked stay: name, nights, check-in → check-out
    const fd = new Intl.DateTimeFormat('th-TH', { weekday:'short', day:'numeric', month:'short' }), many = S.stays.length > 1;
    h += `<p class="fhint">จองไว้แล้ว${many ? ` ${S.stays.length} แห่ง ตามลำดับ` : ''}</p>` + S.stays.map(x => `<div class="row"><b>${esc(x.name)}</b><span class="p">${x.nights ? `${x.nights} คืน` : ''}</span>${x.a && x.b && x.nights ? `<span class="d">${esc(fd.format(x.a))} → ${esc(fd.format(x.b))}</span>` : ''}${many ? '' : '<span class="s ok">ทุกวันเริ่มและจบที่นี่</span>'}</div>`).join('')
      + (many ? '<p class="fhint">วันย้ายที่พัก แผนเริ่มวันจากที่พักเดิม (เช็กเอาต์ ขนกระเป๋าไปด้วย) แล้วจบวันที่ที่พักใหม่</p>' : '');
  }
  else if (S.booked) h += `<div class="row"><b>จองไว้แล้ว: ${esc(S.name)}</b><span class="p"></span><span class="s ok">ทุกวันเริ่มและจบที่นี่</span></div>`;
  else {
    h += `<div class="stay-rec"><p><b>${S.area ? `Bop แนะนำพักย่าน${esc(S.area)}` : 'Bop จะแนะนำย่านที่พักในแผน'}</b></p>${S.why ? `<p class="note">${esc(S.why)}</p>` : ''}</div>`;
    if (S.options.length) h += `<ul class="stay-ex">${S.options.slice(0, 3).map(o => { const u = o.src && safeUrl(o.src.url) || safeUrl(o.url);
      return `<li><span class="se-n">${esc(o.name || '')}${o.area ? ` <i>${esc(o.area)}</i>` : ''}</span><span class="se-p mono">${o.price != null && o.price !== '' ? (typeof o.price === 'number' ? '~' + baht(o.price) : esc(o.price)) + '/คืน' : ''}</span>${u ? `<a class="topt-s" href="${esc(u)}" target="_blank" rel="noopener noreferrer">ราคาประมาณจากเว็บ${IC.ext}</a>` : ''}</li>`; }).join('')}</ul><p class="fhint">ตัวอย่างที่พัก Bop ยังจองแทนไม่ได้</p>`;
  }
  return h + '</div>';
}
function transportSection(){
  const parts = ['arrive','depart'].map(dir => {
    const T = transportOf(dir); if (!T) return '';
    const noun = NOUN[T.by] || 'การเดินทาง', same = o => (o.id && o.id === T.chosen.id) || (o.code && o.code === T.chosen.code && o.dep === T.chosen.dep);
    const others = T.options.filter(o => !same(o)), open = st.tchg[dir];
    return `<div class="tsec"><p class="pi-h">${dir==='arrive'?'ขาไป':'ขากลับ'} · ${noun}</p>
      <ul class="topts">${optRow(T.chosen, { picked:true, attr:'disabled' })}</ul>${fbHTML(dir)}
      ${others.length ? `<button class="linkbtn" type="button" data-tchg="${dir}" aria-expanded="${!!open}">${open?'ซ่อนตัวเลือก':`เปลี่ยน${noun}`}</button>
        ${open ? `<ul class="topts">${others.map(o => optRow(o, { attr:`data-tchange="${dir}" data-code="${esc(o.id || o.code || '')}"` })).join('')}</ul><p class="fhint">เลือกแล้ว Bop จะปรับแผนวัน${dir==='arrive'?'แรก':'สุดท้าย'}ให้เข้ากับเวลาใหม่</p>` : ''}` : ''}
    </div>`; }).join('');
  const live = ['arrive','depart'].some(d => { const T = transportOf(d); return T && T.chosen.checked === 'live'; });
  return parts ? `<div class="sec gut"><h2 class="sh">เดินทางไป–กลับ<small>${live ? 'ราคาสดจากระบบจองเที่ยวบิน' : 'Bop หาให้ · ราคาประมาณจากเว็บ ต้องจองเอง'}</small></h2>${parts}</div>` : '';
}

/* ---------- flight booking (Duffel via /api/flights/*; passenger data stays in memory, sent once to the server) ---------- */
const idempotencyKey = () => globalThis.crypto.randomUUID();
const tdir = dir => dir === 'arrive' ? 'go' : 'back';
function flightOrderOf(dir){ const f = st.plan && st.plan.flags && st.plan.flags.transport && st.plan.flags.transport[tdir(dir)]; return f && f.order || null; }
function fbTotal(F){
  const svc = F.services.reduce((a, x) => { const q = +(F.bags[x.id] || 0); return { amt: a.amt + q * +x.price.amount, thb: a.thb + q * (x.price.thb || 0) }; }, { amt: 0, thb: 0 });
  return { amount: (+F.offer.total.amount + svc.amt).toFixed(2), currency: F.offer.total.currency, thb: (F.offer.total.thb || 0) + svc.thb };
}
const minsLeft = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? null : Math.round((t - Date.now()) / 60000); };
async function fbStart(dir){
  const T = transportOf(dir); if (!T || !T.chosen.offerId) return;
  const F = st.fb[dir] = { state:'load', offerId:T.chosen.offerId, err:null, bags:{}, hold:false, pax:[] };
  renderPanel();
  const ev = await api.flightOffer(T.chosen.offerId);
  if (st.fb[dir] !== F) return;
  if (ev.type !== 'done') { Object.assign(F, { state:'error', err:ev }); renderPanel(); return; }
  const names = (st.setup.members || []).map(m => m.name);
  Object.assign(F, { state:'form', offer:ev.offer, services:ev.services || [], mode:ev.mode, bookable:ev.bookable,
    pax: ev.offer.passengers.map((p, i) => ({ id:p.id, who:names[i] || `ผู้โดยสาร ${i+1}`, title:'', given_name:'', family_name:'', born_on:'', gender:'', email:'', phone_number:'+66' })) });
  renderPanel();
}
function fbMissing(F){
  for (const [i, p] of F.pax.entries()) {
    if (!p.title || !p.gender) return `เลือกคำนำหน้าและเพศของ${p.who}`;
    if (!/^[A-Za-z][A-Za-z '\-]*$/.test(p.given_name.trim()) || !/^[A-Za-z][A-Za-z '\-]*$/.test(p.family_name.trim())) return `ใส่ชื่อ-นามสกุลภาษาอังกฤษตามพาสปอร์ตของ${p.who}`;
    if (!p.born_on) return `ใส่วันเกิดของ${p.who}`;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email.trim())) return `อีเมลของ${p.who}ไม่ถูกต้อง`;
    if (!/^\+\d{8,15}$/.test(p.phone_number.replace(/[\s-]/g, ''))) return `เบอร์ของ${p.who}ต้องเป็นแบบ +66812345678`;
  }
  return '';
}
async function fbOrder(dir){
  const F = st.fb[dir]; if (!F || F.state !== 'confirm') return;
  const tot = fbTotal(F);
  F.state = 'booking'; F.err = null; renderPanel();
  const ev = await api.flightOrder({ offerId:F.offerId, passengers:F.pax.map(({ who, ...p }) => p),
    services:Object.entries(F.bags).filter(([, q]) => +q > 0).map(([id, q]) => ({ id, quantity:+q })), hold:F.hold,
    approved:{ amount:tot.amount, currency:tot.currency }, idempotencyKey:F.idempotencyKey ||= idempotencyKey() });
  if (st.fb[dir] !== F) return;
  if (ev.type !== 'done') { F.state = ev.code === 'price_changed' || ev.code === 'bad_request' ? 'form' : 'error'; F.err = ev; renderPanel(); return; }
  F.pax = []; // drop passenger details once Duffel has them
  const f = st.plan.flags.transport[tdir(dir)]; f.order = ev.order;
  F.state = 'done'; say(`จองแล้ว รหัสการจอง ${ev.order.bookingReference}`); renderPanel();
}
async function fbCancel(dir, confirm){
  const o = flightOrderOf(dir); if (!o) return;
  const F = st.fb[dir] = st.fb[dir] || {};
  F.cstate = 'run'; F.err = null; renderPanel();
  const payload = confirm
    ? { orderId:o.orderId, confirm:F.quote.cancellationId, idempotencyKey:F.cancelIdempotencyKey ||= idempotencyKey() }
    : { orderId:o.orderId };
  const ev = await api.flightCancel(payload);
  if (ev.type !== 'done') { F.cstate = null; F.err = ev; renderPanel(); return; }
  if (!confirm) { F.quote = ev.quote; F.cstate = 'quote'; }
  else { o.cancelledAt = ev.cancelled.confirmedAt || new Date().toISOString(); F.cstate = null; F.quote = null; say('ยกเลิกการจองแล้ว'); }
  renderPanel();
}
const SEL = (dir, i, k, v, opts) => `<select class="in" data-fb="${dir}" data-i="${i}" data-k="${k}"><option value="">-</option>${opts.map(([a, b]) => `<option value="${a}" ${v === a ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
const INP = (dir, i, k, v, lab, type = 'text', extra = '') => `<label class="fld"><span class="lab">${lab}</span><input class="in" type="${type}" data-fb="${dir}" data-i="${i}" data-k="${k}" value="${esc(v)}" ${extra}></label>`;
function fbHTML(dir){
  const T = transportOf(dir); if (!T) return '';
  const o = flightOrderOf(dir), F = st.fb[dir];
  const err = F && F.err ? `<div class="errbox" role="alert"><b>${esc(errText(F.err))}</b></div>` : '';
  if (o) {
    const q = F && F.quote;
    return `<div class="fb">${err}<div class="row"><b>${o.cancelledAt ? 'ยกเลิกแล้ว' : o.type === 'hold' ? 'กันที่นั่งไว้แล้ว (ยังไม่ชำระ)' : 'จองแล้ว'} · รหัสการจอง <span class="mono">${esc(o.bookingReference)}</span></b>
      <span class="p mono">${o.totalTHB != null ? baht(o.totalTHB) : ''}</span><span class="d">${esc(o.currency)} ${esc(o.total)}${o.mode === 'test' ? ' · โหมดทดสอบ ไม่มีการตัดเงินจริง' : ''}${o.payBy ? ` · ชำระก่อน ${esc(new Date(o.payBy).toLocaleString('th-TH'))}` : ''}</span></div>
      ${o.cancelledAt ? '' : q ? `<p class="note">ยกเลิกแล้วได้เงินคืน ${q.refund ? `${esc(q.refund.currency)} ${esc(q.refund.amount)}${q.refund.thb != null ? ` (~${baht(q.refund.thb)})` : ''}` : 'ไม่ระบุ'}</p>
        <div class="call-a"><button class="btn sm" type="button" data-fba="cancel-ok" data-dir="${dir}" ${F.cstate === 'run' ? 'disabled' : ''}>ยืนยันยกเลิก</button><button class="btn sm ghost" type="button" data-fba="cancel-no" data-dir="${dir}">ไม่ยกเลิก</button></div>`
        : `<div class="call-a"><button class="btn sm ghost" type="button" data-fba="cancel" data-dir="${dir}" ${F && F.cstate === 'run' ? 'disabled' : ''}>${F && F.cstate === 'run' ? 'กำลังเช็กเงินคืน…' : 'ยกเลิกการจอง'}</button></div>`}</div>`;
  }
  if (!T.chosen.bookable || !T.chosen.offerId) return '';
  if (!F || F.state === 'error') return `<div class="fb">${err}<button class="btn sm" type="button" data-fba="start" data-dir="${dir}">จองเที่ยวบินนี้${T.chosen.test ? ' (โหมดทดสอบ)' : ''}</button></div>`;
  if (F.state === 'load') return `<p class="note fb">กำลังเช็กราคาและที่นั่งล่าสุด…</p>`;
  const O = F.offer, tot = fbTotal(F), left = minsLeft(O.expiresAt);
  const head = `<div class="fb-h"><b>${esc(O.carrier)} <span class="mono">${esc(O.code)}</span> ${esc(O.from)} → ${esc(O.to)}</b>
    <span class="note">${esc(String(O.departingAt).replace('T', ' ').slice(0, 16))} · ${esc(O.bag)}${O.conditions ? ' · ' + esc(O.conditions) : ''}${left != null ? ` · ราคานี้ถึงอีก ${left} นาที` : ''}</span>
    ${F.mode === 'test' ? '<span class="tag-test">โหมดทดสอบ · ไม่ตัดเงินจริง</span>' : ''}</div>`;
  if (!F.bookable) return `<div class="fb">${head}<p class="note">ยังเปิดจองจริงไม่ได้ ต้องผ่านการยืนยันกับระบบจองก่อน</p></div>`;
  if (F.state === 'confirm' || F.state === 'booking') {
    const bags = F.services.filter(x => +F.bags[x.id] > 0);
    return `<div class="fb">${head}${err}<div class="fb-sum"><p>ผู้โดยสาร: ${F.pax.map(p => esc(`${p.title.toUpperCase()} ${p.given_name} ${p.family_name}`)).join(', ')}</p>
      ${bags.length ? `<p>กระเป๋าเพิ่ม: ${bags.map(x => `${esc(x.label)} ×${F.bags[x.id]}`).join(', ')}</p>` : ''}
      <p class="fb-tot">รวม <b class="mono">${baht(tot.thb)}</b> <span class="note">(${esc(tot.currency)} ${esc(tot.amount)})</span> ${F.hold ? '· กันที่นั่งก่อน ยังไม่ชำระ' : ''}</p></div>
      <div class="call-a"><button class="btn sm" type="button" data-fba="order" data-dir="${dir}" ${F.state === 'booking' ? 'disabled' : ''}>${F.state === 'booking' ? 'กำลังจอง…' : `ยืนยันจอง ${baht(tot.thb)}`}</button><button class="btn sm ghost" type="button" data-fba="edit" data-dir="${dir}" ${F.state === 'booking' ? 'disabled' : ''}>แก้ข้อมูล</button></div></div>`;
  }
  const pax = F.pax.map((p, i) => `<fieldset class="fb-p"><legend>${esc(p.who)}</legend><div class="fb-g">
    <label class="fld"><span class="lab">คำนำหน้า</span>${SEL(dir, i, 'title', p.title, [['mr','Mr'],['ms','Ms'],['mrs','Mrs'],['miss','Miss']])}</label>
    <label class="fld"><span class="lab">เพศ</span>${SEL(dir, i, 'gender', p.gender, [['m','ชาย'],['f','หญิง']])}</label>
    ${INP(dir, i, 'given_name', p.given_name, 'ชื่อ (อังกฤษ)', 'text', 'autocomplete="off"')}${INP(dir, i, 'family_name', p.family_name, 'นามสกุล (อังกฤษ)', 'text', 'autocomplete="off"')}
    ${INP(dir, i, 'born_on', p.born_on, 'วันเกิด', 'date')}${INP(dir, i, 'email', p.email, 'อีเมล', 'email')}${INP(dir, i, 'phone_number', p.phone_number, 'เบอร์โทร', 'tel')}
    </div></fieldset>`).join('');
  const pIdx = new Map(F.pax.map((p, i) => [p.id, p.who]));
  const bags = F.services.length ? `<fieldset class="fb-p"><legend>กระเป๋าโหลดเพิ่ม</legend>${F.services.map(x => `<label class="fb-bag"><span>${esc(x.label)} · ${esc(x.passengerIds.map(id => pIdx.get(id)).filter(Boolean).join(', '))} · ${x.price.thb != null ? baht(x.price.thb) : esc(x.price.currency + ' ' + x.price.amount)}</span>
    <select class="in" data-fbbag="${dir}" data-id="${esc(x.id)}">${Array.from({ length:x.maxQty + 1 }, (_, q) => `<option value="${q}" ${+F.bags[x.id] === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>`).join('')}</fieldset>` : '';
  const hold = O.instantOnly ? '' : `<label class="tog"><input type="checkbox" data-fbhold="${dir}" ${F.hold ? 'checked' : ''}><span class="sw-t" aria-hidden="true"></span>กันที่นั่งไว้ก่อน ยังไม่ชำระ${O.payBy ? ` (ชำระก่อน ${esc(new Date(O.payBy).toLocaleString('th-TH'))})` : ''}</label>`;
  return `<div class="fb">${head}${err}<p class="fhint">ข้อมูลผู้โดยสารส่งตรงไปที่ระบบจองเท่านั้น Bop ไม่เก็บไว้</p>${pax}${bags}${hold}
    <div class="call-a"><button class="btn sm" type="button" data-fba="review" data-dir="${dir}">ตรวจทานก่อนจอง · ${baht(tot.thb)}</button><button class="btn sm ghost" type="button" data-fba="close" data-dir="${dir}">ปิด</button></div></div>`;
}

/* ---------- restaurant research (POST /api/place-info) ---------- */
const isFood = s => s.k === 'food' || (s.k === 'market' && !!s.meal);
const infoKey = s => `${s.id}|${s.n}`;
function infoHTML(s){
  const I = st.info[s.id]; if (!I || !I.open) return '';
  let h = '';
  if (I.state === 'run') h = `<p class="pi-h">Bop กำลังหาข้อมูลร้าน</p>${traceHTML(I.steps, true)}`;
  else if (I.state === 'error') h = `<div class="errbox" role="alert"><b>${esc(errText(I.err))}</b>${keyHelp(I.err.code)}</div><div class="call-a"><button class="btn sm ghost" type="button" data-info-retry="${esc(s.id)}">ลองใหม่</button></div>`;
  else {
    const d = I.data || {};
    const meta = [d.priceRange, d.hours ? 'เปิด ' + d.hours : '', d.phone ? 'โทร ' + d.phone : ''].filter(Boolean);
    const src = (d.sources || []).map(x => ({ t:x.title || x.url, u:safeUrl(x.url) })).filter(x => x.u);
    h = `${d.summary ? `<p class="pi-sum">${esc(d.summary)}</p>` : ''}
      ${meta.length ? `<p class="pi-meta">${meta.map(esc).join(' · ')}</p>` : ''}
      ${(d.dishes||[]).length ? `<p class="pi-h">เมนูแนะนำ</p><ul class="dishes">${d.dishes.map(x=>`<li><span class="dn">${esc(x.name)}${x.veg?'<span class="vg" title="มังสวิรัติ">เจ</span>':''}</span><span class="dp mono">${x.price!=null && x.price!=='' ? '~' + baht(x.price) : '–'}</span>${x.why?`<span class="dw">${esc(x.why)}</span>`:''}</li>`).join('')}</ul>` : ''}
      ${(d.tips||[]).length ? `<p class="pi-h">เคล็ดลับ</p><ul class="tips">${d.tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${src.length ? `<p class="pi-h">แหล่งข้อมูล</p><ul class="srcs">${src.map(x=>`<li><a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">${esc(x.t)}${IC.ext}</a></li>`).join('')}</ul>` : ''}
      <p class="pi-conf ${d.confidence==='web'?'':'est'}">${d.confidence==='web' ? 'ข้อมูลจากเว็บ ราคาอาจเปลี่ยน เช็กกับร้านอีกครั้ง' : 'ประมาณการ: ไม่พบแหล่งข้อมูลที่ยืนยันได้ ใช้เป็นแนวทางเท่านั้น'}${I.ms ? ` · ${(I.ms/1000).toFixed(1)} วินาที` : ''}</p>`;
  }
  return `<div class="pinfo" id="pi-${esc(s.id)}" aria-live="polite" aria-busy="${I.state==='run'}">${h}</div>`;
}
function findStop(id){ for (const d of view().days) { const s = d.stops.find(x => x.id === id); if (s) return s; } return null; }
function updInfo(id){
  const s = findStop(id), el = document.getElementById('pi-' + id), I = st.info[id];
  if (s && el) el.outerHTML = infoHTML(s); else if (I && I.open) renderPanel();
  if (sheetFor === id) renderSheet();
}
/* ---------- place details sheet (side sheet on desktop, bottom sheet on mobile) ---------- */
let sheetFor = null, sheetReturn = null;
function dayIdxOf(id){ return view().days.findIndex(d => d.stops.some(x => x.id === id)); }
function renderSheet(){
  if (!sheetFor) return;
  const s = findStop(sheetFor); if (!s) { closeSheet(true); return; }
  const di = dayIdxOf(s.id), d = view().days[di], I = st.info[s.id];
  const scroller = $('#sheet').querySelector('.sh-body'), top = scroller ? $('#sheet').scrollTop : 0;
  $('#sheet').innerHTML = sheetHTML(s, I, {
    when: `${d ? d.label + ' · ' : ''}${s.t0 === s.t1 ? s.t0 : `${s.t0}–${s.t1}`}`,
    isFood: isFood(s), kcol: kcol(s.k), stayWhy: s.k === 'stay' ? stayOf(view()).why : '', open: openDays(s, di), hours: hoursList(s), starName: s.star ? memberName(st.setup, s.star) : '',
    errText: I && I.err ? errText(I.err) : '', errHTML: I && I.err ? keyHelp(I.err.code) : '',
  });
  $('#sheet').scrollTop = top;
}
function openSheet(id){
  const s = findStop(id); if (!s) return;
  const wasOpen = !!sheetFor;
  sheetFor = id; if (!wasOpen) sheetReturn = document.activeElement;
  const sh = $('#sheet'); sh.hidden = false; sh.scrollTop = 0;
  sh.setAttribute('aria-modal', String(narrow()));
  $('#sheetbg').hidden = !narrow();
  const I = st.info[id];
  if (!I || I.key !== infoKey(s) || I.state === 'error') loadInfo(s, !!(I && I.open)); else renderSheet();
  renderSheet();
  const x = sh.querySelector('.sh-x'); if (x) x.focus({ preventScroll:true });
}
function closeSheet(silent){
  if (!sheetFor && $('#sheet').hidden) return;
  sheetFor = null; $('#sheet').hidden = true; $('#sheetbg').hidden = true; $('#sheet').innerHTML = '';
  if (!silent && sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({ preventScroll:true });
  if (!silent) goBox();
}
$('#sheet').addEventListener('click', e => {
  if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
  const r = e.target.closest('[data-sheet-retry]'); if (r) { const s = findStop(r.dataset.sheetRetry); if (s) { delete st.info[s.id]; loadInfo(s, false); } }
});
$('#sheetbg').addEventListener('click', () => closeSheet());
async function loadInfo(s, open = true){
  const key = infoKey(s);
  if (infoCache.has(key)) { st.info[s.id] = { open, state:'done', key, ...infoCache.get(key) }; return updInfo(s.id); }
  const I = st.info[s.id] = { open, state:'run', steps:[], key };
  updInfo(s.id);
  const ev = await api.placeInfo(st.setup.city, { id:s.id, n:s.n, k:s.k, ll:s.ll, note:s.note }, { onEvent: e => {
    if (e.type === 'step' && st.info[s.id] === I) { I.steps.push(String(e.text||'')); updInfo(s.id); }
  }});
  if (st.info[s.id] !== I) return;
  if (ev.type === 'error') { I.state = 'error'; I.err = ev; }
  else { I.state = 'done'; I.data = ev.info || {}; I.ms = ev.ms; infoCache.set(key, { data:I.data, ms:I.ms }); say('ได้ข้อมูลร้าน ' + s.n + ' แล้ว'); }
  updInfo(s.id);
}

/* ---------- opening days (stop.days / stop.closures, API.md v13) ---------- */
const WD = ['sun','mon','tue','wed','thu','fri','sat'];
const WD_TH = { sun:'อาทิตย์', mon:'จันทร์', tue:'อังคาร', wed:'พุธ', thu:'พฤหัสบดี', fri:'ศุกร์', sat:'เสาร์' };
const wdList = a => (Array.isArray(a) ? a : [a]).map(x => String(x).toLowerCase().slice(0,3)).filter(x => WD_TH[x]);
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function dateOfDay(di){ const d = view().days[di]; const dt = d && d.date ? new Date(d.date + 'T00:00') : dateOf(st.setup, di); return dt && !isNaN(dt) ? dt : null; }
function tripISO(){ const n = view().days.length; return new Set(Array.from({ length:n }, (_, i) => dateOfDay(i)).filter(Boolean).map(isoOf)); }
/* → { text, bad, why } for a stop on day di; text is '' when the place has no day rules */
function openDays(s, di){
  const D = s.days && typeof s.days === 'object' ? s.days : {};
  const only = wdList(D.only || []), closed = wdList(D.closed || []);
  const trip = tripISO();
  const cl = (Array.isArray(s.closures) ? s.closures : []).filter(c => c && c.date && trip.has(String(c.date).slice(0,10)));
  const parts = [];
  if (only.length) parts.push(`เปิดเฉพาะวัน${only.map(x => WD_TH[x]).join(' ')}`);
  else if (closed.length) parts.push(`ปิดวัน${closed.map(x => WD_TH[x]).join(' ')}`);
  cl.forEach(c => parts.push(`ปิด ${fDM.format(new Date(String(c.date).slice(0,10) + 'T00:00'))}${c.why ? ` (${c.why})` : ''}`));
  const dt = dateOfDay(di); let bad = false, why = '';
  if (dt) {
    const wd = WD[dt.getDay()], iso = isoOf(dt), hit = cl.find(c => String(c.date).slice(0,10) === iso);
    if (hit) { bad = true; why = `ปิดวันนั้น${hit.why ? ` (${hit.why})` : ''}`; }
    else if (only.length && !only.includes(wd)) { bad = true; why = `วัน${WD_TH[wd]}ไม่เปิด`; }
    else if (closed.includes(wd)) { bad = true; why = `วัน${WD_TH[wd]}ปิด`; }
  }
  const text = parts.join(' · ');
  return { text, bad, why, label: bad ? why + (only.length ? ` · ${parts[0]}` : '') : text };
}
function hoursList(s){
  const h = s.days && s.days.hours; if (!h) return '';
  if (typeof h === 'string') return h;
  const order = ['mon','tue','wed','thu','fri','sat','sun'];
  const runs = [];                                  // group consecutive days with the same hours: "อังคาร–เสาร์ 08:00–17:00"
  order.forEach(k => { if (!(k in h)) return; const v = h[k] ? String(h[k]).replace('-', '–') : 'ปิด', r = runs[runs.length-1];
    if (r && r.v === v && order.indexOf(r.to) === order.indexOf(k) - 1) r.to = k; else runs.push({ from:k, to:k, v }); });
  return runs.map(r => `${WD_TH[r.from]}${r.to !== r.from ? '–' + WD_TH[r.to] : ''} ${r.v}`).join(' · ');
}
const dayHasClosed = di => (view().days[di]?.stops || []).some(s => openDays(s, di).bad);

/* ---------- panel ---------- */
function stopRow(s,i,df){
  const add = df && df.added.has(s.id), old = df && df.retimed.get(s.id);
  const moved = old && (old.t0!==s.t0 || old.t1!==s.t1);
  const tags=[], flags=[];
  const od = openDays(s, st.day);
  if(od.text || od.bad) tags.push(`<span class="${od.bad?'x':'odays'}">${esc(od.label)}</span>`);
  if(s.open && s.open.includes('-')){ const [o,c]=s.open.split('-'); const ok=toM(s.t0)>=toM(o)&&toM(s.t1)<=toM(c); tags.push(`<span class="${ok?'':'x'}">เปิด ${esc(o)}–${esc(c)}${ok?'':' (ไม่ทัน)'}</span>`); }
  if(s.cost) tags.push(`<span>${baht(s.cost)}/คน</span>`);
  const foodish = isFood(s);
  const diners = st.setup.members.filter(m=>P.avoidOf(m));
  if(s.meal && foodish && diners.length){ const bad = diners.filter(m=>!P.mealFits(s,m)); tags.push(`<span class="${bad.length?'x':'ok'}">${bad.length?`ไม่มีเมนูให้${esc(bad.map(m=>m.name).join(', '))}`:'ทุกคนทานได้'}</span>`); }
  if(s.walkin && foodish && !s.res) tags.push(`<span>walk-in ได้ ไม่ต้องจอง</span>`);
  if(s.res && foodish){ if(rstat(s.id)==='done') tags.push(`<span class="ok">จองโต๊ะแล้ว</span>`); else flags.push(`<span class="flag">${IC.phone}${rstat(s.id)==='move'?'ต้องโทรเลื่อน':'ต้องโทรจอง'}</span>`); }
  if(s.dress) tags.push(`<span>แต่งกายสุภาพ</span>`);
  if(s.outdoor) tags.push(`<span>กลางแจ้ง</span>`);
  if(s.star) flags.push(`<span class="flag star">${IC.sun}${esc(memberName(st.setup, s.star))}อยากได้</span>`);
  const su = s.src && safeUrl(s.src.url);
  if (s.src && s.src.checked === 'web' && su) tags.push(`<span><a class="webchk" href="${esc(su)}" target="_blank" rel="noopener noreferrer" title="${esc(s.src.title || su)}">${IC.ok}ตรวจจากเว็บ</a></span>`);
  else if (s.src && s.src.checked === 'estimate') tags.push(`<span class="est">ประมาณ</span>`);
  const I = st.info[s.id];
  const infoBtn = isFood(s) && !st.preview ? `<button class="linkbtn pi-btn" type="button" data-info="${esc(s.id)}" aria-expanded="${!!(I && I.open)}" aria-controls="pi-${esc(s.id)}">${IC.menu}${I && I.open ? 'ซ่อนเมนูแนะนำ' : 'ดูเมนูแนะนำ'}</button>` : '';
  const tm = s.t0===s.t1 ? `${s.t0}` : `${s.t0}<span>${s.t1}</span>`;
  return `<li class="stop ${st.sel===s.id?'sel':''} ${add?'added':''} ${old?'retimed':''}" data-id="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.n)} ${s.t0} ดูรายละเอียดและรูป" aria-current="${st.sel===s.id?'true':'false'}">
    <div class="tm">${tm}${moved?`<s>${old.t0}</s>`:''}</div>
    <div class="num">${i+1}</div>
    <div><div class="nm">${esc(s.n)}${add?'<span class="new">ใหม่</span>':''}${old&&!moved?'<span class="moved">แก้</span>':''}${moved?'<span class="moved">เลื่อนเวลา</span>':''}</div>
      ${tags.length?`<div class="facts">${tags.join('')}</div>`:''}${flags.length?`<div class="flags">${flags.join('')}</div>`:''}${s.note?`<div class="note">${esc(s.note)}</div>`:''}${infoBtn}${infoHTML(s)}${s.res&&foodish&&!st.preview?callBox(s,st.day):''}</div>
  </li>`;
}
/* optional rest stops on long legs: leg.rest (string | string[]) or leg.breaks */
function restOf(l){
  const r = l.rest || l.breaks; if (!r || (Array.isArray(r) && !r.length)) return '';
  const list = (Array.isArray(r) ? r : [r]).map(x => typeof x === 'string' ? x : (x && (x.n || x.name || x.text)) || '').filter(Boolean);
  return list.length ? `<span class="rest">แวะพัก: ${list.map(esc).join(' · ')}</span>` : '';
}
function legRow(l, a, b){
  const approx = okLL(a) && okLL(b) && routeInfo(a, b, l.m).approx;
  const adj = MODE_ADJ[l.m];
  return `<li class="leg"><div></div><div class="rail"><i class="r-${l.m}"></i></div>
    <div class="tx"><b class="m-${l.m}">${MODE_TH[l.m] || esc(l.m)}</b> <span title="${l.real?esc('เวลาจากเส้นทางจริง (OSRM) '+(adj?adj.why:'')):'ประมาณการ'}">${fmtMin(l.min)} · ${l.km>=100?Math.round(l.km):km(l.km||0)} กม.${approx?' <i class="approx">เส้นทางโดยประมาณ</i>':l.real?' <i class="real">ตามถนนจริง</i>':''}</span>${l.cost?` · ${baht(l.cost)}/คน`:''}${l.why?`<span class="why">${esc(l.why)}</span>`:''}${restOf(l)}</div></li>`;
}
let lineTripTimer = null, lineVoteTimer = null;
function stopLineTimers(){ clearTimeout(lineTripTimer); clearTimeout(lineVoteTimer); lineTripTimer = lineVoteTimer = null; }
function lineSection(){
  if (st.sample) return `<div class="sec gut linebox"><h2 class="sh">LINE<small>โหมดตัวอย่าง · คัดลอกข้อความได้</small></h2><p class="note">เชื่อมกลุ่มและโหวตจริงได้เมื่อใช้แผนออนไลน์</p></div>`;
  const L=st.line;
  if(L.enabled===false) return `<div class="sec gut linebox"><h2 class="sh">LINE<small>ยังไม่เชื่อมบริการ</small></h2><p class="note">การ์ดโหวตในแอปยังใช้ได้ และคัดลอกข้อความไปส่งเองได้</p></div>`;
  if(L.state==='creating') return `<div class="sec gut linebox"><h2 class="sh">LINE</h2><p class="note">กำลังสร้างรหัสเชื่อมกลุ่ม…</p></div>`;
  if(L.error) return `<div class="sec gut linebox"><h2 class="sh">LINE</h2><p class="note bad">${esc(errText(L.error))}</p><button class="btn sm" type="button" data-line="connect">ลองใหม่</button></div>`;
  if(L.linked) return `<div class="sec gut linebox"><h2 class="sh">LINE<small>เชื่อมกลุ่มแล้ว</small></h2><p class="line-ok">Bop ส่งแผน การแจ้งเตือน และการ์ดโหวตเข้ากลุ่มนี้ได้</p><div class="actions"><button class="btn sm ghost" type="button" data-line="tasks">ส่งงานโทรจอง</button><button class="btn sm ghost" type="button" data-line="refresh">เช็กสถานะ</button><button class="linkbtn" type="button" data-line="delete">ลบข้อมูล LINE ของทริป</button></div></div>`;
  if(L.code) return `<div class="sec gut linebox"><h2 class="sh">เชื่อมกลุ่ม LINE<small>รหัสใช้ได้ 30 นาที</small></h2><ol class="line-steps"><li>เพิ่มบัญชีทางการ Bop เข้ากลุ่ม</li><li>ส่งรหัสนี้ในกลุ่ม</li></ol><div class="line-code mono">${esc(L.code)}</div><div class="actions"><button class="btn sm ghost" type="button" data-line="refresh">เช็กว่าเชื่อมแล้วหรือยัง</button><button class="btn sm ghost" type="button" data-copy="line-code">คัดลอกรหัส</button></div><span id="line-code" hidden>${esc(L.code)}</span></div>`;
  return `<div class="sec gut linebox"><h2 class="sh">LINE<small>โหวตกับเพื่อนในกลุ่มจริง</small></h2><p class="note">Bop เก็บ LINE ID ชื่อที่แสดง และบัตรโหวตไว้กับทริป และลบ 30 วันหลังจบทริป</p><button class="btn sm" type="button" data-line="connect">เชื่อมกลุ่ม LINE</button></div>`;
}
async function connectLine(){
  const L=st.line; L.state='creating'; L.error=null; renderPanel();
  const ev=await api.tripCreate({ setup:st.setup, summary:st.summary||'' });
  if(ev.type!=='done'){ Object.assign(L,{state:'idle',error:ev}); renderPanel(); return; }
  Object.assign(L,{state:'code',tripId:ev.tripId,token:ev.organizerToken,code:ev.linkCode,codeExpiresAt:ev.codeExpiresAt,linked:false,error:null});
  renderPanel(); pollLineTrip();
}
async function pollLineTrip(){
  const L=st.line; clearTimeout(lineTripTimer);
  if(!L.tripId||!L.token) return;
  const ev=await api.tripRead(L.tripId,L.token);
  if(ev.type==='done'){
    const becameLinked=!L.linked&&ev.linked; L.linked=!!ev.linked; L.state=L.linked?'linked':'code'; L.error=null;
    if(becameLinked) say('เชื่อมกลุ่ม LINE แล้ว');
  } else L.error=ev;
  if(st.screen==='planner') renderPanel();
  if(!L.linked&&L.codeExpiresAt>Date.now()/1000) lineTripTimer=setTimeout(pollLineTrip,5000);
}
async function postLineText(text){ const L=st.line; if(L.linked&&L.tripId&&L.token) return api.linePost(L.tripId,L.token,text); return null; }
async function postReservationTasks(){
  const tasks=pendingCalls(st.plan).map(({s,di})=>`${organizer(st.setup).name}: โทรจอง ${s.n} ${st.plan.days[di].label} ${s.t0}`);
  await postLineText(tasks.length?`Bop: งานจอง\n${tasks.join('\n')}`:'Bop: ตอนนี้ไม่มีงานโทรจอง'); say('ส่งงานจองเข้ากลุ่ม LINE แล้ว');
}
async function beginLineVote(card){
  const L=st.line; if(!L.linked||!L.tripId||!L.token) return;
  const options=card.opts.map((o,i)=>({ key:o.key||String.fromCharCode(65+i), title:o.title, head:o.head, line:lineOf(o,o.chk.total-card.baseTotal), places:o.places||o.candidates||[] }));
  const ev=await api.lineVoteStart(L.tripId,L.token,{ options, voteReason:card.voteWhy, deadlineMinutes:120 });
  if(st.card!==card||ev.type!=='done') { if(st.card===card&&ev.type!=='done'){ card.lineError=ev; renderCard(); } return; }
  card.lineVote=ev.vote; card.linePosted=ev.posted; renderCard(); pollLineVote(card);
}
async function pollLineVote(card){
  clearTimeout(lineVoteTimer); const L=st.line;
  if(st.card!==card||card.state!=='vote'||!L.tripId||!L.token) return;
  const ev=await api.lineVoteRead(L.tripId,L.token);
  if(st.card!==card) return;
  if(ev.type==='done'&&ev.vote){ card.lineVote=ev.vote; renderCard();
    if(ev.vote.status==='CLOSED'&&ev.vote.winner){ const i=card.opts.findIndex((o,n)=>(o.key||String.fromCharCode(65+n))===ev.vote.winner); if(i>=0){ apply(card.opts[i],card.ms,card.baseTotal); return; } }
  }
  lineVoteTimer=setTimeout(()=>pollLineVote(card),3000);
}

function renderPanel(){
  if (st.screen !== 'planner') return;
  const p=view(), df=curDiff(), c=ck(p);
  if (st.day >= p.days.length) st.day = 0;
  document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected', String(t.dataset.tab===st.tab)));
  const bk=bookingsOf(p), calls=pendingCalls(st.plan), who=organizer(st.setup).name;
  $('#nbook').textContent = calls.length+st.cancels.length ? `${bk.length} · โทร ${calls.length+st.cancels.length}` : bk.length;
  let h='';
  if(st.tab==='plan'){
    if (st.sample) h += `<div class="bopnote gut"><span class="bopav">B</span><p>แผนตัวอย่างแบบออฟไลน์ของกลุ่มตัวอย่าง 4 คน ลองกดเหตุการณ์ในแถบ “เดโมออฟไลน์” ด้านบน${st.health.claude?' หรือพิมพ์สั่ง Bop':''}</p></div>`;
    else if (st.summary) h += `<div class="bopnote gut"><span class="bopav">B</span><p>${esc(st.summary)}</p></div>`;
    h+=`<div class="sec gut"><h2 class="sh">เงื่อนไขที่ต้องผ่าน<span class="cnt">${c.pass}/${c.list.length}</span>${st.preview?'<small>ตัวอย่างแผนใหม่</small>':''}</h2>
      ${c.list.length ? `<div class="meter" aria-hidden="true">${c.list.map(x=>`<i class="${x.ok?'':'bad'}"></i>`).join('')}</div>
      <div class="checks">${c.list.map(x=>`<span class="ck ${x.ok?'':'bad'}">${x.ok?IC.ok:IC.no}<span>${esc(x.l)}${x.who?` <em>· ${esc(x.who)}</em>`:''}</span></span>`).join('')}</div>` : '<p class="note">ยังเช็กเงื่อนไขของแผนนี้ไม่ได้</p>'}
      ${calls.length||st.cancels.length?`<p class="note" style="margin-top:10px">${esc(who)}มีงานโทรหาร้าน ${calls.length+st.cancels.length} งาน · <button class="linkbtn" type="button" data-goto="book">ดูทั้งหมด</button></p>`:''}</div>`;
    h+=`<div class="sec gut" style="padding-top:0"><div class="days" style="--n:${p.days.length}">${p.days.map((d,i)=>{ const s=c.ds[i]||dayStats(d); const ch=df&&df.days[i]&&df.days[i].touched; const cz=dayHasClosed(i); const wa=wxFor(i);
      return `<button class="day" type="button" data-day="${i}" aria-pressed="${i===st.day}"><b>${esc(d.label)}${ch?'<i class="chg" title="มีการแก้"></i>':''}${cz?'<i class="czd" role="img" aria-label="มีที่ปิดวันนี้" title="มีที่ปิดวันนี้"></i>':''}${wa?`<i class="wxd ${wa.level}" role="img" aria-label="${esc(wxLine(wa))}" title="${esc(wxLine(wa))}"></i>`:''}</b><span class="mono">เดิน ${km(s.walk)} กม. · ${baht(s.cost)}</span></button>`; }).join('')}</div></div>`;
    h+=wxStrip();
    const d=p.days[st.day], dd=df&&df.days[st.day];
    h+=`<div class="gut" style="padding-bottom:8px">`;
    if(dd && dd.removed.length) h+=`<div class="removed">ตัดออก: ${dd.removed.map(s=>`<s>${esc(s.n)}</s>`).join(', ')}</div>`;
    h+=`<ol class="tl">`;
    d.stops.forEach((s,i)=>{ if(s.leg && i) h+=legRow(s.leg, d.stops[i-1].ll, s.ll); h+=stopRow(s,i,dd); });
    h+=`</ol></div>`;
    h+=`<div class="foot gut">เวลาเดินทางคำนวณจากเส้นทางจริงบนถนน (OSRM / OpenStreetMap) บวกเวลารอตามประเภทรถ ${st.sample?'ชื่อร้าน ราคา และเหตุการณ์ในเดโมเป็นข้อมูลตัวอย่าง':'ชื่อร้านและราคามาจาก Bop ควรเช็กกับร้านก่อนไปจริง'}</div>`;
  } else {
    h+=lineSection();
    const doneR=[]; st.plan.days.forEach((d,di)=>d.stops.forEach(s=>{ if(s.res && isFood(s) && rstat(s.id)==='done') doneR.push({s,di}); }));
    h+=transportSection();
    h+=staySection();
    h+=`<div class="sec gut"><h2 class="sh">ร้านอาหาร<small>ไม่มีระบบจองกลาง Bop เตรียมบทพูดให้ ${esc(who)}โทรเอง</small></h2><div class="rows">`;
    h+=st.cancels.map(c=>`<div class="call cancel"><div class="call-h">ต้องโทรยกเลิกการจอง · ${esc(c.n)}</div><div class="call-ph">โทร <span class="mono">${esc(c.phone)}</span> <span class="hint">${esc(c.day)} ${esc(c.t)} · แผนใหม่ไม่ได้ไปร้านนี้แล้ว</span></div><div class="call-a"><button class="btn sm" type="button" data-cancel="${esc(c.n)}">ยกเลิกแล้ว</button></div></div>`).join('');
    h+=[...calls, ...doneR].map(({s,di})=>`<div class="rst"><div class="rst-h"><b>${esc(s.n)}</b><span class="note">${esc(st.plan.days[di].label)} ${s.t0}</span></div>${callBox(s,di)}</div>`).join('');
    if(!calls.length && !doneR.length && !st.cancels.length) h+=`<p class="note">ไม่มีร้านที่ต้องจอง</p>`;
    h+=`</div></div>`;
    const tot=bk.reduce((a,b)=>a+(b.p||0),0);
    h+=`<div class="sec gut" style="padding-top:0"><h2 class="sh">${st.sample?'เดินทางและที่พัก':'เดินทาง'}<small>${st.sample?'จองผ่าน sandbox · เช็กราคาและที่ว่างล่าสุด 10:02':'จากข้อมูลทริป · Bop ยังไม่ได้จองให้'}</small></h2><div class="rows">${bk.map(b=>{
      const ap = b.hold && st.approved[b.hold];
      return `<div class="row"><b>${esc(b.n)}</b><span class="p">${b.p!=null?baht(b.p):''}</span><span class="d">${esc(b.d)}</span>
      <span class="s ${ap?'ok':b.s[0]}">${ap?'อนุมัติแล้ว · ตัดเงิน sandbox':esc(b.s[1])}</span>
      ${b.hold&&!ap?`<div style="grid-column:1/-1;margin-top:6px"><button class="btn sm" type="button" data-approve="${b.hold}">อนุมัติการจองนี้</button></div>`:''}</div>`; }).join('')}</div>
      ${tot?`<div class="total"><span>รวมทั้งกลุ่ม</span><b class="mono">${baht(tot)}</b></div>`:''}</div>`;
  }
  $('#panelbody').innerHTML=h;
}

/* ---------- map (MapLibre GL + OpenFreeMap tiles + OSRM road geometry) ---------- */
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkMQ.matches;
const styleUrl = () => `https://tiles.openfreemap.org/styles/${isDark() ? 'dark' : 'positron'}`;
const MODE_VAR = { walk:'--m-walk', red:'--m-red', car:'--m-car', van:'--m-van', transit:'--m-transit', own:'--m-own' };
const EMPTY = { type:'FeatureCollection', features:[] };
let map = null, mapReady = false, lastStyle = styleUrl();

function ensureMap(){
  if (map) return;
  map = new maplibregl.Map({
    container:'map', style:styleUrl(), center:[98.985, 18.79], zoom:12,
    attributionControl:{ compact:true, customAttribution:'เส้นทาง <a href="https://project-osrm.org" target="_blank" rel="noopener">OSRM</a> · <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener">Valhalla</a>' },
    dragRotate:false, pitchWithRotate:false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit:'metric' }), 'bottom-right');
  map.touchZoomRotate.disableRotation();
  map.on('style.load', () => {
    map.getStyle().layers.forEach(l => {
      if (l.type === 'symbol' && l.layout && l.layout['text-field']) {
        try { map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get','name:th'], ['get','name']]); } catch (_) {}
      }
    });
    map.addSource('legs', { type:'geojson', data:EMPTY });
    map.addSource('ghost', { type:'geojson', data:EMPTY });
    map.addLayer({ id:'ghost', type:'line', source:'ghost', layout:{'line-cap':'round','line-join':'round'},
      paint:{ 'line-color':cssVar('--bad'), 'line-width':3, 'line-opacity':.7, 'line-dasharray':[1.5,1.5] } });
    const exact = ['!=',['get','approx'],1];
    map.addLayer({ id:'legs-case', type:'line', source:'legs', filter:exact, layout:{'line-cap':'round','line-join':'round'},
      paint:{ 'line-color':cssVar('--surface'), 'line-width':['match',['get','m'],'walk',6,'van',9,8], 'line-opacity':.95 } });
    map.addLayer({ id:'legs-walk', type:'line', source:'legs', filter:['all',exact,['==',['get','m'],'walk']], layout:{'line-cap':'round','line-join':'round'},
      paint:{ 'line-color':['get','c'], 'line-width':3, 'line-dasharray':[0.2,2] } });
    map.addLayer({ id:'legs-transit', type:'line', source:'legs', filter:['all',exact,['==',['get','m'],'transit']], layout:{'line-cap':'butt','line-join':'round'},
      paint:{ 'line-color':['get','c'], 'line-width':4.2, 'line-dasharray':[2.2,1.2] } });
    map.addLayer({ id:'legs-ride', type:'line', source:'legs', filter:['all',exact,['!',['in',['get','m'],['literal',['walk','transit']]]]], layout:{'line-cap':'round','line-join':'round'},
      paint:{ 'line-color':['get','c'], 'line-width':['match',['get','m'],'van',5,4.2] } });
    map.addLayer({ id:'legs-approx', type:'line', source:'legs', filter:['==',['get','approx'],1], layout:{'line-cap':'butt','line-join':'round'},
      paint:{ 'line-color':['get','c'], 'line-width':3.2, 'line-opacity':.55, 'line-dasharray':[1,1.8] } });
    mapReady = true;
    if (st.screen === 'planner') goBox(); else drawMap();
  });
  map.on('moveend', () => { if (mapReady) declutter(); });
  const tip = new maplibregl.Popup({ closeButton:false, closeOnClick:false, className:'approx-tip', offset:8 });
  map.on('mousemove', 'legs-approx', e => { map.getCanvas().style.cursor = 'help'; tip.setLngLat(e.lngLat).setText('เส้นทางโดยประมาณ').addTo(map); });
  map.on('mouseleave', 'legs-approx', () => { map.getCanvas().style.cursor = ''; tip.remove(); });
  new ResizeObserver(() => { map.resize(); }).observe($('.mapwrap'));
}
const recolor = () => {
  if (!map) return;
  if (styleUrl() !== lastStyle) { lastStyle = styleUrl(); mapReady = false; map.setStyle(lastStyle); return; }
  if (!mapReady) return;
  map.setPaintProperty('legs-case','line-color',cssVar('--surface'));
  map.setPaintProperty('ghost','line-color',cssVar('--bad'));
  drawMap();
};
darkMQ.addEventListener('change', recolor);
new MutationObserver(recolor).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
function flyToCity(city){
  const ll = CITY_LL[city] || (cityTuple(city) && cityTuple(city)[0]); if (!map || !ll) return;
  htmlMarkers.forEach(m => m.remove()); htmlMarkers = [];
  if (mapReady) { map.getSource('legs').setData(EMPTY); map.getSource('ghost').setData(EMPTY); }
  map.easeTo({ center:[ll[1], ll[0]], zoom:11.5, duration: reduced ? 0 : 900 });
}

/* road geometry: src/routes.json, then the routes the server returns with every plan (always complete, see API.md v8).
   No browser-side routing calls; a missing leg is drawn as an approximate straight line. */
function routeInfo(a, b, m) {
  const k = legKey(a,b,m);
  if (ROUTES[k]) return { geom: ROUTES[k].geom, approx: !!ROUTES[k].approx };
  if (EXTRA[k]) {                                    // tolerate [lat,lng] geometry
    const g = EXTRA[k].geom, f = g[0];
    const flip = f && Math.abs(f[1]-a[0]) + Math.abs(f[0]-a[1]) > Math.abs(f[0]-a[0]) + Math.abs(f[1]-a[1]);
    return { geom: flip ? g.map(c => [c[1], c[0]]) : g, approx: !!EXTRA[k].approx };
  }
  return { geom: [[a[1],a[0]],[b[1],b[0]]], approx: true };
}
const routeFor = (a, b, m) => routeInfo(a, b, m).geom;
const midOf = coords => {
  let total = 0; const seg = [];
  for (let i = 1; i < coords.length; i++) { const d = Math.hypot(coords[i][0]-coords[i-1][0], coords[i][1]-coords[i-1][1]); seg.push(d); total += d; }
  let acc = 0;
  for (let i = 0; i < seg.length; i++) { if (acc + seg[i] >= total/2) { const t = seg[i] ? (total/2-acc)/seg[i] : 0; return [coords[i][0]+(coords[i+1][0]-coords[i][0])*t, coords[i][1]+(coords[i+1][1]-coords[i][1])*t]; } acc += seg[i]; }
  return coords[0];
};

let htmlMarkers = [];
function el(cls, html) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; }
/* what the map shows: the plan in the planner, or the days streamed so far while planning */
function mapPlan(){
  if (st.screen === 'planner' && st.plan) return view();
  const pl = st.planning;
  if (st.screen === 'planning' && pl && pl.days && pl.days.some(Boolean)) return { flags:{}, days: pl.days.map(d => d || { label:'', stops:[] }) };
  return null;
}
function fitPlanning(){
  const p = mapPlan(); if (!mapReady || !p || st.screen !== 'planning') return;
  try {
    const pts = p.days.flatMap(d => d.stops.map(s => s.ll)).filter(okLL); if (!pts.length) return;
    const b = new maplibregl.LngLatBounds(); pts.forEach(ll => b.extend([ll[1], ll[0]]));
    map.fitBounds(b, { padding:50, maxZoom:14, duration: reduced ? 0 : 700 });
  } catch (e) { console.warn('fitPlanning', e); }
}
function drawMap() {
  const p = mapPlan();
  if (!mapReady || !p) return;
  htmlMarkers.forEach(m => m.remove()); htmlMarkers = [];
  const planning = st.screen === 'planning', ALL = planning || st.all;
  const df = planning ? null : curDiff();
  if (!p.days[st.day]) st.day = 0;
  const daysToDraw = ALL ? p.days.map((_,i) => i) : [st.day];
  const legs = [], ghosts = [];
  const addMarker = (elm, ll, opt) => { try { htmlMarkers.push(new maplibregl.Marker({ element:elm, ...opt }).setLngLat([ll[1], ll[0]]).addTo(map)); } catch (e) { console.warn('marker', e); } };
  let n = 0;

  try {
    if (!ALL && df && df.days[st.day]) {
      const dd = df.days[st.day], old = dd.old.stops;
      old.forEach((s,j) => {
        if (!dd.removed.includes(s) || !okLL(s.ll)) return;
        if (old[j-1] && okLL(old[j-1].ll)) ghosts.push([[old[j-1].ll[1],old[j-1].ll[0]],[s.ll[1],s.ll[0]]]);
        if (old[j+1] && okLL(old[j+1].ll) && !dd.removed.includes(old[j+1])) ghosts.push([[s.ll[1],s.ll[0]],[old[j+1].ll[1],old[j+1].ll[0]]]);
        addMarker(el('mkr ghost', `<span class="dotm">×</span><span class="lab">${esc(s.n)} · ตัดออก</span>`), s.ll, { anchor:'left', offset:[-11,0] });
      });
    }
  } catch (e) { console.warn('ghosts', e); }

  daysToDraw.forEach(di => {
    const stops = (p.days[di] && p.days[di].stops) || [], dd = df && df.days[di];
    let prev = null;                                   // previous stop with a valid position
    stops.forEach((s,i) => {
      try {
        if (!okLL(s.ll)) return;
        const a = prev && prev.ll; prev = s;
        if (!i || !s.leg || !a) return;
        const b = s.ll;
        if (a[0] === b[0] && a[1] === b[1]) return;
        const ri = routeInfo(a, b, s.leg.m), coords = ri.geom;
        if (!coords || coords.length < 2) return;
        legs.push({ type:'Feature', properties:{ m:String(s.leg.m || 'car'), c:cssVar(MODE_VAR[s.leg.m] || '--m-car'), approx: ri.approx ? 1 : 0 }, geometry:{ type:'LineString', coordinates:coords } });
        if (!ALL && s.leg.km >= 1.5) addMarker(el(`legpill m-${esc(s.leg.m)}`, `${MODE_TH[s.leg.m] || ''} ${fmtMin(+s.leg.min || 0)}`), midOf(coords).slice().reverse(), {});
      } catch (e) { console.warn('leg', s && s.id, e); }
    });
    const groups = new Map();
    stops.forEach((s,i) => { if (!okLL(s.ll)) return; const k = s.ll.join(','); if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ s, i }); });
    groups.forEach(g => {
      try {
        const s = g[0].s, nm = String(s.n || '');
        const sel = g.some(x => x.s.id === st.sel), add = dd && g.some(x => dd.added.has(x.s.id));
        const name = s.k === 'stay' ? 'ที่พัก' : s.k === 'transit' ? (nm.split(' · ')[0] || 'สนามบิน') : nm.split(' · ')[0].replace(/\s*\(.*\)/, '');
        const nums = g.length > 1 && !ALL ? ` (${g.map(x => x.i+1).join(', ')})` : '';
        const showLabel = !ALL || s.star || sel;
        const m = el(`mkr ${ALL ? 'small' : ''} ${sel ? 'sel' : ''} ${add ? 'added' : ''} ${(planning ? di === st.planning.newest : st.reveal) ? 'reveal' : ''}`,
          `<span class="dotm k-${esc(s.k)}" style="animation-delay:${(n++)*45}ms">${ALL ? '' : g[0].i+1}</span>${showLabel ? `<span class="lab">${esc(name + nums)}</span>` : ''}`);
        m.tabIndex = 0; m.setAttribute('role','button'); m.setAttribute('aria-label', `${nm} ดูรายละเอียด`);
        const go = () => { if (!planning) onMarker(s.id, di); };
        m.addEventListener('click', e => { e.stopPropagation(); go(); });
        m.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        addMarker(m, s.ll, { anchor:'left', offset:[-12,0] });
      } catch (e) { console.warn('marker group', e); }
    });
  });

  try { renderLegend(p); } catch (_) {}
  try {
    map.getSource('legs').setData({ type:'FeatureCollection', features:legs });
    map.getSource('ghost').setData({ type:'FeatureCollection', features:ghosts.map(c => ({ type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates:c } })) });
  } catch (e) { console.warn('setData', e); }
  declutter();
}

function renderLegend(p){
  const used = new Set(p.days.flatMap(d => d.stops.map(s => s.leg && s.leg.m).filter(Boolean)));
  const ms = MODE_ORDER.filter(m => used.has(m)).concat([...used].filter(m => !MODE_ORDER.includes(m)));
  $('.legend').innerHTML = ms.map(m => `<span><i class="sw ${esc(m)}"></i>${esc(MODE_TH[m] || m)}</span>`).join('');
  $('.legend').hidden = !ms.length;
}
/* hide labels/pills that collide on screen; selected stop wins, then route order */
function declutter() {
  const box = $('#map').getBoundingClientRect(), taken = [];
  const hit = (a,b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const items = htmlMarkers.map(m => m.getElement());
  items.forEach(e => e.querySelectorAll('.dotm').forEach(d => taken.push(d.getBoundingClientRect())));
  const ordered = [...items.filter(e => e.classList.contains('sel')), ...items.filter(e => !e.classList.contains('sel'))];
  ordered.forEach(e => {
    const t = e.classList.contains('legpill') ? e : e.querySelector('.lab');
    if (!t) return;
    t.style.visibility = '';
    const r = t.getBoundingClientRect();
    const out = r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom;
    if (!e.classList.contains('sel') && (out || taken.some(q => hit(q, r)))) { t.style.visibility = 'hidden'; return; }
    taken.push(r);
  });
}

function goBox() {
  drawMap();
  if (!mapReady || st.screen !== 'planner' || !st.plan) return;
  try {
    const p = view(), df = curDiff(), day = p.days[st.day];
    const days = st.all ? p.days : [day];
    let pts = days.flatMap(d => d.stops.map(s => s.ll));
    if (!st.all && df && df.days[st.day]) pts = pts.concat(df.days[st.day].removed.map(s => s.ll));
    pts = pts.filter(okLL);
    if (!pts.length) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach(ll => b.extend([ll[1], ll[0]]));
    days.forEach(d => { let prev = null; d.stops.forEach(s => {          // long legs: fit the whole road, not only its ends
      if (!okLL(s.ll)) return;
      if (prev && s.leg && (s.leg.km || 0) >= 100) routeFor(prev.ll, s.ll, s.leg.m).forEach(c => { if (isFinite(c[0]) && isFinite(c[1])) b.extend(c); });
      prev = s; }); });
    const wide = matchMedia('(min-width: 861px)').matches;
    const right = (!$('#dock').hidden && wide) ? 410 : 60;
    const left = (!$('#sheet').hidden && wide) ? 430 : 60;
    const padding = { top:70, bottom:60, left, right };
    const sel = st.sel && day && day.stops.find(s => s.id === st.sel && okLL(s.ll));
    if (sel && !st.all) { map.easeTo({ center:[sel.ll[1], sel.ll[0]], zoom:Math.max(map.getZoom(), 15), padding, duration: reduced ? 0 : 600 }); return; }
    const box = map.getContainer().getBoundingClientRect();
    if (box.width < padding.left + padding.right + 40 || box.height < padding.top + padding.bottom + 40) { map.fitBounds(b, { padding:20, maxZoom:15, duration:0 }); return; }
    map.fitBounds(b, { padding, maxZoom:15, duration: reduced ? 0 : 700 });
  } catch (e) { console.warn('goBox', e); }
}

function onMarker(id, di) {
  if (st.all) { st.all = false; st.day = di; syncViewBtns(); }
  st.sel = id; st.tab = 'plan'; renderPanel(); openSheet(id); goBox();
  const li = document.querySelector(`.stop[data-id="${CSS.escape(id)}"]`);
  if (li) li.scrollIntoView({ block:'nearest', behavior: reduced ? 'auto' : 'smooth' });
}

/* ---------- replan card (offline scenarios and the live agent share one shape) ---------- */
function showDock(on){ $('#dock').hidden=!on; }
function statBlock(o){
  const c=o.chk, base=ck(st.plan);
  const dc=c.total-base.total;
  const pct=o.diff && o.diff.total ? Math.round(o.diff.untouched/o.diff.total*100) : null;
  return `<div class="stats">
    ${o.diff?`<div class="stat"><span>จุดที่ถูกแก้</span><b>${o.diff.changed} จาก ${o.diff.total}</b></div>`:''}
    ${pct!=null?`<div class="stat"><span>ไม่ถูกแตะ (minimal change)</span><b>${pct}%</b></div>`:''}
    <div class="stat"><span>ค่าใช้จ่ายต่อคน</span><b class="${dc>0?'up':dc<0?'down':''}">${sbaht(dc)}</b></div>
    ${c.list.length?`<div class="stat"><span>เงื่อนไขผ่าน</span><b class="${c.pass<c.list.length?'up':''}">${c.pass}/${c.list.length}</b></div>`:''}
  </div>`;
}
function renderCard(){
  const c=st.card; if(!c){ showDock(false); return; }
  showDock(true);
  let h = `<div class="card"><div class="src"><span class="bopav">B</span>${esc(c.src)}${c.kind==='scen'?'<span class="demo-tag">เดโมออฟไลน์</span>':''}</div><h3>${esc(c.title)}</h3>`;
  if(c.state==='na' || c.state==='unknown'){
    h+=`<p class="lead">${esc(c.msg)}</p>${c.help||''}<div class="actions"><button class="btn sm ghost" type="button" data-act="close">ปิด</button></div></div>`;
    $('#dock').innerHTML=h; return;
  }
  h += traceHTML(c.steps, c.state==='run');
  if(c.state==='run' && c.kind==='agent') h+=`<div class="actions"><button class="btn sm ghost" type="button" data-act="abort">ยกเลิก</button></div>`;
  if(c.state==='error'){
    h+=`<div class="errbox" role="alert"><b>${esc(errText(c.err))}</b>${keyHelp(c.err.code)}</div><div class="actions"><button class="btn sm" type="button" data-act="retry">ลองใหม่</button>${!st.sample&&(c.err.code==='no_key'||c.err.code==='offline')?'<button class="btn sm ghost" type="button" data-act="sample">ใช้แผนตัวอย่าง</button>':''}<button class="btn sm ghost" type="button" data-act="close">ปิด</button></div>`;
  }
  if(c.state==='vote'){
    const base=ck(st.plan).total;
    if(c.summary) h+=`<p class="lead">${esc(c.summary)}</p>`;
    if(c.voteWhy) h+=`<div class="why-vote">${esc(c.voteWhy)}</div>`;
    h+=`<div class="opts" role="radiogroup" aria-label="ทางเลือก">${c.opts.map((o,i)=>{
      const places=(o.places||o.candidates||[]).filter(Boolean);
      const fails=o.chk.list.filter(x=>!x.ok); const dc=o.chk.total-base;
      return `<button class="opt" type="button" role="radio" data-pick="${i}" aria-checked="${c.pick===i}" aria-pressed="${c.pick===i}"><b>${esc(o.title)}</b><span class="h">${esc(o.head||'')}</span>
        <span class="f"><span class="tag mono">${sbaht(dc)}/คน</span>${o.diff?`<span class="tag">แก้ ${o.diff.changed} จุด</span>`:''}${fails.length?fails.map(f=>`<span class="tag bad">✕ ${esc(f.l)}${f.who?' · '+esc(f.who):''}</span>`).join(''):o.chk.list.length?'<span class="tag ok">ผ่านทุกเงื่อนไข</span>':''}</span></button>${places.length?`<div class="cands mini" aria-label="ที่ที่ Bop เสนอในแผน ${esc(o.key||'')}">${places.map(x=>candCard(x,null,null)).join('')}</div>`:''}`; }).join('')}</div>`;
    const mem = st.setup.members;
    if (c.simVotes) {
      h+=`<div class="votes">โหวตในกลุ่ม LINE ${c.votes.map(id=>`<span class="vote"><span class="av ${avClass(st.setup,id)}">${esc(initials(memberName(st.setup,id)))}</span>${esc(c.simVotes[id])}</span>`).join('')}${c.votes.length<Object.keys(c.simVotes).length?'<span>รอโหวต…</span>':''}</div>`;
      if(c.votes.length===Object.keys(c.simVotes).length){ const tally={}; Object.values(c.simVotes).forEach(v=>tally[v]=(tally[v]||0)+1); const top=Math.max(...Object.values(tally)); const tie=Object.values(tally).filter(v=>v===top).length>1;
        h+=`<p class="lead" style="margin-top:8px">${tie?`เสมอ ${Object.values(tally).join('–')} ${esc(organizer(st.setup).name)}เป็นคนตัดสิน`:'ได้ผลโหวตแล้ว'}</p>`; }
    } else if(c.lineVote) {
      const ballots=Object.values(c.lineVote.ballots||{}), voted=new Set(ballots.map(v=>v.memberId).filter(Boolean)), missing=mem.filter(m=>!voted.has(m.id));
      h+=`<div class="votes">${c.linePosted?'ส่งให้กลุ่มโหวตใน LINE แล้ว':'การ์ด LINE ส่งไม่สำเร็จ คัดลอกข้อความแทน'} ${ballots.map(v=>`<span class="vote"><span class="av">${esc(initials(v.displayName||'?'))}</span>${esc(v.option)}</span>`).join('')}${missing.length?`<span>รอ ${missing.map(m=>esc(m.name)).join(', ')}</span>`:''}</div>`;
      if(c.lineVote.status==='TIE') h+=`<p class="lead" style="margin-top:8px">ผลโหวตเสมอ ${esc(organizer(st.setup).name)}เป็นคนตัดสิน</p>`;
      if(c.lineError) h+=`<p class="note bad">${esc(errText(c.lineError))}</p>`;
    } else {
      h+=`<div class="votes">${st.line.enabled===false?'คัดลอกข้อความไปส่งใน LINE':'ยังไม่ได้เชื่อมกลุ่ม LINE'} ${mem.map(m=>`<span class="av ${avClass(st.setup,m.id)}" title="${esc(m.name)}">${esc(initials(m.name))}</span>`).join('')}<span>${esc(organizer(st.setup).name)}เลือกแทนกลุ่มได้</span></div>`;
    }
    const copyLine=lineOf(c.opts[c.pick],c.opts[c.pick].chk.total-base);
    h+=`<div class="actions">${c.opts.map((o,i)=>`<button class="btn sm ${c.pick===i?'':'ghost'}" type="button" data-choose="${i}">ใช้แผน ${esc(o.key||String.fromCharCode(65+i))}</button>`).join('')}${!c.linePosted&&copyLine?'<button class="btn sm ghost" type="button" data-copy="line-vote-copy">คัดลอกข้อความ LINE</button>':''}<button class="btn sm ghost" type="button" data-act="cancel">ยกเลิก</button></div>${copyLine?`<span id="line-vote-copy" hidden>${esc(copyLine)}</span>`:''}`;
    h+=`<div class="bubble-h">ตัวเลือกที่กดอยู่แสดงบนแผนที่และในแผนด้านซ้าย</div>`;
  }
  if(c.state==='done'){
    const o=c.opt;
    h+=`<p class="lead" style="margin-top:10px"><b>${esc(o.title)}</b>${o.head?`<br>${esc(o.head)}`:''}</p>`;
    if(c.summary && c.summary!==o.head) h+=`<p class="lead">${esc(c.summary)}</p>`;
    if(c.repaired) h+=`<p class="note">Bop แก้แผนซ้ำอัตโนมัติให้ผ่านเงื่อนไข</p>`;
    h+=statBlock(o);
    h+=`<div class="stat" style="border-bottom:1px solid var(--line)"><span>${c.kind==='scen'?'เวลาปรับแผน (จำลอง)':'Bop ใช้เวลา'}</span><b>${(c.ms/1000).toFixed(1)} วินาที</b></div>`;
    const line=lineOf(o, o.chk.total-c.baseTotal);
    if(line) h+=`<div class="bubble-h">ข้อความที่ส่งเข้ากลุ่ม LINE</div><div class="chat"><span class="bopav">B</span><div class="bubble">${esc(line)}</div></div>`;
    h+=`<div class="actions"><button class="btn sm ghost" type="button" data-act="undo">ย้อนกลับ</button><button class="btn sm" type="button" data-act="close">เรียบร้อย</button></div>`;
  }
  h+=`</div>`;
  $('#dock').innerHTML=h;
}

/* offline demo scenarios (only on the built-in sample plan) */
async function runScen(key){
  if(st.busy || !st.sample) return;
  const sc=SCEN[key]; if(!sc) return;
  st.preview=null; st.day=sc.day; st.all=false; st.sel=null; st.tab='plan'; syncViewBtns();
  const base={kind:'scen', key, src:sc.src, title:sc.title, steps:[]};
  if(!has(st.plan,sc.need) || (sc.applicable && !sc.applicable(st.plan))){ st.card={...base,state:'na',msg:sc.na}; renderAll(); return; }
  st.busy=true; const t0=performance.now();
  st.card={...base,state:'run'}; renderAll(); revealDock();
  for(const t of sc.trace){ st.card.steps.push(t); say(t); renderCard(); await sleep(reduced?120:430); }
  const baseTotal=ck(st.plan).total;
  const opts=sc.options.map(o=>{ const p=clone(st.plan); o.build(p); schedule(p, ROUTES); return {...o, plan:p, chk:ck(p), diff:safeDiff(st.plan,p)}; });
  if(sc.vote){
    st.card={...st.card,state:'vote',opts,pick:0,votes:[],t0,baseTotal,voteWhy:sc.vote.why,simVotes:sc.vote.votes};
    st.preview=opts[0].plan; renderAll();
    for(const id of Object.keys(sc.vote.votes)){ await sleep(reduced?80:550); if(!st.card||st.card.state!=='vote') break; st.card.votes.push(id); renderCard(); }
    st.busy=false; return;
  }
  apply(opts[0], performance.now()-t0, baseTotal);
  st.busy=false;
}

/* live agent: POST /api/replan */
async function agentReplan(cmd){
  if(st.busy) return;
  if (st.ctl) st.ctl.abort();
  const ctl=new AbortController(); st.ctl=ctl; st.busy=true;
  st.preview=null; st.sel=null; st.tab='plan';
  const t0=performance.now();
  const card = st.card = { kind:'agent', state:'run', src:`คำสั่งจาก${organizer(st.setup).name}`, title:`“${cmd}”`, steps:[], cmd };
  renderAll(); revealDock();
  // tell the agent which reservations are already made, so replan keeps them (API.md: res.done)
  const sent = clone(st.plan);
  sent.days.forEach(d => d.stops.forEach(s => { if (s.res && st.resv[s.id] && st.resv[s.id].st === 'done') s.res.done = true; }));
  const ev = await api.replan(st.setup, sent, cmd, st.day, { signal:ctl.signal, onEvent: e => {
    if(e.type==='step' && st.card===card){ card.steps.push(String(e.text||'')); say(e.text); renderCard(); }
  }});
  if (st.ctl===ctl) st.ctl=null;
  st.busy=false;
  if(st.card!==card) return;
  if(ev.type==='error'){
    if(ev.code==='aborted'){ st.card=null; renderAll(); return; }
    card.state='error'; card.err=ev; say(errText(ev)); renderCard(); return;
  }
  mergeRoutes(ev.routes);
  const baseTotal=ck(st.plan).total;
  const opts=(ev.options||[]).filter(o=>o && o.plan && Array.isArray(o.plan.days) && o.plan.days.length)
    .map(o=>{ normPlan(o.plan); return {...o, chk:ck(o.plan), diff:safeDiff(st.plan,o.plan)}; });
  if(!opts.length){ card.state='error'; card.err={code:'upstream', message: ev.summary || 'Bop ไม่ได้ส่งแผนใหม่กลับมา ลองพิมพ์คำสั่งใหม่'}; renderCard(); return; }
  if(Number.isInteger(ev.day) && ev.day>=0 && ev.day<opts[0].plan.days.length) st.day=ev.day;
  st.all=false; syncViewBtns();
  Object.assign(card, { summary:ev.summary||'', repaired:!!ev.repaired, baseTotal, t0, newSetup: ev.setup && Array.isArray(ev.setup.members) ? ev.setup : null });
  const ms = ev.ms || (performance.now()-t0);
  say(ev.summary || 'ได้แผนใหม่แล้ว');
  if(ev.needs_vote){
    Object.assign(card, { state:'vote', opts, pick:0, voteWhy:ev.vote_reason||'', ms });
    st.preview=opts[0].plan; renderAll(); beginLineVote(card); return;
  }
  apply(opts[0], ms, baseTotal);
}

function apply(o,ms,baseTotal){
  st.hist.push({plan:st.plan, resv:clone(st.resv), cancels:clone(st.cancels), setup:st.setup});
  if (st.card && st.card.newSetup) st.setup = st.card.newSetup;
  syncResv(st.plan,o.plan);
  st.lastDiff=safeDiff(st.plan,o.plan); st.plan=o.plan; st.preview=null;
  st.card={...st.card, state:'done', opt:o, ms, baseTotal};
  renderAll();
  const lineMessage=lineOf(o,o.chk.total-baseTotal);
  if(st.line.linked&&!st.card.lineVote&&lineMessage) void postLineText(lineMessage);
  checkWeather();
}
function renderAll(){ renderHeader(); renderPanel(); renderCard(); syncChrome(); goBox(); }
const narrow = () => matchMedia('(max-width: 860px)').matches;
function revealDock(){ if (narrow() && !$('#dock').hidden) $('#dock').scrollIntoView({ block:'start', behavior: reduced ? 'auto' : 'smooth' }); }
function syncChrome(){
  $('#sims').hidden = !st.sample;
  $('#reset').hidden = !st.hist.length && !st.lastDiff;
  $('#cmdin').placeholder = st.sample && !st.health.claude ? 'เดโมออฟไลน์: ลอง “ตัดน้ำตกออก” “ถ้าฝนตกล่ะ” “ร้านปิด”' : 'สั่ง Bop เช่น “วันเสาร์ขอตื่นสาย” หรือ “ตัดน้ำตกออก”';
}
function syncViewBtns(){ $('#vDay').setAttribute('aria-pressed',String(!st.all)); $('#vAll').setAttribute('aria-pressed',String(st.all)); }

/* ---------- events ---------- */
document.querySelectorAll('[data-s]').forEach(b=>b.addEventListener('click',()=>runScen(b.dataset.s)));
$('#edittrip').addEventListener('click', openSetup);
$('#reset').addEventListener('click',()=>{ if(st.busy) return;
  Object.assign(st,{plan: st.sample ? fresh() : clone(st.origin), hist:[], lastDiff:null, preview:null, card:null, day:0, sel:null, approved:{}, resv:{}, cancels:[]}); renderAll(); });
$('#cmdform').addEventListener('submit',e=>{ e.preventDefault(); const t=$('#cmdin').value.trim(); if(!t || st.busy) return;
  if(st.health.claude || !st.sample){ $('#cmdin').value=''; agentReplan(t); return; }
  let k=null;
  if(/น้ำตก|บัวตอง/.test(t) && /ตัด|ไม่ไป|เอาออก|ลบ|ยกเลิก|ข้าม/.test(t)) k='cut';
  else if(/ฝน|rain/i.test(t)) k='rain';
  else if(/ปิด|closed/i.test(t)) k='closed';
  else if(/ดีเลย์|delay|เลื่อน|ไฟลต์|เครื่องบิน/i.test(t)) k='delay';
  if(k){ $('#cmdin').value=''; runScen(k); return; }
  st.card={kind:'scen', src:'คำสั่งจากคนจัดทริป', title:'โหมดตัวอย่างยังไม่เข้าใจคำสั่งนี้', state:'unknown', steps:[],
    msg:`ตอนนี้ Bop อยู่ในโหมดตัวอย่าง จึงเข้าใจเฉพาะคำสั่งตัวอย่าง เช่น “ตัดน้ำตกออก” “ถ้าฝนตกล่ะ” “ร้านปิด” “ไฟลต์ดีเลย์” (ได้รับ: “${t}”)`,
    help: keyHelp(st.health.reachable ? 'no_key' : 'offline')};
  renderCard(); goBox();
});
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{ st.tab=t.dataset.tab; renderPanel(); }));
$('#tabs').addEventListener('keydown',e=>{ if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight') return; const tabs=[...document.querySelectorAll('.tab')]; const i=tabs.indexOf(document.activeElement); if(i<0) return; const n=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length]; n.focus(); n.click(); });
$('#vDay').addEventListener('click',()=>{ st.all=false; syncViewBtns(); goBox(); });
$('#vAll').addEventListener('click',()=>{ st.all=true; syncViewBtns(); goBox(); });
$('#panelbody').addEventListener('click',async e=>{
  if(st.screen==='planning'){
    const b=e.target.closest('[data-pl]'); if(!b) return;
    const a=b.dataset.pl;
    if(a==='retry') { if((st.planning.phase||'plan')==='plan') startPlanning(st.planning.setup); else startAsk(st.planning.setup); }
    else if(a==='auto') startPlanning({ ...st.planning.setup, autonomy:'auto' });
    else if(a==='reopen') openAsk();
    else if(a==='sample') openSample();
    else if(a==='edit'||a==='cancel'){ st.ask=null; closeAsk(); if(st.ctl) st.ctl.abort(); st.ctl=null; clearInterval(tick); st.draft=clone(st.planning.setup); st.planning=null; show('setup'); renderSetupScreen(); }
    return;
  }
  const lineAction=e.target.closest('[data-line]');
  if(lineAction){
    const action=lineAction.dataset.line;
    if(action==='connect') await connectLine();
    else if(action==='refresh') await pollLineTrip();
    else if(action==='tasks') await postReservationTasks();
    else if(action==='delete'&&confirm('ลบข้อมูล LINE และบัตรโหวตของทริปนี้หรือไม่')){
      const L=st.line, ev=await api.tripDelete(L.tripId,L.token);
      if(ev.type==='done'){ stopLineTimers(); st.line={enabled:L.enabled,state:'idle',linked:false,tripId:null,token:null,code:null,error:null}; renderPanel(); }
    }
    return;
  }
  if(e.target.closest('a, .pinfo')) return;
  const ib=e.target.closest('[data-info]');
  if(ib){ const s=findStop(ib.dataset.info); if(!s) return; const I=st.info[s.id];
    if(I && I.open){ I.open=false; renderPanel(); return; }
    if(I && I.state==='done' && I.key===infoKey(s)){ I.open=true; renderPanel(); return; }
    if(I && I.state==='run'){ I.open=true; renderPanel(); return; }
    renderPanel(); loadInfo(s); return; }
  const tg=e.target.closest('[data-tchg]'); if(tg){ st.tchg[tg.dataset.tchg]=!st.tchg[tg.dataset.tchg]; renderPanel(); return; }
  const tc=e.target.closest('[data-tchange]');
  if(tc){ const dir=tc.dataset.tchange, T=transportOf(dir); const o=T && T.options.find(x=>(x.id||x.code||'')===tc.dataset.code); if(!o) return;
    const noun=NOUN[T.by]||'การเดินทาง', side=dir==='arrive'?'ขาไป':'ขากลับ';
    st.setup[dir] = { ...st.setup[dir], choice:o, time: dir==='arrive' ? (o.arr||st.setup[dir].time) : (o.dep||st.setup[dir].time) };
    st.tchg[dir]=false;
    agentReplan(`เปลี่ยน${noun}${side}เป็น ${[o.carrier,o.code].filter(Boolean).join(' ')} ออก ${o.dep} ถึง ${o.arr}`); return; }
  const rv=e.target.closest('[data-resv]');
  if(rv){ const id=rv.dataset.id, v=rv.dataset.resv;
    if(v==='done') st.resv[id]={st:'done'};
    else if(v==='todo') delete st.resv[id];
    else if(v==='full'){
      const s=findStop(id);
      if(st.sample && SCEN['full_'+id]) { runScen('full_'+id); return; }
      if(!st.sample && s){ agentReplan(`ร้าน${s.n}เต็ม ช่วง ${s.t0} หาร้านแทนในเวลาเดิม`); return; }
      st.card={kind:'scen',src:`${organizer(st.setup).name}กด “ร้านเต็ม”`,title:'ยังไม่มีร้านแทนในเดโม',state:'unknown',steps:[],msg:'เดโมออฟไลน์เตรียมร้านแทนไว้เฉพาะดินเนอร์ริมน้ำปิงกับฮ้านแม่จันทร์ เมื่อเชื่อม Bop แล้ว Bop จะหาร้านแทนให้จากเงื่อนไขเดียวกัน'}; renderCard(); goBox(); return; }
    renderAll(); return; }
  const cp=e.target.closest('[data-copy]');
  if(cp){ const el=document.getElementById(cp.dataset.copy); const txt=el?el.textContent.replace(/[“”]/g,''):'';
    const sel=()=>{ const r=document.createRange(); r.selectNodeContents(el); const s=getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent='เลือกข้อความแล้ว กด Copy'; };
    try{ navigator.clipboard.writeText(txt).then(()=>{ cp.textContent='คัดลอกแล้ว'; }, sel); }catch(_){ sel(); }
    return; }
  const cn=e.target.closest('[data-cancel]'); if(cn){ st.cancels=st.cancels.filter(c=>c.n!==cn.dataset.cancel); renderAll(); return; }
  const fa=e.target.closest('[data-fba]'); if(fa){ const dir=fa.dataset.dir, a=fa.dataset.fba, F=st.fb[dir];
    if(a==='start') fbStart(dir);
    else if(a==='close'){ delete st.fb[dir]; renderPanel(); }
    else if(a==='review'){ const m=fbMissing(F); F.err=m?{code:'bad_request',message:m}:null; if(!m) F.state='confirm'; renderPanel(); }
    else if(a==='edit'){ F.state='form'; F.err=null; renderPanel(); }
    else if(a==='order') fbOrder(dir);
    else if(a==='cancel') fbCancel(dir,false);
    else if(a==='cancel-ok') fbCancel(dir,true);
    else if(a==='cancel-no'){ F.quote=null; F.cstate=null; renderPanel(); }
    return; }
  const wb=e.target.closest('[data-wx]'); if(wb){ const a=wxFor(st.day); if(!a) return;
    if(wb.dataset.wx==='dismiss'){ st.wx.dismissed[wxKey(a)]=true; renderPanel(); return; }
    if(st.busy) return; agentReplan(wxCommand(a)); return; }
  const gt=e.target.closest('[data-goto]'); if(gt){ st.tab=gt.dataset.goto; renderPanel(); return; }
  const d=e.target.closest('[data-day]'); if(d){ st.day=+d.dataset.day; st.sel=null; st.all=false; syncViewBtns(); renderPanel(); goBox(); return; }
  const ap=e.target.closest('[data-approve]'); if(ap){ st.approved[ap.dataset.approve]=true; renderPanel(); return; }
  if(e.target.closest('button')) return;
  const s=e.target.closest('.stop'); if(s){ st.sel = s.dataset.id; renderPanel(); openSheet(s.dataset.id); goBox(); return; }
});
$('#panelbody').addEventListener('click',e=>{
  const r=e.target.closest('[data-info-retry]'); if(!r) return;
  const s=findStop(r.dataset.infoRetry); if(s){ delete st.info[s.id]; loadInfo(s); }
});
$('#panelbody').addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ') && e.target.classList && e.target.classList.contains('stop')){ e.preventDefault(); e.target.click(); } });
$('#dock').addEventListener('click',async e=>{
  const copy=e.target.closest('[data-copy]'); if(copy){ const source=document.getElementById(copy.dataset.copy); const text=source?.textContent||''; try{ await navigator.clipboard.writeText(text); copy.textContent='คัดลอกแล้ว'; }catch(_){ copy.textContent='คัดลอกไม่สำเร็จ'; } return; }
  const c=st.card; if(!c) return;
  const pk=e.target.closest('[data-pick]'); if(pk){ c.pick=+pk.dataset.pick; st.preview=c.opts[c.pick].plan; renderAll(); return; }
  const ch=e.target.closest('[data-choose]'); if(ch){ const o=c.opts[+ch.dataset.choose];
    if(c.lineVote&&st.line.linked){ const key=o.key||String.fromCharCode(65+(+ch.dataset.choose)); await api.lineVoteClose(st.line.tripId,st.line.token,key); clearTimeout(lineVoteTimer); }
    st.busy=false; apply(o, c.kind==='scen' ? performance.now()-c.t0-(c.votes.length*550) : c.ms, c.baseTotal); return; }
  const a=e.target.closest('[data-act]'); if(!a) return;
  const act=a.dataset.act;
  if(act==='close'){ st.card=null; renderAll(); }
  if(act==='cancel'){ st.preview=null; st.card=null; st.busy=false; renderAll(); }
  if(act==='abort'){ if(st.ctl) st.ctl.abort(); }
  if(act==='retry'){ const cmd=c.cmd; st.card=null; if(cmd) agentReplan(cmd); else renderAll(); }
  if(act==='sample'){ openSample(); }
  if(act==='undo'){ const h=st.hist.pop(); if(h){ st.plan=h.plan; st.resv=h.resv; st.cancels=h.cancels; if(h.setup) st.setup=h.setup; } st.lastDiff=null; st.card=null; renderAll(); say('ย้อนกลับเป็นแผนก่อนหน้าแล้ว'); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#ask').hidden) { e.preventDefault(); askAct('auto'); return; } if (e.key === 'Escape' && sheetFor) { closeSheet(); return; } if (e.key === 'Escape' && st.card && st.card.state !== 'run' && st.screen === 'planner') { if (st.card.state==='vote') { st.preview=null; st.busy=false; } st.card=null; renderAll(); } });

/* ---------- boot ---------- */
show('setup');
renderSetupScreen();
health().then(h => {
  st.health = { ...h, checked:true };
  renderAgent();
  const msg = $('#setupmsg'); if (msg && !msg.classList.contains('bad')) msg.textContent = setupMsg();
  const us = $('#usesample'); if (us) us.hidden = !!h.claude;
  if (st.screen === 'planner') renderAll();
});
api.config().then(result=>{ if(result.type==='done'){ st.line.enabled=!!result.enabled; if(st.screen==='planner') renderPanel(); } });
if (new URLSearchParams(location.search).has('demo')) openSample();
/* flight booking form: keep typed values in memory without re-rendering (focus stays put) */
const fbInput = e => {
  const t = e.target;
  if (t.dataset.fb) { const F = st.fb[t.dataset.fb]; if (F && F.pax[+t.dataset.i]) F.pax[+t.dataset.i][t.dataset.k] = t.value; return; }
  if (t.dataset.fbbag) { const F = st.fb[t.dataset.fbbag]; if (F) { F.bags[t.dataset.id] = +t.value; const b = t.closest('.fb').querySelector('[data-fba="review"]'); if (b) b.textContent = `ตรวจทานก่อนจอง · ${baht(fbTotal(F).thb)}`; } return; }
  if (t.dataset.fbhold) { const F = st.fb[t.dataset.fbhold]; if (F) F.hold = t.checked; }
};
$('#panelbody').addEventListener('input', fbInput);
$('#panelbody').addEventListener('change', fbInput);
