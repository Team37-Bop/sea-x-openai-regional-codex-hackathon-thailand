import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
process.env.BOP_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'fixture-key';
process.env.BOP_CACHE_DIR = await mkdtemp(join(tmpdir(), 'bop-stay-test-'));
delete process.env.BOP_FAKE_LLM;
const { normalize } = await import('../server/domain.mjs');
const { applyLodgingOffer, lodgingOffers, planTrip, resolveAutoLodging } = await import('../server/plan.mjs');
const { selectLodging } = await import('../server/lodging.mjs');
const ctx = () => ({ signal: new AbortController().signal, step() {}, usage: {} });
const setup = normalize({ city: 'ลอนดอน', cityLL: [51.508,-.12], days: 2, startDate: '2026-11-22',
  members: [{name:'Private guest',budget:10000}], extra:'Private notes' });
const venue = { name:'Waterloo Example Hotel', query: 'Waterloo Example Hotel, Waterloo, London',
  ll:[51.5011,-.1141], priceNight:0, why:'เดินถึงสถานี Waterloo ได้',
  src:{url:'https://example.com/hotels/waterloo',title:'Waterloo Example Hotel'} };
const stop = (id,k,n,ll,extra={}) => ({id,n,k,ll,t0:'12:00',t1:'12:30',place:{source:'pick'},...extra});
function mockHotel(t, checked, value=venue, replies={}) {
  const requests=[];
  t.mock.method(globalThis,'fetch',async (url,init)=>{
    const address=new URL(String(url));
    if(address.hostname==='api.openai.com') {
      const body=JSON.parse(init.body);
      const op=body.text.format.name;
      assert.ok(op==='bop_lodging'||replies[op],op);
      if(op==='bop_lodging')requests.push(JSON.parse(body.input.at(-1).content.split('ข้อมูล JSON:\n').at(-1)));
      const options = Array.isArray(value) ? value : [value];
      const evidence = checked ? options.filter(row => row.cited !== false).map(row => ({type:'url_citation',...row.src})) : [];
      const response={type:'response.completed',response:{status:'completed',output:[{type:'message',content:[
        {type:'output_text',text:JSON.stringify(op==='bop_lodging'?{options}:replies[op]),annotations: op==='bop_lodging' ? evidence : []},
      ]}]}};
      return new Response('event: response.completed\ndata: '+JSON.stringify(response)+'\n\n');
    }
    assert.ok(['photon.komoot.io','nominatim.openstreetmap.org'].includes(address.hostname),address.hostname);
    assert.doesNotMatch(address.href,/Private|Secret/);
    return Response.json(address.hostname.includes('photon')?{features:[]}:[]);
  });
  return requests;
}
test('an archived auto stay uses only city, area and dates in search; one named hotel anchors luggage, nights and checkout without a booking', async t=>{
  const requests=mockHotel(t,true);
  const plan={city:setup.city,setup,flags:{stay:{area:'Waterloo ฝั่ง South Bank',why:'Private hints',booked:false,examples:[],stays:[]}},
    days:[{date:'2026-11-22',stops:[
      stop('bags','stay','ที่พักย่าน Waterloo — ฝากกระเป๋า',null,{place:{fallback:true},note:'ยังไม่ได้เลือกโรงแรม'}),
      stop('cafe','food','Secret café',[51.51,-.13]),
    ]},{date:'2026-11-23',stops:[stop('museum','sight','Secret museum',[51.51,-.13])]}]};
  const saved={plan,routes:{}};
  const result=await resolveAutoLodging(saved,ctx());
  assert.deepEqual(requests,[{city:setup.city,area:'Waterloo',startDate:setup.startDate,endDate:setup.endDate}]);
  assert.deepEqual(plan.flags.stay.stays,[]);
  assert.equal(result.plan.flags.stay.booked,false);
  const stay=result.plan.flags.stay.stays[0];
  assert.deepEqual([stay.name,stay.ll,stay.priceNight,stay.cost],[venue.name,venue.ll,null,null]);
  assert.equal(stay.url,venue.src.url);
  for(const s of result.plan.days.flatMap(d=>d.stops).filter(s=>['hotel','stay'].includes(s.k))) {
    assert.equal(s.name,venue.name); assert.deepEqual(s.ll,venue.ll);
    assert.doesNotMatch(s.note||'',/ยังไม่ได้เลือก/);
  }
  assert.match(result.plan.days[0].stops[0].note,/ฝากกระเป๋า/);
  assert.equal(result.plan.days[0].stops[0].cost,null);
  assert.equal(result.plan.days[0].stops.at(-1).name,stay.name);
  assert.equal(result.plan.days[1].stops[0].name,stay.name);
});
test('an unverified property cannot complete a recommendation, and a chosen hotel keeps its exact position',async t=>{
  mockHotel(t,false);
  assert.equal(await selectLodging(setup,{area:'Waterloo'},[],ctx(),true),undefined);
  const chosen={name:'My Specific Hotel',query:'My Specific Hotel London',kind:'stay',ll:[51.505,-.12]};
  const result=await selectLodging({...setup,picks:{must:[chosen]}},{},[],ctx(),true);
  assert.deepEqual(result.hotel.ll,chosen.ll);assert.equal(result.hotel.name,chosen.name);
  assert.equal(result.hotel.locationSource,'pick');
});

