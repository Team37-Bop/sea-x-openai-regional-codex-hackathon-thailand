import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupNearbyVisits, visitCoordinates } from '../web/map.js';

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
