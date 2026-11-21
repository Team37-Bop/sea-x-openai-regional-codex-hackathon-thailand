/* Pure trip logic: data, scenarios, constraints, diff, scheduler. No DOM. */
const clone = o => JSON.parse(JSON.stringify(o));
const toM = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const fmtT = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const baht = n => '฿'+Math.round(n).toLocaleString('en-US');
const sbaht = n => (n>0?'+':n<0?'−':'±')+'฿'+Math.abs(Math.round(n)).toLocaleString('en-US');
const km = n => (Math.round(n*10)/10).toFixed(1);
const MODES = { walk:'เดิน', red:'รถแดง', car:'รถแอป', van:'รถตู้เหมา', transit:'รถไฟ/รถไฟฟ้า', own:'รถส่วนตัว' };
const KCOL = { stay:'--k-stay', temple:'--k-temple', food:'--k-food', nature:'--k-nature', market:'--k-market', sight:'--k-sight', transit:'--k-transit', view:'--k-view' };
const MEMBERS = [
  { id:'min',  name:'มิ้น',  role:'คนจัดทริป' },
  { id:'palm', name:'ปาล์ม' },
  { id:'oat',  name:'โอ๊ต' },
  { id:'fon',  name:'ฝน' },
];
const HOTEL = [18.7905, 98.9880], CNX = [18.7668, 98.9626];
const L = (m,min,kmv,cost,why) => ({ m, min, km:kmv, cost:cost||0, why:why||'' });
const S = (id,n,k,t0,t1,ll,x) => Object.assign({ id, n, k, t0, t1, ll, cost:0, walk:0 }, x||{});

/* ---------- base plan (sample data) ---------- */
const BASE = { flags:{}, days:[
 { label:'ศ. 20 พ.ย.', short:'วันศุกร์', stops:[
  S('cnx','ถึงสนามบินเชียงใหม่','transit','09:15','09:15',CNX,{note:'DMK 08:00 → CNX 09:15 · ทุกคน carry-on 7 กก.'}),
  S('hotel1','ฝากกระเป๋า · บ้านไม้ในเมืองเก่า','stay','09:40','10:00',HOTEL,{cost:1400,note:'2 ห้อง × 2 คืน หาร 4',leg:L('car',20,4.5,45)}),
  S('phrasingh','วัดพระสิงห์วรมหาวิหาร','temple','10:10','10:55',[18.7884,98.9822],{open:'06:00-18:00',cost:20,walk:.2,dress:1,leg:L('walk',10,.7)}),
  S('khaosoi','ข้าวซอยป้าแก้ว','food','11:05','11:50',[18.7926,98.9853],{open:'10:00-15:00',meal:'lunch',veg:1,cost:90,walkin:1,note:'มีข้าวซอยเห็ดสำหรับปาล์ม',leg:L('red',6,.9,20,'เดินจริงตามถนน 900 ม. นั่งรถแดงแทน ให้โอ๊ตเดินทั้งวันไม่เกิน 3 กม.')}),
  S('chediluang','วัดเจดีย์หลวงวรวิหาร','temple','12:00','13:00',[18.7869,98.9866],{open:'08:00-17:00',cost:50,walk:.2,dress:1,leg:L('red',6,.9,20)}),
  S('rest1','เช็กอิน · พักบ่าย','stay','13:10','15:30',HOTEL,{note:'หลบแดดบ่าย พักเข่าโอ๊ต',leg:L('red',6,.7,20)}),
  S('warorot','กาดหลวง (ตลาดวโรรส)','market','15:45','17:30',[18.7905,99.0010],{open:'05:00-18:00',cost:200,walk:.3,note:'ของฝาก แคบหมู น้ำพริกหนุ่ม',leg:L('red',12,2.2,30)}),
  S('riverside','ดินเนอร์ริมน้ำปิง','food','18:00','19:30',[18.7930,99.0058],{open:'11:00-23:00',meal:'dinner',veg:1,cost:350,res:{phone:'053-000-118',by:'พฤ. 19 พ.ย. 18:00',ask:'ขอโต๊ะริมน้ำ'},leg:L('walk',8,.5)}),
  S('end1','กลับที่พัก','stay','19:45','19:45',HOTEL,{leg:L('car',12,2.4,25)}),
 ]},
 { label:'ส. 21 พ.ย.', short:'วันเสาร์', stops:[
  S('start2','ออกจากที่พัก','stay','05:10','05:10',HOTEL,{note:'นัดหน้าที่พัก 05:00'}),
  S('doipui','จุดชมวิวดอยปุย · พระอาทิตย์ขึ้น','view','06:00','07:00',[18.8167,98.8940],{open:'05:00-18:00',star:'min',outdoor:1,note:'พระอาทิตย์ขึ้น 06:24 · ราว 13°C',leg:L('van',45,22,450,'เหมารถตู้เต็มวัน ฿1,800 หาร 4')}),
  S('suthep','วัดพระธาตุดอยสุเทพ','temple','07:20','08:30',[18.8048,98.9216],{open:'06:00-20:00',cost:50,walk:.3,dress:1,note:'ขึ้นลิฟต์แทนบันได 306 ขั้น เพื่อเข่าโอ๊ต',leg:L('van',20,7)}),
  S('brunch','บรันช์มังสวิรัติ · นิมมานฯ','food','09:05','10:15',[18.7990,98.9672],{open:'08:00-16:00',meal:'breakfast',veg:1,cost:220,walkin:1,leg:L('van',35,14)}),
  S('nimman','One Nimman · กาแฟ ถ่ายรูป','sight','10:20','11:30',[18.8001,98.9688],{open:'10:00-22:00',cost:120,leg:L('walk',5,.4)}),
  S('lunch_rt','ครัวสวนริมทาง อ.แม่แตง','food','12:40','13:25',[19.0520,99.0620],{open:'10:00-17:00',meal:'lunch',veg:1,cost:150,walkin:1,leg:L('van',50,34)}),
  S('buatong','น้ำตกบัวตอง (น้ำตกเหนียว)','nature','13:40','15:20',[19.0646,99.0757],{open:'08:00-17:00',walk:.6,outdoor:1,note:'ทางลงชัน โอ๊ตรอที่ศาลาด้านบนได้',leg:L('van',15,6)}),
  S('rest2','พักที่ที่พัก','stay','16:40','17:30',HOTEL,{leg:L('van',60,40)}),
  S('wualai','ถนนคนเดินวัวลาย (เฉพาะวันเสาร์)','market','17:45','19:30',[18.7790,98.9870],{open:'17:00-23:00',days:{only:['sat']},meal:'dinner',veg:1,cost:200,walk:.8,walkin:1,note:'มื้อเย็นสตรีทฟู้ด มีซุ้มอาหารเจ',leg:L('red',8,1.3,20,'ทางเดินจริง 1.5 กม. นั่งรถแดงไปแล้วเก็บแรงเดินในตลาด')}),
  S('end2','กลับที่พัก','stay','19:45','19:45',HOTEL,{leg:L('red',8,1.2,25)}),
 ]},
 { label:'อา. 22 พ.ย.', short:'วันอาทิตย์', stops:[
  S('start3','เช็กเอาต์ · ฝากกระเป๋า','stay','08:30','08:30',HOTEL),
  S('bkfast','โจ๊กประตูช้างเผือก','food','08:40','09:20',[18.7966,98.9866],{open:'06:00-12:00',meal:'breakfast',veg:1,cost:70,walkin:1,note:'มีโจ๊กเห็ด',leg:L('walk',8,.5)}),
  S('jingjai','ตลาดจริงใจ (เช้าวันอาทิตย์)','market','09:35','11:05',[18.8075,98.9960],{open:'07:00-13:00',days:{only:['sat','sun']},cost:150,walk:.6,leg:L('car',12,3.5,30)}),
  S('lunch3','ฮ้านแม่จันทร์ อาหารเหนือ','food','11:30','12:30',[18.7779,98.9502],{open:'10:30-20:00',meal:'lunch',veg:1,cost:180,res:{phone:'053-000-245',by:'ส. 21 พ.ย. 18:00',ask:'ขอโต๊ะในร่ม'},note:'มีแกงฮังเลเจ',leg:L('car',25,7.5,40)}),
  S('bankangwat','บ้านข้างวัด · เวิร์กช็อปงานคราฟต์','sight','12:35','14:00',[18.7766,98.9480],{open:'10:00-18:00',cost:200,walk:.4,leg:L('walk',5,.3)}),
  S('rest3','ที่พัก · อาบน้ำ เก็บกระเป๋า','stay','14:20','16:15',HOTEL,{leg:L('car',20,5.5,35)}),
  S('sunwalk','ถนนคนเดินวันอาทิตย์ ประตูท่าแพ','market','16:25','19:00',[18.7877,98.9933],{open:'16:00-22:00',days:{only:['sun']},meal:'dinner',veg:1,cost:250,walk:.6,walkin:1,leg:L('red',6,.9,20,'เก็บแรงเดินไว้ในถนนคนเดิน')}),
  S('cnx3','สนามบินเชียงใหม่','transit','19:40','19:40',CNX,{note:'ไฟลต์ CNX → DMK 21:15',leg:L('car',25,5.5,50,'แวะรับกระเป๋าที่ที่พักระหว่างทาง')}),
 ]},
]};

