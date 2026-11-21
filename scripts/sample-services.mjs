// The offline Chiang Mai planner uses bundled road data and never contacts a provider.
import seed from '../src/routes.json' with { type: 'json' };
import { legKey, routeResult } from '../server/route-result.mjs';
export { legKey };
export { matchesPick } from '../server/pick-match.mjs';
export function route(from, to, mode, signal, offline, leg) {
  signal.throwIfAborted();
  const measured = seed[legKey(from, to, mode)];
  return routeResult(from, to, mode, leg, measured, measured ? 'cache' : 'approx');
}
export const provider = null;
export function model() {
  throw Error('ทริปตัวอย่างรองรับเฉพาะสถานการณ์ที่กำหนด');
}
export const candidates = model,
  findCity = model,
  findPlace = model,
  findSavedVenue = model,
  searchFlights = model,
  resolvePicks = model;