test('fresh overnight planning replaces a design that only named the area with the selected hotel before scheduling',async t=>{
  const requests=mockHotel(t,true,{...venue,priceNight:2400},{
    bop_design:{stay:{area:'Waterloo',why:'ใกล้สถานี',examples:[]},days:[
      {stops:[stop('checkin','stay','ที่พักย่าน Waterloo — เช็กอิน',venue.ll)]},
      {stops:[stop('checkout','stay','ที่พักย่าน Waterloo — เช็กเอาต์',venue.ll)]},
    ]},bop_repair:{edits:[]},
  });
  const {plan}=await planTrip(setup,ctx());
  assert.equal(requests.length,1);
  const stay=plan.flags.stay.stays[0];
  assert.deepEqual([stay.name,stay.cost,stay.checkIn,stay.checkOut],[venue.name,1200,setup.startDate,setup.endDate]);
  assert.equal(plan.flags.stay.booked,false);
  assert.equal(plan.flags.stay.selection,'recommended');
  assert.equal(plan.flags.stay.recommendedId, plan.flags.stay.options[0].id);
  assert.deepEqual(plan.days.flatMap(d=>d.stops.map(s=>s.name)),[venue.name,venue.name]);
});

test('an offered hotel reaches itinerary design, overrides another suggested branch and anchors every stay without a lodging lookup', async t => {
  const { operationalStore } = await import('../server/operation-store.mjs');
  const other = { ...venue, name:'Different Suggested Hotel', ll:[51.509,-.12] };
  const id = 'survey-hotel';
  const offered = { id, kind:'hotel', name:venue.name, query:venue.query, address:'Example Street, Waterloo, London',
    ll:venue.ll, priceNight:2800, src:{...venue.src,checked:'web'}, why:venue.why };
  const ref = await operationalStore.rememberHotelSurvey(JSON.stringify([setup.city, '', setup.startDate, setup.days]), [offered]);
  const ops = [];
  t.mock.method(globalThis,'fetch',async (input, init) => {
    const url = new URL(input);
    if (url.hostname !== 'api.openai.com') return Response.json(url.hostname.includes('photon') ? {features:[]} : []);
    const body = JSON.parse(init.body), op = body.text.format.name;
    ops.push(op);
    assert.ok(['bop_design','bop_repair'].includes(op),op);
    if (op === 'bop_design') {
      const data = JSON.parse(body.input[0].content.split('ข้อมูล JSON:\n').at(-1));
      assert.equal(data.stayPlan[0].end, offered.name);
      assert.deepEqual(data.stayPlan[1].startLL, offered.ll);
    }
    const value = op === 'bop_repair' ? {edits:[]} : {stay:{area:'Elsewhere',examples:[other]}, days:[
      {stops:[stop('bags','hotel','ฝากกระเป๋าที่ '+other.name,other.ll), stop('bed','hotel',other.name,other.ll)]},
      {stops:[stop('out','hotel',other.name,other.ll)]},
    ]};
    const response = {type:'response.completed',response:{status:'completed',output:[{type:'message',content:[
      {type:'output_text',text:JSON.stringify(value),annotations:[]},
    ]}]}};
    return new Response('event: response.completed\ndata: '+JSON.stringify(response)+'\n\n');
  });
  const { plan } = await planTrip({...structuredClone(setup), picks:{must:[{ ...offered, surveyRef:ref, priceNight:1, src:{checked:'web',url:'https://wrong.example/'} }]}},ctx());
  assert.ok(ops.includes('bop_design'));
  assert.equal(plan.flags.stay.selection,'chosen');
  assert.equal(plan.flags.stay.booked,false);
  const stay = plan.flags.stay.stays[0];
  assert.deepEqual([stay.name,stay.address,stay.priceNight,stay.cost,stay.url],[offered.name,offered.address,2800,1400,venue.src.url]);
  const anchors = plan.days.flatMap(day => day.stops.filter(row => row.kind === 'hotel'));
  assert.equal(anchors.length,3);
  for (const row of anchors) {
    assert.equal(row.name,offered.name);
    assert.deepEqual(row.ll,offered.ll);
    assert.equal(row.src.url,venue.src.url);
    assert.equal(row.res?.done,undefined);
  }
});