/* ---------- constraints ---------- */
/* Trip setup for the built-in sample (API.md TripSetup). Member ids match BASE's star/ids and the UI's avatar classes. */
const SAMPLE_SETUP = {
  title:"เชียงใหม่กับแก๊งมหา'ลัย", city:'เชียงใหม่', startDate:'2026-11-20', days:3,
  arrive:{ by:'flight', from:'DMK', time:'09:15' }, depart:{ by:'flight', to:'DMK', time:'21:15' },
  pace:'normal', hotelArea:'เมืองเก่า',
  members:[
    { id:'min',  name:'มิ้น',  role:'organizer', wants:['ดูพระอาทิตย์ขึ้น'] },
    { id:'palm', name:'ปาล์ม', avoid:'เนื้อสัตว์ (กินมังสวิรัติ)' },
    { id:'oat',  name:'โอ๊ต',  note:'เข่าไม่ดี เลี่ยงบันไดยาว', maxWalkKm:3 },
    { id:'fon',  name:'ฝน',   budget:5000 },
  ],
};
function dayStats(d){
  let walk=0, cost=0;
  d.stops.forEach(s => { walk += s.walk||0; cost += s.cost||0; if(s.leg){ if(s.leg.m==='walk') walk += s.leg.km; cost += s.leg.cost||0; } });
  return { walk: Math.round(walk*10)/10, cost };
}
const WD = ['sun','mon','tue','wed','thu','fri','sat'];
const WD_TH = { sun:'อาทิตย์', mon:'จันทร์', tue:'อังคาร', wed:'พุธ', thu:'พฤหัสบดี', fri:'ศุกร์', sat:'เสาร์' };
/** ISO date and weekday key ('mon'...) of day index `di` of a trip starting at `start`. */
function tripDay(start, di){ const d = new Date((start||'2026-11-20')+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+di); return { date:d.toISOString().slice(0,10), wd:WD[d.getUTCDay()] }; }
/** Opening hours that apply on weekday `wd` (stop.days.hours overrides stop.open). */
const openOn = (s, wd) => (s.days && s.days.hours && wd && s.days.hours[wd]) || s.open;
const inWindow = (s, wd) => { const open = openOn(s, wd); if(!open || !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(open)) return true; const [o,c]=open.split('-').map(toM); const cc = c<=o ? c+1440 : c; return toM(s.t0)>=o && toM(s.t1)<=cc; };
/** Why a stop is closed on that day, or null. */
function closedWhy(s, wd, date){
  const dd = s.days || {};
  if(Array.isArray(dd.only) && dd.only.length && !dd.only.includes(wd)) return `เปิดเฉพาะวัน${dd.only.map(w=>WD_TH[w]||w).join('/')}`;
  if(Array.isArray(dd.closed) && dd.closed.includes(wd)) return `ปิดวัน${WD_TH[wd]}`;
  const c = (s.closures||[]).find(x=>x && x.date===date);
  if(c) return `ปิดวันที่ ${date}${c.why?` (${c.why})`:''}`;
  return null;
}
/* Food restrictions: member.avoid is free text ("กุ้ง, ถั่วลิสง", "เนื้อสัตว์ (กินมังสวิรัติ)"). Legacy veg:true = vegetarian.
   A meal fits a member when the planner marked it diet (safe dishes for every restriction), or the member is
   vegetarian and the place has vegetarian dishes (veg). */
