import { randomUUID } from 'node:crypto';
import { bad, str } from './domain.mjs';
import { hotelOptions } from './lodging.mjs';
import { applyLodgingOffer, lodgingOffers, validatePlan } from './plan.mjs';
import { needsLodgingChoice } from '../web/lodging-state.js';

// Only lists issued by the server enter this short-lived cache. A cold worker can
// independently rediscover public branches without trusting browser-supplied evidence.
const presented = new Map();
const lifetime = 2 * 60 * 60 * 1000;
function scope(plan) {
  const { city, startDate, endDate, hotelArea } = plan.setup;
  return JSON.stringify([city, str(hotelArea || plan.flags?.stay?.area, 200), startDate, endDate]);
}
function remember(plan, offer) {
  if (!offer.options.length) return offer;
  const offerRef = randomUUID();
  const result = { ...offer, offerRef };
  presented.set(offerRef, { result, scope: scope(plan), expires: Date.now() + lifetime });
  if (presented.size > 128) presented.delete(presented.keys().next().value);
  return result;
}
export function rememberPlannedLodging(plan) {
  const stay = plan?.flags?.stay;
  if (!needsLodgingChoice(plan) || !Array.isArray(stay?.options)) return;
  const options = hotelOptions(stay.options, plan.setup);
  const offer = remember(plan, { area: str(stay.area, 200), options, recommendedId: options[0]?.id || '' });
  if (offer.offerRef) stay.offerRef = offer.offerRef;
}
export async function statelessLodging(input, ctx) {
  const plan = validatePlan(input.plan);
  if (!needsLodgingChoice(plan)) throw bad('ทริปนี้ระบุที่พักแล้ว');
  const stay = plan.flags?.stay || {};
  const cached = presented.get(stay.offerRef);
  const offer = cached && cached.scope === scope(plan) && cached.expires > Date.now()
    ? cached.result
    : remember(plan, await lodgingOffers({ plan }, ctx, { publicSearch: true }));
  if (input.action === 'options') return offer;
  const saved = { plan, routes: input.routes || {} };
  return applyLodgingOffer(saved, offer, input.action, input.optionId, ctx);
}