test('automatic lodging excludes rejected hotels while a legacy neighborhood is a search preference', async t => {
  const rejected = { ...venue, name:'Rejected Example Hotel' };
  const requests = mockHotel(t,true,[rejected,venue]);
  const result = await selectLodging({ ...setup, picks:{
    must:[{kind:'stay',name:'South Bank',ll:[51.51,-.12]}], avoid:[{kind:'hotel',name:rejected.name}],
  } }, {area:'Elsewhere'}, [],ctx(),true);
  assert.equal(requests[0].area,'South Bank');
  assert.deepEqual(requests[0].exclude,[rejected.name]);
  assert.deepEqual(result.options.map(o => o.name),[venue.name]);
});

test('day trips and existing named stays never run a hotel search', async t => {
  const requests = mockHotel(t,true,venue,{
    bop_design:{stay:{examples:[venue]},days:[0,1].map(i => ({stops:[stop('visit'+i,'sight','Gallery',venue.ll)]}))},
    bop_repair:{edits:[]},
  });
  const second = {name:'Second Booked Hotel',ll:[51.501,-.113],nights:1};
  for (const [days, stay, names] of [
    [1, {mode:'auto'}, []],
    [2, {name:venue.name,ll:venue.ll}, [venue.name]],
    [2, {mode:'booked',stays:[{name:second.name,ll:second.ll,nights:1}]}, [second.name]],
  ]) {
    const draft = normalize({ city:'London', cityLL:setup.cityLL, country:'GB', startDate:setup.startDate,
      members:[{name:'Test guest'}], stay, days });
    const {plan} = await planTrip(draft,ctx());
    assert.deepEqual(plan.flags.stay.stays.map(row => row.name),names);
    assert.deepEqual(plan.flags.stay.examples,[]);
    assert.equal(plan.flags.stay.selection,undefined);
  }
  assert.deepEqual(requests,[]);
  const multiple = normalize({city:'London',startDate:setup.startDate,members:[{name:'Test guest'}],days:4,
    stay:{stays:[{name:venue.name,ll:venue.ll,nights:1},second]}});
  assert.deepEqual(multiple.stay.stays.map(row => [row.name,row.nights]),[[venue.name,1],[second.name,2]]);
});