export const avoidOf = m => String((m && (m.avoid || (m.veg ? 'เนื้อสัตว์ (กินมังสวิรัติ)' : ''))) || '').trim();
export const vegAvoid = t => /มังสวิรัติ|อาหารเจ|^เจ$|เนื้อสัตว์|vegetarian|vegan/i.test(t || '');
export const mealFits = (s, m) => !!(s.diet || (s.veg && vegAvoid(avoidOf(m))));
/* Rule evaluation shared by checks() and explain(). Each rule: { l, who?, id?, ok, txt, why[] }. */
function evalRules(p, setup){
  setup = setup || SAMPLE_SETUP;
  const ds = p.days.map(dayStats);
  const total = ds.reduce((a,d)=>a+d.cost,0);
  const maxWalk = ds.length ? Math.max(...ds.map(d=>d.walk)) : 0;
  const all = p.days.flatMap(d=>d.stops);
  const meals = all.filter(s=>s.meal);
  const members = setup.members || [];
  const rules = [];
  for(const m of members){
    if(m.wants && m.wants.length){
      const starred = all.filter(s=>s.star===m.id);
      const wish = m.wants.join(' · ');
      const ok = starred.length >= m.wants.length;
      rules.push({ id:m.id, who:m.name, l:wish, ok,
        txt: ok ? `ได้${wish}` : `ยังไม่ได้${wish}`,
        why: ok ? [] : [`แผนมีจุดที่ star="${m.id}" ${starred.length} จุด ต้องมีอย่างน้อย ${m.wants.length} (ความต้องการ: ${m.wants.join(', ')})`] });
    }
    const av = avoidOf(m);
    if(av){
      const fit = meals.filter(s=>mealFits(s,m)), ok = fit.length===meals.length;
      rules.push({ id:m.id, who:m.name, l:`ไม่ทาน ${av}`, ok, txt:`มื้อที่ทานได้ ${fit.length}/${meals.length}`,
        why: meals.filter(s=>!mealFits(s,m)).map(s=>`มื้อ ${s.id} (${s.n}) ไม่มีเมนูที่${m.name}ทานได้ (แพ้/ไม่ทาน: ${av})`) });
    }
    if(m.maxWalkKm!=null && m.maxWalkKm>0){
      const lim=m.maxWalkKm, ok = maxWalk <= lim+0.0001;
      rules.push({ id:m.id, who:m.name, l:`เดิน ≤ ${km(lim).replace(/\.0$/,'')} กม./วัน`, ok, txt:`เดินสูงสุด ${km(maxWalk)}/${km(lim).replace(/\.0$/,'')} กม./วัน`,
        why: ds.map((d,i)=>d.walk>lim+0.0001?`วันที่ ${i+1} เดินรวม ${km(d.walk)} กม. (เกิน ${lim})`:null).filter(Boolean) });
    }
    if(m.budget!=null && m.budget>0){
      const b=m.budget, ok = total<=b;
      rules.push({ id:m.id, who:m.name, l:`งบ ≤ ${baht(b)}`, ok, txt: ok ? `${baht(total)} จากงบ ${baht(b)}` : `${baht(total)} เกินงบ ${baht(total-b)}`,
        why: ok ? [] : [`ค่าใช้จ่ายต่อคน ${total} บาท เกินงบ ${b} บาท อยู่ ${total-b} บาท`] });
    }
  }
  const hourWhy = [], dayWhy = [];
  p.days.forEach((d,i)=>{
    const { date, wd } = tripDay(setup.startDate, i);
    d.stops.forEach(s=>{
      if(!inWindow(s, wd)) hourWhy.push(`${s.id} (${s.n}) อยู่ ${s.t0}–${s.t1} แต่เปิด ${openOn(s, wd)}`);
      const why = closedWhy(s, wd, date);
      if(why) dayWhy.push(`${s.n} ${why} (วันที่ ${i+1}, วัน${WD_TH[wd]} ${date}, id ${s.id})`);
    });
  });
  rules.push({ l:'เวลาเปิด–ปิด', ok:hourWhy.length===0, txt:'', why: hourWhy });
  rules.push({ l:'เปิดวันที่ไป', ok:dayWhy.length===0, txt:'', why: dayWhy });
  const arrive = setup.arrive && setup.arrive.time ? toM(setup.arrive.time) : 0;
  const depart = setup.depart && setup.depart.time ? toM(setup.depart.time) : 24*60;
  const last = p.days.length-1;
  const mealWhy = [];
  p.days.forEach((d,i)=>{
    const needLunch = !(i===0 && arrive>toM('13:00')) && !(i===last && depart<toM('13:00'));
    const needDinner = !(i===last && depart<toM('19:30'));
    const lunch = d.stops.some(s=>s.meal==='lunch' && toM(s.t0)>=toM('11:00') && toM(s.t0)<=toM('14:00'));
    const dinner = d.stops.some(s=>s.meal==='dinner' && toM(s.t1)>=toM('17:30') && toM(s.t0)<=toM('20:30'));
    if(needLunch && !lunch) mealWhy.push(`วันที่ ${i+1} ไม่มีมื้อกลางวัน (meal=lunch เริ่ม 11:00–14:00)`);
    if(needDinner && !dinner) mealWhy.push(`วันที่ ${i+1} ไม่มีมื้อเย็น (meal=dinner จบหลัง 17:30 เริ่มก่อน 20:30)`);
  });
  rules.push({ l:'มื้อกลางวัน–เย็นครบ', ok:mealWhy.length===0, txt:'', why:mealWhy });
  // Departure rules depend on how the group travels (undecided -> what the agent suggested in plan.flags.arrivalSuggested).
  const sug = p.flags && p.flags.arrivalSuggested && p.flags.arrivalSuggested.by;
  const byOf = x => { const b = x && x.by ? x.by : (x && x.time ? 'flight' : null); return b==='undecided' ? (sug||null) : b; };
  const depBy = byOf(setup.depart), arrBy = byOf(setup.arrive);
  const ls = p.days.length ? p.days[last].stops : [], lastStop = ls[ls.length-1];
  if(lastStop && setup.depart && setup.depart.time && (depBy==='flight' || depBy==='bus' || depBy==='train')){
    const need = depBy==='flight' ? 75 : 30, buffer = depart - toM(lastStop.t0);
    const what = depBy==='flight' ? 'สนามบิน' : 'สถานี', ref = depBy==='flight' ? 'ไฟลต์' : (depBy==='bus' ? 'รถออก' : 'รถไฟออก');
    rules.push({ l:`ถึง${what}ก่อน${ref} ${buffer} นาที`, ok:buffer>=need, txt:'',
      why: buffer>=need ? [] : [`จุดสุดท้ายของวันสุดท้ายต้องเป็น${what} ถึงไม่เกิน ${fmtT(depart-need)} (ตอนนี้ ${lastStop.t0} · ออก ${setup.depart.time})`] });
  }
  const driveMin = d => d.stops.reduce((a,s)=>a+(s.leg && s.leg.m==='own' ? s.leg.min : 0), 0);
  if(depBy==='drive' && lastStop && lastStop.leg && lastStop.leg.m==='own' && lastStop.leg.km>=50){
    const home = toM(lastStop.t0);
    rules.push({ l:'ถึงบ้านไม่ดึกเกิน 22:00', ok:home<=toM('22:00'), txt:'', why: home<=toM('22:00') ? [] : [`ถึงบ้าน ${lastStop.t0} ต้องออกเดินทางกลับเร็วขึ้นหรือตัดจุดท้าย ๆ ของวันสุดท้าย`] });
  }
  if(arrBy==='drive' || depBy==='drive'){
    const bad = p.days.map((d,i)=>({ i, m:driveMin(d) })).filter(x=>x.m>480);
    rules.push({ l:'ขับรถไม่เกิน 8 ชม./วัน', ok:!bad.length, txt:'', why: bad.map(x=>`วันที่ ${x.i+1} ขับรวม ${Math.floor(x.m/60)} ชม. ${x.m%60} นาที ควรแบ่งวันหรือพักค้างระหว่างทาง`) });
  }
  return { rules, ds, total, maxWalk, members };
}
function checks(p, setup = SAMPLE_SETUP){
  const { rules, ds, total, maxWalk, members } = evalRules(p, setup);
  const mem = {};
  for(const m of members){
    const mine = rules.filter(r=>r.id===m.id);
    if(!mine.length){ mem[m.id] = { ok:true, txt:'ไม่มีเงื่อนไขพิเศษ' }; continue; }
    const bad = mine.filter(r=>!r.ok);
    mem[m.id] = { ok:bad.length===0, txt:(bad.length?bad:mine).map(r=>r.txt).join(' · ') };
  }
  const list = rules.map(r=>r.who ? { l:r.l, who:r.who, ok:r.ok } : { l:r.l, ok:r.ok });
  return { mem, list, pass:list.filter(x=>x.ok).length, total, maxWalk, ds };
}
/* Failing rules with concrete reasons, for the agent's repair round. */
function explain(p, setup = SAMPLE_SETUP){
  return evalRules(p, setup).rules.filter(r=>!r.ok).map(r=>({ rule:r.l, who:r.who||null, member:r.id||null, why:r.why }));
}

/* ---------- diff ---------- */
function same(a,b){ return a.t0===b.t0 && a.t1===b.t1 && JSON.stringify(a.leg||null)===JSON.stringify(b.leg||null); }
function diff(a,b){
  let total=0, untouched=0;
  const days = a.days.map((da,i)=>{
    const db=b.days[i];
    const ma=new Map(da.stops.map(s=>[s.id,s])), mb=new Map(db.stops.map(s=>[s.id,s]));
    const removed=da.stops.filter(s=>!mb.has(s.id));
    const added=new Set(db.stops.filter(s=>!ma.has(s.id)).map(s=>s.id));
    const retimed=new Map();
    db.stops.forEach(s=>{ const o=ma.get(s.id); if(o && !same(o,s)) retimed.set(s.id,o); });
    da.stops.forEach(s=>{ total++; const n=mb.get(s.id); if(n && same(s,n)) untouched++; });
    return { removed, added, retimed, old:da, touched: removed.length+added.size+retimed.size>0 };
  });
  return { days, total, untouched, changed: total-untouched };
}

/* ---------- scenario building blocks ---------- */
const idx = (d,id) => d.stops.findIndex(s=>s.id===id);
const has = (p,id) => p.days.some(d=>idx(d,id)>=0);
function between(p,di,fromId,toId,ins,patchTo){
  const d=p.days[di]; const a=idx(d,fromId), b=idx(d,toId);
  d.stops.splice(a+1, b-a-1, ...ins);
  Object.assign(d.stops[idx(d,toId)], patchTo||{});
}
function vanHalf(p){
  const s=p.days[1].stops[idx(p.days[1],'doipui')];
  s.leg.cost=250; s.leg.why='เหมารถตู้ครึ่งวัน ฿1,000 หาร 4 (เดิมเต็มวัน ฿1,800)';
  p.flags.half=true;
}
const LUNCH_NM = () => S('lunch_nm','ร้านอาหารเจ ซอยนิมมาน 9','food','11:40','12:30',[18.7972,98.9660],{open:'10:00-20:00',meal:'lunch',veg:1,cost:120,walkin:1,leg:L('walk',4,.3)});
const LUNCH3B = () => S('lunch3b','ครัวบ้านสวนหลังมอ','food','11:30','12:30',[18.7772,98.9490],{open:'10:00-21:00',meal:'lunch',veg:1,cost:200,note:'มีแกงฮังเลเจ',res:{phone:'053-000-377',by:'ส. 21 พ.ย. 20:00',ask:'ขอโต๊ะในร่ม'},leg:L('car',25,7.5,40)});

