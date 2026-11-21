import test from 'node:test';
import assert from 'node:assert/strict';
import { needsLodgingChoice } from '../web/lodging-state.js';

test('a provisional or older Bop hotel still needs a presentation choice until the party confirms it', () => {
  const plan = { setup: { stay: { mode: 'auto' } }, days: [{}, {}], flags: { stay: { stays: [{ name: 'River Hotel' }] } } };
  assert.equal(needsLodgingChoice(plan), true);
  plan.flags.stay.selection = 'provisional';
  assert.equal(needsLodgingChoice(plan), true);
  plan.setup.picks = { must: [{ kind: 'stay', name: 'River district' }] };
  assert.equal(needsLodgingChoice(plan), true);
  plan.setup.picks.must[0].name = 'River Hotel';
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