test('presenting verified branches leaves the saved itinerary untouched, and choosing an alternative switches each hotel anchor', async t => {
  const second = {...venue, name:'South Bank Example Inn', ll:[51.503,-.109],
    query:'South Bank Example Inn, Waterloo Road', priceNight:3400, why:'เดินไปริมน้ำสะดวก',
    src:{url:'https://example.com/hotels/south-bank',title:'South Bank Example Inn'}};
  const unverified = {...venue,name:'Unknown Hotel',src:{url:'https://example.com/unverified'},cited:false};
  const requests = mockHotel(t,true,[venue,second,unverified]);
  const saved = {plan:{city:setup.city,setup,flags:{stay:{area:'Waterloo',stays:[]}},days:[
    {stops:[stop('bags','hotel','ที่พักย่าน Waterloo — ฝากกระเป๋า',null,{place:{fallback:true},
      src:{url:'https://old.example/hotel',checked:'web'}, phone:'01234', res:{todo:true,phone:'01234'}, open:'12:00', catalogId:'old'}),
      stop('gallery','sight','Test Gallery',[51.51,-.13])]},
    {stops:[stop('sight','sight','Test Park',[51.51,-.13])]}
  ]},routes:{}};
  const original = structuredClone(saved);
  const offer = await lodgingOffers(saved,ctx());
  assert.deepEqual(saved,original);
  assert.deepEqual(offer.options.map(row => row.name),[venue.name,second.name]);
  assert.equal(offer.options[0].priceNight,null);
  assert.equal(offer.recommendedId,offer.options[0].id);
  await assert.rejects(applyLodgingOffer(saved,offer,'choose','hotel-invented',ctx()),{code:'bad_request'});
  const chosen = await applyLodgingOffer(saved,offer,'choose',offer.options[1].id,ctx());
  assert.equal(chosen.plan.flags.stay.selection,'chosen');
  assert.equal(chosen.plan.flags.stay.booked,false);
  assert.equal(chosen.plan.flags.stay.stays[0].cost,1700);
  const anchors = chosen.plan.days.flatMap(d => d.stops.filter(s => s.k === 'hotel'));
  assert.ok(anchors.length >= 3);
  for (const row of anchors) {
    assert.equal(row.name,second.name);
    assert.deepEqual(row.ll,second.ll);
    assert.equal(row.src.url,second.src.url);
    assert.equal(row.res,undefined);
    assert.equal(row.phone,undefined);
    assert.equal(row.open,undefined);
    assert.equal(row.catalogId,undefined);
  }
  assert.deepEqual(saved,original);
  assert.equal(requests.length,1);
  const recommended = await applyLodgingOffer(saved,offer,'recommend',undefined,ctx());
  assert.equal(recommended.plan.flags.stay.selection,'recommended');
  assert.equal(recommended.plan.flags.stay.stays[0].name,venue.name);
  assert.deepEqual(await applyLodgingOffer(chosen,offer,'choose',offer.options[1].id,ctx()),chosen);
  await assert.rejects(applyLodgingOffer(chosen,offer,'choose',offer.options[0].id,ctx()),{code:'bad_request'});
});

async function lodgingPost(body) {
  const {invoke} = await import('../server/lambda-handler.mjs');
  let result = '';
  const response = new Writable({write(chunk, encoding, done) { result += chunk; done(); }});
  await invoke({path:'/api/plan/lodging',httpMethod:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)}, response, stream => stream);
  return JSON.parse(result.trim().split('\n').at(-1));
}