const SCEN = {
 cut: {
  src:'คำสั่งจากมิ้น · ก่อนเดินทาง', title:'ตัดน้ำตกบัวตองออก', day:1, need:'buatong', live:false,
  na:'น้ำตกบัวตองไม่อยู่ในแผนแล้ว ไม่มีอะไรต้องแก้',
  trace:[
    'อ่านคำสั่ง: ตัด “น้ำตกบัวตอง” ออกจากวันเสาร์',
    'หาส่วนที่กระทบ: มื้อกลางวันริมทาง · รถตู้ช่วงบ่าย',
    'ซ่อม: ย้ายมื้อกลางวันมานิมมาน · ลดรถตู้เป็นครึ่งวัน · กลับที่พักด้วยรถแอป',
    'ส่วนอื่นของทริปไม่แตะ',
  ],
  options:[{ key:'A', title:'กินกลางวันที่นิมมาน แล้วบ่ายว่าง',
    head:'บ่ายวันเสาร์ว่าง ไม่ต้องนั่งรถตู้ไปกลับแม่แตง',
    build:p=>{ between(p,1,'nimman','rest2',[LUNCH_NM()],{t0:'12:50',leg:L('car',15,6,25),note:'บ่ายว่าง นอนพักหรือนวดแผนไทยใกล้ที่พัก'}); vanHalf(p); },
    line:(dc)=>`Bop: ตัดน้ำตกบัวตองออกแล้ว\nวันเสาร์กินกลางวันที่นิมมาน แล้วกลับที่พัก บ่ายว่าง\nรถตู้เหลือครึ่งวัน · ค่าใช้จ่าย ${sbaht(dc)}/คน` }],
 },
 rain: {
  src:'ตรวจพบระหว่างทริป · ส. 21 พ.ย. 11:10', title:'ฝนหนักที่ อ.แม่แตง 12:00–16:00', day:1, need:'buatong', live:true,
  na:'เรดาร์ฝนพบฝนหนักที่ อ.แม่แตง แต่แผนตอนนี้ไม่มีจุดกลางแจ้งในพื้นที่นั้น ไม่ต้องแก้ แนะนำพกเสื้อกันฝนไปถนนคนเดินวัวลาย',
  trace:[
    'เรดาร์ฝน: ฝนหนัก 12:00–16:00 ที่ อ.แม่แตง (โอกาส 85%) · กลุ่มอยู่ที่ One Nimman',
    'กระทบ: น้ำตกบัวตอง (กลางแจ้ง หินลื่น) และมื้อกลางวันริมทาง · ช่วงเช้าและเย็นไม่กระทบ',
    'หาที่ในร่มแทน 6 แห่ง → เหลือ 2 ที่ผ่านเวลาเปิด–ปิดและระยะเดินของโอ๊ต',
    'ทางเลือก A เกินงบฝน → ต้องถามกลุ่ม',
  ],
  vote:{ why:'ต้องโหวตเพราะ A ตรงใจกลุ่มมากกว่า แต่เกินงบของฝน ส่วน B อยู่ในงบทุกคน', votes:{ min:'A', palm:'A', oat:'B', fon:'B' } },
  options:[
   { key:'A', title:'A · คลาสทำอาหารไทยในร่ม',
     head:'ทำและกินมื้อกลางวันมังสวิรัติเอง ในเมืองเก่า ใกล้ที่พัก',
     build:p=>{ between(p,1,'nimman','rest2',[
        S('class','คลาสทำอาหารไทย (ในร่ม · ทำเจได้ทุกจาน)','sight','11:55','15:00',[18.7936,98.9912],{open:'09:00-17:00',meal:'lunch',veg:1,cost:1000,walk:.1,note:'จองผ่าน sandbox · ถือที่ไว้ 4 ที่',leg:L('van',20,3.5,0,'รถตู้ส่งที่คลาสแล้วปล่อยรถ')})
      ],{t0:'15:10',leg:L('walk',6,.3)}); vanHalf(p); p.flags.rain=true; p.flags.cls=true; },
     line:(dc)=>`Bop: ฝนหนักที่แม่แตง 12:00–16:00 ไปน้ำตกไม่ปลอดภัย\nเปลี่ยนบ่ายนี้เป็นคลาสทำอาหารไทยในร่ม (${sbaht(dc)}/คน)\nช่วงเย็นถนนคนเดินวัวลายเหมือนเดิม พกเสื้อกันฝนด้วย` },
   { key:'B', title:'B · MAIIAM พิพิธภัณฑ์ศิลปะร่วมสมัย',
     head:'กินกลางวันที่นิมมาน แล้วดูงานศิลปะในร่ม',
     build:p=>{ between(p,1,'nimman','rest2',[ LUNCH_NM(),
        S('maiiam','MAIIAM พิพิธภัณฑ์ศิลปะร่วมสมัย (ในร่ม)','sight','13:05','15:00',[18.7680,99.0640],{open:'10:00-18:00',cost:150,walk:.5,leg:L('car',35,14,70,'ปล่อยรถตู้ที่นิมมาน คิดครึ่งวัน')})
      ],{t0:'15:35',leg:L('car',30,11,60)}); vanHalf(p); p.flags.rain=true; },
     line:(dc)=>`Bop: ฝนหนักที่แม่แตง 12:00–16:00 ไปน้ำตกไม่ปลอดภัย\nบ่ายนี้กินกลางวันที่นิมมาน แล้วไป MAIIAM (${sbaht(dc)}/คน)\nช่วงเย็นถนนคนเดินวัวลายเหมือนเดิม พกเสื้อกันฝนด้วย` },
  ],
 },
 closed: {
  src:'ตรวจพบก่อนเดินทาง · ศ. 20 พ.ย. 21:00', title:'ฮ้านแม่จันทร์ปิดวันอาทิตย์นี้', day:2, need:'lunch3', live:false,
  na:'ร้านนี้ไม่อยู่ในแผนแล้ว',
  trace:[
    'ร้านแจ้งในหน้าเพจ: ปิดวันอาทิตย์ 22 พ.ย. (ไปงานบุญ)',
    'หาร้านแทนในรัศมี 1 กม.: 9 ร้าน → ไม่มีเมนูเจ 5 → เดินไปบ้านข้างวัดเกิน 300 ม. 3',
    'เลือก ครัวบ้านสวนหลังมอ · เปิดถึง 21:00 · มีแกงฮังเลเจ',
    'อยู่ในเกณฑ์ ปรับให้เลยแล้วแจ้งกลุ่ม ไม่ต้องโหวต',
  ],
  options:[{ key:'A', title:'เปลี่ยนเป็นครัวบ้านสวนหลังมอ',
    head:'เวลาเดิม · ร้านใหม่ห่างร้านเดิม 300 ม.',
    build:p=>{ between(p,2,'jingjai','bankangwat',[LUNCH3B()]); },
    line:(dc)=>`Bop: ฮ้านแม่จันทร์ปิดวันอาทิตย์นี้\nเปลี่ยนมื้อกลางวันเป็นครัวบ้านสวนหลังมอ เวลาเดิม 11:30 มีเมนูเจ\nค่าใช้จ่าย ${sbaht(dc)}/คน · มิ้นมีงานโทรจองร้านใหม่` }],
 },
 full_riverside: {
  src:'มิ้นกด “ร้านเต็ม” · ก่อนเดินทาง', title:'ร้านริมน้ำปิงเต็มคืนวันศุกร์', day:0, need:'riverside', live:false,
  na:'ร้านนี้ไม่อยู่ในแผนแล้ว',
  trace:[
    'มิ้นโทรแล้ว ร้านแจ้งว่าเต็มช่วง 18:00–20:00 คืนวันศุกร์',
    'หาร้านมื้อเย็นแทนในรัศมี 1 กม. จากกาดหลวง: 11 ร้าน → ไม่มีเมนูเจ 4 → ปิดก่อน 20:00 2 → เกินงบฝน 3',
    'เลือก ครัวเรือนไม้ริมปิง · รับจอง · มีเมนูเจ · ยังเดินไม่เกิน 3 กม. ของโอ๊ต',
    'สร้างงานโทรจองร้านใหม่ให้มิ้น · ช่วงอื่นไม่แตะ',
  ],
  options:[{ key:'A', title:'เปลี่ยนเป็นครัวเรือนไม้ริมปิง',
    head:'เวลาเดิม 18:00 · เดินจากกาดหลวงไกลขึ้น 100 ม.',
    build:p=>{ between(p,0,'warorot','end1',[
      S('riverside2','ครัวเรือนไม้ริมปิง','food','18:00','19:30',[18.7958,99.0052],{open:'11:00-22:00',meal:'dinner',veg:1,cost:380,res:{phone:'053-000-462',by:'ศ. 20 พ.ย. 12:00',ask:'ขอโต๊ะริมน้ำถ้ามี'},leg:L('walk',9,.6)})
    ],{leg:L('car',12,2.6,25)}); },
    line:(dc)=>`Bop: ร้านริมน้ำเต็มคืนวันศุกร์\nเปลี่ยนเป็นครัวเรือนไม้ริมปิง เวลาเดิม 18:00 มีเมนูเจ (${sbaht(dc)}/คน)\nมิ้น: มีงานโทรจองร้านใหม่ ควรโทรก่อนเที่ยงวันศุกร์` }],
 },
 full_lunch3: {
  src:'มิ้นกด “ร้านเต็ม” · ก่อนเดินทาง', title:'ฮ้านแม่จันทร์เต็มช่วงเที่ยงวันอาทิตย์', day:2, need:'lunch3', live:false,
  na:'ร้านนี้ไม่อยู่ในแผนแล้ว',
  trace:[
    'มิ้นโทรแล้ว ร้านแจ้งว่าโต๊ะเต็มช่วง 11:00–13:00 วันอาทิตย์',
    'หาร้านแทนในรัศมี 1 กม.: 9 ร้าน → ไม่มีเมนูเจ 5 → เดินไปบ้านข้างวัดเกิน 300 ม. 3',
    'เลือก ครัวบ้านสวนหลังมอ · รับจอง · มีแกงฮังเลเจ',
    'สร้างงานโทรจองร้านใหม่ให้มิ้น · ช่วงอื่นไม่แตะ',
  ],
  options:[{ key:'A', title:'เปลี่ยนเป็นครัวบ้านสวนหลังมอ',
    head:'เวลาเดิม · ร้านใหม่ห่างร้านเดิม 300 ม.',
    build:p=>{ between(p,2,'jingjai','bankangwat',[LUNCH3B()]); },
    line:(dc)=>`Bop: ฮ้านแม่จันทร์เต็มช่วงเที่ยงวันอาทิตย์\nเปลี่ยนเป็นครัวบ้านสวนหลังมอ เวลาเดิม 11:30 มีเมนูเจ (${sbaht(dc)}/คน)\nมิ้น: มีงานโทรจองร้านใหม่ ควรโทรก่อน 20:00 วันเสาร์` }],
 },
 delay: {
  src:'ตรวจพบเช้าวันเดินทาง · ศ. 20 พ.ย. 07:20', title:'เที่ยวบินขาไปดีเลย์ 90 นาที', day:0, need:'cnx', live:true,
  applicable:p=>!p.flags.delay, na:'ปรับแผนรับไฟลต์ดีเลย์ไปแล้ว',
  trace:[
    'สายการบินแจ้ง: DMK → CNX เลื่อนเป็น 09:30 ถึง 10:45',
    'กระทบ: ช่วงเช้าวันศุกร์ 5 จุด · ข้าวซอยปิด 15:00 ต้องได้กินก่อน',
    'สลับข้าวซอยขึ้นก่อนวัดพระสิงห์ · ลดเวลาพักบ่าย',
    'ตั้งแต่ 15:30 ไม่เปลี่ยน · ไม่ต้องโหวต',
  ],
  options:[{ key:'A', title:'สลับมื้อกลางวันขึ้นก่อน',
    head:'พักบ่ายสั้นลง · ไม่มีค่าใช้จ่ายเพิ่ม',
    build:p=>{
      const d=p.days[0], g=id=>d.stops[idx(d,id)];
      const cnx=Object.assign(g('cnx'),{t0:'10:45',t1:'10:45',note:'ไฟลต์ดีเลย์ 90 นาที · ถึง 10:45'});
      const h=Object.assign(g('hotel1'),{t0:'11:05',t1:'11:15'});
      const k=Object.assign(g('khaosoi'),{t0:'11:25',t1:'12:10',leg:L('walk',6,.4)});
      const ps=Object.assign(g('phrasingh'),{t0:'12:20',t1:'13:05',leg:L('red',6,.9,20,'นั่งรถแดง ให้โอ๊ตเดินทั้งวันไม่เกิน 3 กม.')});
      const cl=Object.assign(g('chediluang'),{t0:'13:15',t1:'14:15',leg:L('red',6,.9,20,'นั่งรถแดงช่วงนี้ ให้โอ๊ตเดินทั้งวันไม่เกิน 3 กม.')});
      const r=Object.assign(g('rest1'),{t0:'14:25',t1:'15:30',note:'พักสั้นลงเพราะไฟลต์ดีเลย์',leg:L('red',6,.7,20)});
      const rest=d.stops.slice(idx(d,'warorot'));
      d.stops=[cnx,h,k,ps,cl,r,...rest]; p.flags.delay=true;
    },
    line:()=>`Bop: ไฟลต์ดีเลย์ 90 นาที ถึงเชียงใหม่ 10:45\nไปกินข้าวซอยก่อน แล้วค่อยไปวัดพระสิงห์กับวัดเจดีย์หลวง\nพักบ่ายสั้นลง ตั้งแต่ 15:30 เหมือนเดิม ไม่มีค่าใช้จ่ายเพิ่ม` }],
 },
};


