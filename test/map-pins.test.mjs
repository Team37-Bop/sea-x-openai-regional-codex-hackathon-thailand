import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayRouteFeatures, groupNearbyVisits, visitCoordinates, routeLegendEntries } from '../web/map.js';

test('a synthetic stop does not become a map pin or a route endpoint', () => {
  const ll = [51.5, -0.12];
  assert.equal(visitCoordinates({ ll, place: { fallback: true } }), undefined);
  assert.deepEqual(visitCoordinates({ ll, place: { source: 'pick' } }), [-0.12, 51.5]);
});

test('coincident visits retain every target at one true anchor; zoom separates nearby visits', () => {
  const point = (entry, x) => ({ entry, x, y: 100 });
  const first = point('day 1 dinner', 10), repeat = point('day 4 breakfast', 10);
  const nearby = point('bookshop', 28);
  assert.deepEqual(groupNearbyVisits([first, repeat, nearby]), [
    { x: 10, y: 100, members: [first.entry, repeat.entry, nearby.entry] },
  ]);
  assert.deepEqual(groupNearbyVisits([repeat, first, { ...nearby, x: 83 }]), [
    { x: 10, y: 100, members: [repeat.entry, first.entry] },
    { x: 83, y: 100, members: [nearby.entry] },
  ]);
});

test('the trip key lists modes from every known day, including unresolved legs, before any line is available', () => {
  const trip = [
    { stops: [{}, { leg: { mode: 'car' } }] },
    undefined,
    { stops: [{ leg: { m: 'transit', unlocated: true } }, { leg: { mode: 'walk' } }, { leg: { m: 'car' } }] },
  ];
  assert.deepEqual(routeLegendEntries(trip).map(({ mode, stroke }) => [mode, stroke]), [
    ['walk', 'walk'], ['transit', 'transit'], ['car', 'road'],
  ]);
  assert.deepEqual(routeLegendEntries([{ stops: [{ name: 'Candidate' }] }]), []);
  const feature = stroke => ({ properties: { mode: 'transit', stroke, color: '#695396' } });
  const entries = routeLegendEntries(trip, [feature('transit'), feature('estimate'), feature('estimate'), feature('removed')]);
  assert.deepEqual(entries.map(e => e.stroke), ['walk', 'transit', 'road', 'estimate', 'removed']);
});

test('the key names each identified public service and keeps an unspecified transit leg generic', async () => {
  const { legLabels } = await import('../web/leg-modes.js');
  const trip = [{ stops: ['transit', 'train', 'subway', 'ferry', 'bus'].map(mode => ({ leg: { mode } })) }];
  const entries = routeLegendEntries(trip);
  assert.deepEqual(entries.map(entry => legLabels[entry.mode]), [
    'ขนส่งสาธารณะ', 'รถไฟ', 'รถไฟฟ้า/รถไฟใต้ดิน', 'เรือโดยสาร', 'รถโดยสารประจำทาง',
  ]);
  assert.equal(new Set(entries.map(entry => entry.color)).size, 5);
  assert.ok(entries.every(entry => entry.stroke === 'transit'));
});

test('the map connects the order of known stops across each gap without using unresolved coordinates or bridging days', () => {
  const at = n => ({ id: String(n), ll: [15, 99 + n] });
  const unknown = { ...at(5), place: { fallback: true } };
  const day = { stops: [at(1), unknown, { id: 'no coordinates' }, at(2), at(3)] };
  const { features } = dayRouteFeatures(day, {});
  assert.deepEqual(features.map(f => [f.properties.stroke, f.properties.gap, f.geometry.coordinates]), [
    ['sequence', true, [[100, 15], [101, 15]]],
    ['sequence', false, [[101, 15], [102, 15]]],
  ]);
  assert.ok(features.every(f => f.properties.approx && f.properties.mode === undefined));
  const onlyOneKnown = { stops: [at(4), unknown] };
  assert.deepEqual(dayRouteFeatures(onlyOneKnown, {}).features, []);
  assert.deepEqual(dayRouteFeatures(day, {}, true).features, []);
  assert.equal(routeLegendEntries([day],features).length,2);
});

test('a road snapped away from the POIs keeps its exact measured geometry and gets separate access connectors only in a committed view', () => {
  const geometry = [[100.0001,15],[100.5,15.05],[100.9999,15]];
  const day = { stops: [
    { ll: [15, 100] }, { ll: [15, 101], leg: { mode: 'car', real: true, key: 'r' } },
  ] };
  const { features } = dayRouteFeatures(day, { r: { geom: geometry } });
  assert.deepEqual(features.map(f=>f.properties.stroke), ['road', 'access', 'access']);
  assert.deepEqual(features[0].geometry.coordinates, geometry);
  assert.deepEqual(features.slice(1).map(f=>f.geometry.coordinates), [
    [[100,15], geometry[0]], [geometry.at(-1), [101,15]],
  ]);
  assert.ok(features.slice(1).every(f=>f.properties.approx));
  assert.deepEqual(dayRouteFeatures(day,{r:{geom:geometry}},true).features.map(f=>f.properties.stroke), ['road']);
  day.stops[1].leg.geometry=geometry.map(([lng, lat])=>[lat, lng]);
  assert.deepEqual(dayRouteFeatures(day,{}).features[0].geometry.coordinates, geometry);
});