test('stateless hotel actions use server evidence, rediscover on a cold worker and reject injected candidates', async t => {
  const requests = mockHotel(t,true);
  const plan = {city:setup.city,setup,days:[{stops:[stop('gallery','sight','Gallery',[51.505,-.11])]},
    {stops:[stop('museum','sight','Museum',[51.51,-.12])]}],
    flags:{stay:{area:'Waterloo',offerRef:'unrecognized',options:[]}}};
  const forged = {id:'hotel-injected',name:'Injected',ll:[51.505,-.12],query:'Injected',url:'https://fabricated.example/',
    title:'Invented source',checked:'web',locationSource:'geocoded'};
  plan.flags.stay.options.push(forged);
  const denied = await lodgingPost({plan,routes:{},action:'choose',optionId:forged.id});
  assert.equal(denied.type,'error');
  const offered = await lodgingPost({plan,action:'options'});
  assert.equal(offered.type,'done');
  assert.deepEqual(offered.options.map(o=>o.name),[venue.name]);
  assert.ok(offered.offerRef);
  plan.flags.stay.offerRef = offered.offerRef;
  const stale = await lodgingPost({plan,action:'recommend',optionId:forged.id});
  assert.equal(stale.type,'error');
  const result = await lodgingPost({plan,routes:{},action:'choose',optionId:offered.options[0].id});
  assert.equal(result.type,'done');
  assert.equal(result.plan.flags.stay.stays[0].url,venue.src.url);
  assert.equal(result.plan.flags.stay.selection,'chosen');
  assert.equal(requests.length,2);
  for (const data of requests) assert.deepEqual(Object.keys(data).sort(),['area','city','endDate','startDate']);
});

test('archived HTTP discovery is read-only and a manual selection retains the original snapshot at the same link', async t => {
  const {handleRequest} = await import('../server/http.mjs');
  const {saveLocalTrip,readLocalTrip} = await import('../server/local-showcase.mjs');
  const previous = process.env.BOP_LOCAL_DEMO;
  process.env.BOP_LOCAL_DEMO = '1';
  t.after(() => { if (previous === undefined) delete process.env.BOP_LOCAL_DEMO; else process.env.BOP_LOCAL_DEMO = previous; });
  const other = {...venue,name:'Second Example Inn',ll:[51.502,-.117],src:{url:'https://example.com/hotels/second',title:'Second Inn'}};
  const requests = mockHotel(t,true,[venue,other]);
  const original = {plan:{city:setup.city,setup,flags:{stay:{area:'Waterloo'}},days:[
    {stops:[stop('a','sight','Test Gallery',[51.511,-.13])]}, {stops:[stop('b','sight','Test Museum',[51.512,-.12])]}
  ]},routes:{}};
  const host = {socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost','content-type':'application/json'}};
  const id = await saveLocalTrip(host,original);
  async function post(input) {
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),host,
      {url:'/api/local-trips/'+id+'/lodging',method:'POST'});
    let text = '';
    const response = new Writable({ write(chunk,encoding,done){text+=chunk;done();} });
    Object.assign(response,{setHeader(){},writeHead(){},flushHeaders(){}});
    await handleRequest(request,response);
    return JSON.parse(text.trim().split('\n').at(-1));
  }
  const offers = await post({action:'options'});
  assert.equal(offers.type,'done');
  assert.deepEqual(await readLocalTrip(host,id),original);
  const wrong = await post({action:'choose',optionId:'hotel-invented',options:[venue]});
  assert.equal(wrong.type,'error');
  assert.deepEqual(await readLocalTrip(host,id),original);
  const result = await post({action:'choose',optionId:offers.options[1].id});
  assert.equal(result.type,'done');
  assert.equal(result.plan.flags.stay.stays[0].name,other.name);
  assert.deepEqual(JSON.parse(JSON.stringify((await readLocalTrip(host,id)).plan)),result.plan);
  const stored = JSON.parse(await readFile(join(process.env.BOP_CACHE_DIR,'showcase',id+'.json'),'utf8'));
  assert.deepEqual(stored.plan,JSON.parse(JSON.stringify(original.plan)));
  assert.equal(stored.lodgingRevision.plan.flags.stay.selection,'chosen');
  assert.equal(requests.length,1);
});