export { clone, toM, fmtT, baht, sbaht, km, MODES, KCOL, MEMBERS, HOTEL, CNX, L, S, BASE, dayStats, checks, explain, SAMPLE_SETUP, same, diff, idx, has, between, vanHalf, LUNCH_NM, LUNCH3B, SCEN };

/* ---------- real travel times (OSRM) + scheduler ----------
   ROUTES[key] = { dur: seconds, dist: metres, geom: [[lng,lat],...] } from scripts/fetch-routes.mjs.
   OSRM gives free-flow time; each mode adds its own factor + waiting time. */
export const OSRM_PROFILE = { walk:'routed-foot', red:'routed-car', car:'routed-car', van:'routed-car', transit:'routed-car', own:'routed-car' };
export const MODE_ADJ = {
  walk:{ f:1.3,  wait:0, why:'เดินตามจังหวะโอ๊ต (ช้ากว่าปกติ 30%)' },
  red: { f:1.2,  wait:7, why:'รวมเวลาโบกรถแดง ~7 นาที' },
  car: { f:1.15, wait:5, why:'รวมเวลารอรถแอป ~5 นาที' },
  van: { f:1.1,  wait:3, why:'รวมเวลาขึ้นลงรถตู้' },
  own: { f:1.1,  wait:0, why:'ขับรถเอง (เผื่อช้ากว่าเส้นทางว่าง 10%)' },
  transit:{ f:1, wait:8, kmh:25, why:'ประมาณ 25 กม./ชม. รวมเดินและรอ ~8 นาที (ไม่มีข้อมูลตารางเดินรถ)' },
};
export const legKey = (a,b,m) => `${OSRM_PROFILE[m]}|${a[1]},${a[0]};${b[1]},${b[0]}`;
export function allLegs(p){
  const out=[];
  p.days.forEach(d=>d.stops.forEach((s,i)=>{ if(i && s.leg) { const a=d.stops[i-1].ll; if(a[0]!==s.ll[0]||a[1]!==s.ll[1]) out.push({a, b:s.ll, m:s.leg.m}); } }));
  return out;
}
/* Re-time a plan from real routes. Each stop keeps its planned start as "earliest start" and its dwell time;
   if the group can't arrive in time, the stop and everything after it slides later. */
