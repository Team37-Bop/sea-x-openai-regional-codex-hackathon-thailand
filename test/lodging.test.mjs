import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.BOP_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'fixture-key';
process.env.BOP_CACHE_DIR = await mkdtemp(join(tmpdir(), 'bop-stay-test-'));
delete process.env.BOP_FAKE_LLM;
const { normalize } = await import('../server/domain.mjs');
const { planTrip, resolveAutoLodging } = await import('../server/plan.mjs');
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
      const response={type:'response.completed',response:{status:'completed',output:[{type:'message',content:[
        {type:'output_text',text:JSON.stringify(op==='bop_lodging'?value:replies[op]),annotations: checked && op==='bop_lodging' ? [{type:'url_citation',...venue.src}] : []},
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
  assert.deepEqual(plan.days.flatMap(d=>d.stops.map(s=>s.name)),[venue.name,venue.name]);
});
