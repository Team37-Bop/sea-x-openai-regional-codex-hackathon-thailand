import test from 'node:test';
import assert from 'node:assert/strict';
import { needsLodgingChoice } from '../web/lodging-state.js';
import { candidateQuestions } from '../web/setup-extras.js';

test('unresolved archived lodging supports a manual choice until the party selects a property', () => {
  const plan = { setup: { stay: { mode: 'auto' } }, days: [{}, {}], flags: { stay: { stays: [{ name: 'River Hotel' }] } } };
  assert.equal(needsLodgingChoice(plan), true);
  plan.flags.stay.selection = 'provisional';
  assert.equal(needsLodgingChoice(plan), true);
  plan.setup.picks = { must: [{ kind: 'stay', name: 'River district' }] };
  assert.equal(needsLodgingChoice(plan), true);
  plan.setup.picks.must[0].name = 'River Hotel';
  assert.equal(needsLodgingChoice(plan), false);
  plan.setup.picks.must = [{ id: 'h1', kind: 'hotel', name: 'Selected Hotel' }];
  assert.equal(needsLodgingChoice(plan), false);
  plan.setup.picks.must = [];
  for (const confirmed of ['chosen', 'recommended']) {
    plan.flags.stay.selection = confirmed;
    assert.equal(needsLodgingChoice(plan), false);
  }
  delete plan.flags.stay.selection;
  assert.equal(needsLodgingChoice({ ...plan, days: [{}] }), false);
  const bookedStop = { kind: 'hotel', res: { done: true } };
  assert.equal(needsLodgingChoice({ ...plan, days: [{ stops: [bookedStop] }, {}] }), false);
  plan.setup.stay = { mode: 'booked', name: 'My hotel' };
  assert.equal(needsLodgingChoice(plan), false);
});

test('hotel questions retain named property details and omit legacy area suggestions', () => {
  const hotel = { kind: 'hotel', id: 'h1', name: 'River Hotel', address: '2 River St', priceNight: 2500 };
  const area = { kind: 'stay', name: 'Riverside district' };
  const food = { kind: 'food', id: 'f1', name: 'River Café' };
  const sight = { kind: 'sight', id: 's1', name: 'River Park' };
  const groups = candidateQuestions({ candidates: [sight, food, area, hotel] });
  assert.deepEqual(groups.map(q => [q.kind, q.options]), [['stay', [hotel]], ['food', [food]], ['sight', [sight]]]);
  const recorded = { kind: 'stay', multi: false, options: [area, hotel] };
  const first = { kind: 'sight', options: [sight] }, second = { kind: 'food', options: [food] };
  assert.deepEqual(candidateQuestions({ questions: [first, second, recorded] }), [{ ...recorded, options: [hotel] }, second, first]);
  assert.deepEqual(candidateQuestions({ questions: [{ ...recorded, options: [area] }, second] }), [second]);
});