export function schedule(p, ROUTES){
  p.days.forEach(d=>{
    if(!d.stops.length) return;
    let prevEnd = toM(d.stops[0].t1);
    d.stops.forEach((s,i)=>{
      if(!i) return;
      const dwell = toM(s.t1) - toM(s.t0);
      let travel = s.leg ? s.leg.min : 0;
      if(s.leg){
        const a=d.stops[i-1].ll, r=ROUTES[legKey(a,s.ll,s.leg.m)];
        if(r && Number.isFinite(r.dur) && Number.isFinite(r.dist)){
          const adj=MODE_ADJ[s.leg.m] || MODE_ADJ.car;
          if(s.leg.m==='transit') travel = s.leg.minSrc==='web' && s.leg.min>0 ? s.leg.min : Math.max(1, Math.ceil(r.dist/1000/adj.kmh*60 + adj.wait));
          else travel = Math.max(1, Math.ceil(r.dur/60*adj.f + adj.wait));
          s.leg.min = travel; s.leg.km = Math.round(r.dist/100)/10; s.leg.real = 1;
        }
      }
      const start = Math.max(toM(s.t0), prevEnd + travel);
      s.t0 = fmtT(start); s.t1 = fmtT(start + dwell);
      prevEnd = start + dwell;
    });
  });
  return p;
}

/* ---------- agent helpers: catalog, stop specs, edits (used by server/, DOM-free) ---------- */
const KINDS = ['stay','temple','food','nature','market','sight','transit','view'];
const MODE_KEYS = ['walk','red','car','van','transit','own'];
const TH_DOW = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
const TH_DOW_LONG = ['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์'];
const TH_MON = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
/* Thai labels for day i of a trip starting at ISO date `start`. */
function dayLabel(start, i){
  const d = new Date((start||'2026-11-20')+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+i);
  return { label:`${TH_DOW[d.getUTCDay()]} ${d.getUTCDate()} ${TH_MON[d.getUTCMonth()]}`, short:TH_DOW_LONG[d.getUTCDay()], date:d.toISOString().slice(0,10) };
}
/* Every place known to the sample (BASE + scenario stops), with verified coordinates. */
const CATALOG = (() => {
  const seen = new Map();
  const add = p => p.days.forEach(d=>d.stops.forEach(s=>{ if(!seen.has(s.id)){ const c=clone(s); delete c.leg; delete c.t0; delete c.t1; delete c.star; seen.set(s.id,c); } }));
  add(BASE);
  for(const k of Object.keys(SCEN)) for(const o of SCEN[k].options){ const p=clone(BASE); try{ o.build(p); add(p); }catch(e){} }
  return [...seen.values()];
})();
const R_EARTH = 6371;
function haversine(a,b){
  const r=x=>x*Math.PI/180, dLat=r(b[0]-a[0]), dLng=r(b[1]-a[1]);
  const h=Math.sin(dLat/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLng/2)**2;
  return 2*R_EARTH*Math.asin(Math.sqrt(h));
}
const round5 = n => Math.max(0, Math.round(n/5)*5);
const FUEL_THB_PER_KM = 4; // own car: fuel per km for the car, split between the people in it
/* Per-person THB estimate for a leg when the agent leaves the price to us. */
function legCostEstimate(m, kmv, n=4){
  n = Math.max(1, n||4);
  if(m==='walk') return 0;
  if(m==='red') return kmv<3 ? 20 : kmv<8 ? 30 : round5(30+4*(kmv-8));
  if(m==='car'){ const cars=Math.ceil(n/4); return round5((60+14*kmv)*cars/n); }
  if(m==='transit') return round5(35+3*kmv);
  if(m==='own') return Math.round(FUEL_THB_PER_KM*kmv/Math.max(1, Math.min(n, 5)));
  return 0; // van: chartered by the day, priced on the first van leg by the agent
}
/* Rough minutes before OSRM answers (schedule() replaces it with the real route). */
function legMinEstimate(m, kmv){
  const road = kmv*1.3;
  if(m==='walk') return Math.max(1, Math.ceil(road/4*60*1.3));
  if(m==='transit') return Math.max(1, Math.ceil(road/MODE_ADJ.transit.kmh*60 + MODE_ADJ.transit.wait));
  const speed = m==='own' ? (kmv>50 ? 75 : 30) : m==='van' ? 35 : 25, adj = MODE_ADJ[m];
  return Math.max(1, Math.ceil(road/speed*60*adj.f + adj.wait));
}
const HHMM = t => { const m=/^(\d{1,2}):(\d{2})$/.exec(String(t||'').trim()); return m ? String(Math.min(+m[1],29)).padStart(2,'0')+':'+m[2] : null; };
const slug = s => String(s||'').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,24) || 'stop';
const modelText = value => String(value||'').replace(/!\[([^\]]*)\]\(\s*<?https?:\/\/[^)]+\)/gi,'$1').replace(/\[([^\]]+)\]\(\s*<?https?:\/\/[^)]+\)/gi,'$1').trim();
const sourceUrl = value => {
  const raw=String(value||'').trim().replace(/&amp;/g,'&');
  const md=/!?\[[^\]]*\]\(\s*<?(https?:\/\/[^\s>]+?)>?(?:\s+["'][^"']*["'])?\s*\)/i.exec(raw);
  let candidate=md?.[1]||raw; if(!/^https?:\/\//i.test(candidate)) candidate=(/https?:\/\/[^\s<>"']+/i.exec(candidate)||[])[0]||'';
  candidate=candidate.replace(/[\])},.;!?]+$/,'');
  try{const url=new URL(candidate);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
};
/* Agent stop spec -> Stop. spec fields (all optional except n): id,n,k,t0,t1,lat,lng|ll,query,catalog,cost,walk,open,meal,veg,diet,walkin,
   outdoor,dress,star,note,reserve,resAsk,resBy,resPhone,mode,legCost,legWhy,source,srcUrl,srcTitle,checked */
