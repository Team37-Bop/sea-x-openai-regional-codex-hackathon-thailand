import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySavedMap } from '../web/saved-map.js';
import { plannedVisit } from '../web/place-details.js';

const cache = await mkdtemp(join(tmpdir(), 'bop-saved-map-'));
process.env.BOP_CACHE_DIR = cache;
const { recoverSavedDay, validateSavedPositions } = await import('../server/saved-map.mjs');
const { findSavedVenue } = await import('../server/geo.mjs');
const { matchesPick } = await import('../server/pick-match.mjs');
const { schedule } = await import('../server/schedule.mjs');
const { validatePlan } = await import('../server/plan.mjs');
after(() => rm(cache, {recursive:true, force:true}));
const first = [51.49, -0.108], cafe = [51.50, -0.111];
const leg = { key: 'old', min: 15, km: 0, mode: 'walk', unlocated: true };
function sample() {
  return { plan: {setup: {cityLL: first}, days: [{date: '2026-11-26',stops: [
    { id: 'park', ll: first, start: '11:30' },
    { id: 'meal', ll: first, start: '12:00', place: {fallback: true}, query: 'Named cafe, 24 Market Street', leg: {...leg} },
    { id: 'bags', ll: first, start: '13:10', place: {fallback: true}, leg: {...leg} },
  ]}]}, routes: {} };
}
test('archived day recovers a named venue and only its measured adjacent geometry', async () => {
  const source = sample(), original = structuredClone(source);
  const patch = await recoverSavedDay(source, 0, new AbortController().signal, {
    locate(stop) { assert.equal(stop.id, 'meal'); return cafe; },
    directions(from, to) {
      assert.deepEqual([from,to],[first,cafe]);
      return { key: 'real', real: true, min: 17, km: 0.9, geom: [from,to].map(([lat,lng])=>[lng,lat]), geometry: [from,to] };
    },
  });
  assert.deepEqual(source, original);
  applySavedMap(source.plan, source.routes, patch);
  const [park,meal,bags] = source.plan.days[0].stops;
  assert.deepEqual([park.start,meal.start,bags.start],['11:30','12:00','13:10']);
  assert.deepEqual(meal.ll, cafe);
  assert.equal(meal.place.fallback, undefined);
  assert.equal(meal.leg.real, true);
  assert.deepEqual(Object.keys(source.routes), ['real']);
  assert.equal(bags.place.fallback, true);
  assert.equal(bags.leg.key, '');
  assert.equal(bags.leg.unlocated, true);
});
test('an unavailable or distant routing result never reconnects a placeholder line', async () => {
  for (const result of [{real:false}, {real:true, key:'far', geom:[[0,1],[0,2]]}]) {
    const source = sample();
    const patch = await recoverSavedDay(source, 0, new AbortController().signal, {
      locate: () => cafe, directions: () => result,
    });
    applySavedMap(source.plan, source.routes, patch);
    assert.deepEqual(source.routes, {});
    assert.equal(source.plan.days[0].stops[1].leg.unlocated, true);
  }
});

test('archived geocoding requires the street, house number and business identity', async t => {
  const hit = (name, street, housenumber) => ({
    properties: {name, street, housenumber, osm_key: 'amenity', osm_value: 'cafe'},
    geometry: {coordinates: [cafe[1],cafe[0]]},
  });
  const query = 'Bop Sunflower Kitchen, 23–24 Market Lane, Archive Town';
  let rows = [hit('Bop Sunflower', 'Market Lane', '21'), hit('Unrelated', 'Market Lane', '23-24')];
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
    String(url).includes('photon') ? {features: rows} : [],
  )));
  const signal = new AbortController().signal;
  assert.equal(await findSavedVenue({query}, first, signal, {remaining:0}), null);
  rows = [hit('Bop Sunflower', 'Market Lane', '23-24')];
  assert.deepEqual(await findSavedVenue({query}, first, signal, {remaining:0}), cafe);
});

test('unknown inbound distance is exposed when the archived stop or its neighbour lacks a position', () => {
  const {plan} = sample(), day = plan.days[0], stop = day.stops[1];
  const text = plannedVisit({stop,day,setup:{members:[]}}).legText;
  assert.match(text, /ยังไม่ทราบระยะทาง/);
  assert.doesNotMatch(text, /0 กม\./);
});

test('replanning cannot assign a nearby museum pick to a placeholder hotel or restaurant', async () => {
  const museum = {id:'museum', name:'City Gallery', kind:'sight', ll:first};
  const hotel = {id:'hotel', name:'Unconfirmed hotel', kind:'stay', place:{source:'model',fallback:true}, ll:first};
  const setup = {city:'Example', cityLL:first, startDate:'2026-11-26', days:1, members:[{id:'a'}], picks:{must:[museum]}};
  assert.equal(matchesPick(hotel,museum),false);
  const result = await schedule({stops:[hotel,{...hotel,id:'cafe',name:'Unconfirmed lunch',kind:'food'},museum]},
    0,setup,{signal:new AbortController().signal},[],new Set(),{keep:true,offline:true});
  assert.deepEqual(result.day.stops.map(stop=>[stop.id,stop.place.source,Boolean(stop.place.fallback)]),[
    ['hotel','model',true],['cafe','model',true],['museum','pick',false],
  ]);
});

test('opening an archive removes only incompatible exact survey-coordinate assignments and their legs', () => {
  const pick = { id:'venue', name:'Named Gallery', kind:'sight', ll:first };
  const misplaced = {id:'lunch',name:'Another business',kind:'food',ll:first,place:{source:'pick'}};
  const saved = {plan:{setup:{picks:{must:[pick]}},days:[{stops:[
    {...misplaced,id:'bags',kind:'stay'},misplaced,
    {...pick,place:{source:'pick'},leg:{key:'from-lunch'}},
    {...misplaced,id:'confirmed',place:{source:'geocoded'},leg:{key:'keep'}},
    {...misplaced,id:'pinned',pinned:true},
  ]}]},routes:{'from-lunch':{},keep:{geom:[]}}};
  const safe = validateSavedPositions(saved), stops = safe.plan.days[0].stops;
  assert.deepEqual(stops.map(stop=>Boolean(stop.place.fallback)),[true,true,false,false,false]);
  assert.deepEqual(Object.keys(safe.routes),['keep']);
  assert.equal(stops[2].leg.unlocated,true);
  assert.deepEqual(saved.plan.days[0].stops[0].ll,first);
});

test('replan accepts an explicitly unlocated null point while retaining the coordinate and time checks', () => {
  const stop = {id:'hotel',name:'Hotel pending',start:'12:30',end:'13:00',ll:null,place:{fallback:true}};
  const plan = row => ({days:[{stops:[row]}]});
  assert.equal(validatePlan(plan(stop)).days[0].stops[0].ll, null);
  for (const invalid of [
    {place:{}}, {place:{fallback:'true'}}, {ll:undefined}, {ll:[0,0]}, {ll:['51','-0.1']},
    {ll:[100,200]}, {ll:[NaN,0]}, {start:'midday'}, {end:'24:99'}, {id:42},
  ]) assert.throws(() => validatePlan(plan({...stop,...invalid})), /แผนทริปไม่ถูกต้อง/);
});