function stopFromSpec(spec, base){
  const cat = spec.catalog ? CATALOG.find(c=>c.id===spec.catalog) : null;
  const b = base ? clone(base) : (cat ? clone(cat) : {});
  delete b.leg;
  const st = Object.assign({ id:'', n:'', k:'sight', t0:'09:00', t1:'10:00', ll:[0,0], cost:0, walk:0 }, b);
  if(spec.id) st.id = slug(spec.id);
  if(spec.n) st.n = modelText(spec.n);
  if(KINDS.includes(spec.k)) st.k = spec.k;
  const t0 = HHMM(spec.t0), t1 = HHMM(spec.t1);
  if(t0) st.t0 = t0; if(t1) st.t1 = t1;
  if(toM(st.t1) < toM(st.t0)) st.t1 = st.t0;
  const ll = Array.isArray(spec.ll) ? spec.ll : (Number.isFinite(spec.lat) && Number.isFinite(spec.lng) && (spec.lat||spec.lng) ? [spec.lat, spec.lng] : null);
  if(ll && !(cat && !base)) st.ll = [+(+ll[0]).toFixed(5), +(+ll[1]).toFixed(5)];
  if(Number.isFinite(spec.cost) && spec.cost>=0) st.cost = Math.round(spec.cost);
  if(Number.isFinite(spec.walk) && spec.walk>=0) st.walk = Math.round(spec.walk*10)/10;
  const flag = (k) => { if(spec[k]===true) st[k]=1; else if(spec[k]===false) delete st[k]; };
  ['veg','diet','walkin','outdoor','dress'].forEach(flag);
  const wds = a => Array.isArray(a) ? [...new Set(a.filter(w=>WD.includes(w)))] : null;
  if(spec.closedDays!==undefined || spec.onlyDays!==undefined){
    const closed = wds(spec.closedDays) || [], only = wds(spec.onlyDays) || [];
    const days = Object.assign({}, st.days||{}); delete days.closed; delete days.only;
    if(closed.length) days.closed = closed; if(only.length && only.length < 7) days.only = only;
    if(Object.keys(days).length) st.days = days; else delete st.days;
  }
  if(Array.isArray(spec.closures)){
    const cl = spec.closures.filter(c=>c && /^\d{4}-\d{2}-\d{2}$/.test(c.date)).slice(0,10).map(c=>c.why ? { date:c.date, why:String(c.why).slice(0,80) } : { date:c.date });
    if(cl.length) st.closures = cl; else delete st.closures;
  }
  if(spec.open!==undefined){ if(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(spec.open||'')) st.open = spec.open.split('-').map(HHMM).join('-'); else delete st.open; }
  if(spec.meal!==undefined){ if(['breakfast','lunch','dinner'].includes(spec.meal)) st.meal = spec.meal; else delete st.meal; }
  if(spec.star!==undefined){ if(spec.star) st.star = String(spec.star); else delete st.star; }
  if(spec.note!==undefined){ if(spec.note) st.note = modelText(spec.note); else delete st.note; }
  if(spec.reserve===true) st.res = Object.assign({}, st.res||{}, { phone:spec.resPhone || (st.res&&st.res.phone) || '', by:spec.resBy || (st.res&&st.res.by) || '', ask:spec.resAsk || (st.res&&st.res.ask) || '' });
  else if(spec.reserve===false) delete st.res;
  const srcUrl = sourceUrl(spec.srcUrl);
  if(spec.checked==='web' && srcUrl) st.src = { url:srcUrl, title:modelText(spec.srcTitle||srcUrl).slice(0,160), checked:'web' };
  else if(spec.checked) st.src = { url:'', title:'', checked:'estimate' };
  // walk-in / reservations only make sense where the group eats
  if(!(st.k==='food' || (st.k==='market' && st.meal))){ delete st.walkin; delete st.res; }
  const src = spec.source || (cat ? 'catalog' : (base && base.place ? base.place.source : 'model'));
  st.place = { query: modelText(spec.query || (base&&base.place&&base.place.query) || st.n), source: src };
  const al = Array.isArray(spec.aliases) && spec.aliases.length ? spec.aliases : (base&&base.place&&base.place.aliases);
  if(al && al.length) st.place.aliases = al.slice(0,6).map(String);
  if(base && base.leg && !MODE_KEYS.includes(spec.mode)) st.leg = clone(base.leg);
  if(spec.mode && MODE_KEYS.includes(spec.mode)){
    st.leg = { m:spec.mode, min:0, km:0, cost:0, why:spec.legWhy||'' };
    if(spec.mode==='own'){ st.leg.auto = 1; st.leg.extra = Number.isFinite(spec.legCost) && spec.legCost>0 ? Math.round(spec.legCost) : 0; } // parking/tolls per person; fuel added in priceLegs
    else if(Number.isFinite(spec.legCost) && spec.legCost>=0) st.leg.cost = Math.round(spec.legCost); else st.leg.auto = 1;
    const legSrcUrl = sourceUrl(spec.legSrcUrl);
    if(spec.legChecked==='web' && legSrcUrl){
      st.leg.src = { url:legSrcUrl, title:modelText(spec.legSrcTitle||legSrcUrl).slice(0,160), checked:'web' };
      if(Number.isFinite(spec.legMin) && spec.legMin>0){ st.leg.min = Math.round(spec.legMin); st.leg.minSrc = 'web'; }
    } else if(spec.legChecked) st.leg.src = { url:'', title:'', checked:'estimate' };
  }
  if(Number.isFinite(spec.localAmount) && spec.localAmount>0 && /^[A-Z]{3}$/.test(spec.localCurrency||'')) st.priceLocal = { amount:spec.localAmount, currency:spec.localCurrency };
  else if(spec.localAmount===0) delete st.priceLocal;
  return st;
}
/* Make legs consistent after structural changes: first stop of a day has no leg, others get one
   (walk if close, car otherwise); estimate min/km for legs that have no route yet. */
function fixLegs(p, n=4){
  p.days.forEach(d=>d.stops.forEach((s,i)=>{
    if(!i){ delete s.leg; return; }
    const a=d.stops[i-1].ll, dist=haversine(a,s.ll);
    if(!s.leg){ const m = dist<0.8 ? 'walk' : 'car'; s.leg = { m, min:0, km:0, cost:0, why:'', auto:1 }; }
    if(!s.leg.real || !s.leg.km){ s.leg.km = Math.round(dist*1.3*10)/10; if(s.leg.minSrc!=='web') s.leg.min = legMinEstimate(s.leg.m, dist); }
  }));
  return p;
}
/* Price legs the agent left to us (leg.auto), using the routed km. Call after schedule(). */
function priceLegs(p, n=4){
  p.days.forEach(d=>d.stops.forEach(s=>{ if(s.leg && s.leg.auto) s.leg.cost = legCostEstimate(s.leg.m, s.leg.km, n) + (s.leg.extra||0); }));
  return p;
}
function uniqueId(p, id){
  const used = new Set(p.days.flatMap(d=>d.stops.map(s=>s.id)));
  if(!used.has(id)) return id;
  let i=2; while(used.has(`${id}_${i}`)) i++; return `${id}_${i}`;
}
/* Build a Plan from the agent's day/stop specs. */
function buildPlan(specDays, setup = SAMPLE_SETUP){
  const p = { flags:{}, days:[] };
  specDays.forEach((sd,i)=>{
    const lab = dayLabel(setup.startDate, i);
    const day = { label:lab.label, short:lab.short, date:lab.date, stops:[] };
    p.days.push(day);
    (sd.stops||[]).forEach(spec=>{ const st=stopFromSpec(spec); st.id = uniqueId(p, st.id || slug(spec.n)); day.stops.push(st); });
  });
  return fixLegs(p, (setup.members||[]).length);
}
/* The leg's origin changed: its routed numbers and any web-checked minutes no longer apply. */
const staleLeg = l => { l.real=0; if(l.minSrc){ delete l.minSrc; } if(l.src && l.src.checked==='web') l.src = { url:'', title:'', checked:'estimate' }; };
const findStop = (p,id) => { for(let di=0; di<p.days.length; di++){ const i=idx(p.days[di],id); if(i>=0) return { di, i, s:p.days[di].stops[i] }; } return null; };
/* Apply minimal edits to a plan (returns a new plan).
   edit = { op:'remove', id } | { op:'insert', day, after:id|'' , stop:spec } | { op:'replace', id, stop:spec }
        | { op:'flag', key, value }
   replace keeps the old stop's fields (incl. coordinates when spec has no lat/lng and no new query) and overrides with spec. */
function applyEdits(plan, edits, setup = SAMPLE_SETUP){
  const p = clone(plan), errors = [], applied = [];
  p.flags = p.flags || {};
  for(const e of edits||[]){
    try{
      if(e.op==='remove'){
        const f=findStop(p,e.id); if(!f) throw new Error(`ไม่พบ ${e.id}`);
        f.s.res && f.s.res.done && errors.push(`ลบ ${e.id} ที่จองแล้ว`);
        p.days[f.di].stops.splice(f.i,1);
        const nx=p.days[f.di].stops[f.i]; if(nx && nx.leg){ staleLeg(nx.leg); nx.leg.auto = nx.leg.auto||(nx.leg.m!=='van'?1:0); }
      } else if(e.op==='insert'){
        const di = Math.max(0, Math.min(p.days.length-1, e.day|0));
        const d = p.days[di]; let at = 0;
        if(e.after){ const i=idx(d,e.after); if(i<0){ const f=findStop(p,e.after); if(!f) throw new Error(`ไม่พบ ${e.after}`); throw new Error(`${e.after} ไม่อยู่ในวันที่ ${di+1}`); } at=i+1; }
        const st = stopFromSpec(e.stop||{}); st.id = uniqueId(p, st.id || slug(st.n));
        d.stops.splice(at,0,st);
        const nx=d.stops[at+1]; if(nx && nx.leg) staleLeg(nx.leg);
      } else if(e.op==='replace'){
        const f=findStop(p,e.id); if(!f) throw new Error(`ไม่พบ ${e.id}`);
        const spec = Object.assign({}, e.stop||{});
        const samePlace = !spec.catalog && !(spec.lat||spec.lng||spec.ll);
        const st = stopFromSpec(spec, f.s);
        if(st.id!==f.s.id) st.id = uniqueId(p, st.id);
        if(!samePlace && (st.ll[0]!==f.s.ll[0] || st.ll[1]!==f.s.ll[1])){
          if(st.leg && !(e.stop && e.stop.legChecked==='web')) staleLeg(st.leg); else if(st.leg) st.leg.real=0;
          const nx=p.days[f.di].stops[f.i+1]; if(nx && nx.leg) staleLeg(nx.leg);
        }
        p.days[f.di].stops[f.i] = st;
      } else if(e.op==='flag'){ p.flags[e.key] = e.value; }
      else throw new Error(`ไม่รู้จัก op ${e.op}`);
      applied.push(e);
    }catch(err){ errors.push(err.message); }
  }
  // stops must stay in time order inside a day (agent inserts by position, schedule() only slides later)
  fixLegs(p, (setup.members||[]).length);
  return { plan:p, applied, errors };
}
/* ---------- booked stays by night ----------
   setup.stay = { mode:'booked', stays:[{ name, nights }] } in trip order: the first stay starts on night 1.
   Old setups { mode:'booked', name } mean one stay for every night. A trip of N days has N-1 nights. */
const MAX_STAYS = 7;
function bookedStays(stay, days){
  if(!stay || stay.mode!=='booked') return [];
  const N = Math.max(0, (Math.round(+days)||1) - 1);
  const raw = Array.isArray(stay.stays) ? stay.stays : (stay.name ? [{ name:stay.name }] : []);
  const list = raw.filter(x=>x && typeof x.name==='string' && x.name.trim()).slice(0, MAX_STAYS).map(x=>{
    const o = { name:x.name.trim().slice(0,120) };
    const n = Math.round(+x.nights);
    o.nights = Number.isFinite(n) && n>=0 ? n : null;
    if(Number.isFinite(x.lat) && Number.isFinite(x.lng) && (x.lat||x.lng)){ o.lat = x.lat; o.lng = x.lng; }
    return o;
  });
  if(!list.length) return [];
  if(list.length===1){ list[0].nights = N; return list; }
  list.forEach(x=>{ if(x.nights==null) x.nights = 1; });
  let sum = list.reduce((a,x)=>a+x.nights, 0);
  if(sum < N) list[list.length-1].nights += N - sum;
  for(let i=list.length-1; sum>N && i>=0; i--){ const cut = Math.min(list[i].nights, sum-N); list[i].nights -= cut; sum -= cut; }
  const kept = list.filter(x=>x.nights>0);
  return kept.length ? kept : [Object.assign(list[0], { nights:0 })];
}
/* Per day: the stay it starts at (night i-1) and ends at (night i). Day 1 starts at the arrival point and
   the last day ends at the departure point (start/end null). move = the group changes hotel that day. */
function dayStays(setup){
  const days = Math.max(1, Math.round(+(setup && setup.days))||1);
  const stays = bookedStays(setup && setup.stay, days);
  const night = [];
  stays.forEach((x,k)=>{ for(let j=0;j<x.nights;j++) night.push(k); });
  return Array.from({ length:days }, (_,i)=>{
    const a = i>0 && night[i-1]!=null ? night[i-1] : null, b = i<days-1 && night[i]!=null ? night[i] : null;
    return { start: a==null ? null : stays[a], end: b==null ? null : stays[b], startIdx:a, endIdx:b, move: a!=null && b!=null && a!==b };
  });
}
/* One Thai line per day for prompts (empty when the stay is not booked). */
function stayLine(setup, i){
  const ds = dayStays(setup)[i]; if(!ds || (!ds.start && !ds.end)) return '';
  const ll = x => Number.isFinite(x.lat) ? ` (${x.lat},${x.lng})` : '';
  if(ds.move) return `ที่พัก: เริ่มวันจาก ${ds.start.name}${ll(ds.start)} (เช็กเอาต์ ขนกระเป๋าไปด้วย) → นอนที่ ${ds.end.name}${ll(ds.end)} (เช็กอิน) · วันย้ายที่พัก`;
  if(ds.start && ds.end) return `ที่พัก: เริ่มวันจาก ${ds.end.name}${ll(ds.end)} และกลับมานอนที่เดิม`;
  if(ds.end) return `ที่พัก: เริ่มจากจุดมาถึง → นอนที่ ${ds.end.name}${ll(ds.end)} (เช็กอิน)`;
  return `ที่พัก: เริ่มวันจาก ${ds.start.name}${ll(ds.start)} (เช็กเอาต์) → จบที่จุดเดินทางกลับ`;
}
/* Compact plan text for prompts (with setup: the day's start/end hotel). */
function planBrief(p, setup){
  return p.days.map((d,i)=>{ const sl = setup ? stayLine(setup,i) : ''; return `วันที่ ${i+1} (${d.label}${d.date?' · '+d.date:''})${sl?' · '+sl:''}\n`+d.stops.map(s=>{
    const bits=[s.id, `${s.t0}-${s.t1}`, s.n, s.k, `฿${s.cost||0}`];
    if(s.walk) bits.push(`เดินในจุด ${s.walk}กม.`);
    if(s.open) bits.push(`เปิด ${s.open}`);
    if(s.days && s.days.only) bits.push(`เปิดเฉพาะ ${s.days.only.join(',')}`);
    if(s.days && s.days.closed) bits.push(`ปิด ${s.days.closed.join(',')}`);
    if(s.closures && s.closures.length) bits.push(`ปิดวันที่ ${s.closures.map(c=>c.date).join(',')}`);
    if(s.meal) bits.push(`meal=${s.meal}${s.veg?'+veg':''}${s.diet?'+diet':''}`); else if(s.veg) bits.push('veg');
    if(s.outdoor) bits.push('กลางแจ้ง'); if(s.star) bits.push(`star=${s.star}`);
    if(s.res) bits.push(`จอง${s.res.done?'แล้ว(done)':''}`);
    if(s.leg) bits.push(`มาจากจุดก่อน: ${s.leg.m} ${s.leg.min}นาที${s.leg.minSrc==='web'?'(เว็บ)':''} ${s.leg.km}กม. ฿${s.leg.cost||0}/คน`);
    bits.push(`@${s.ll[0].toFixed(4)},${s.ll[1].toFixed(4)}`);
    return '  - '+bits.join(' | ');
  }).join('\n'); }).join('\n');
}

export { WD, tripDay, closedWhy, openOn, CATALOG, KINDS, MODE_KEYS, dayLabel, haversine, legCostEstimate, legMinEstimate, stopFromSpec, fixLegs, priceLegs, buildPlan, applyEdits, findStop, planBrief, uniqueId, bookedStays, dayStays, stayLine };
