import { coordinates, distance } from './domain.mjs';
import { brandOnlyPosition, findSavedVenue, route } from './geo.mjs';
import { misplacedPick } from './pick-match.mjs';

export async function validateSavedPositions(saved) {
  const picks = saved.plan.setup?.picks?.must || [];
  const suspect = await Promise.all(saved.plan.days.map(day => Promise.all(day.stops.map(stop =>
    misplacedPick(stop, picks) || brandOnlyPosition(stop, saved.plan.setup?.cityLL)))));
  if (!suspect.some(day => day.some(Boolean))) return saved;
  const safe = structuredClone(saved);
  const discarded = new Set(), used = new Set();
  for (const [di, day] of safe.plan.days.entries()) for (const [i, stop] of day.stops.entries()) {
    if (suspect[di][i]) {
      stop.ll = null;
      stop.place = { ...stop.place, source: 'unknown', fallback: true };
    }
    if (!stop.leg) continue;
    if (suspect[di][i] || suspect[di][i - 1]) {
      discarded.add(stop.leg.key);
      stop.leg = { ...stop.leg, key: '', km: 0, geometry: [], real: false, unlocated: true };
    } else used.add(stop.leg.key);
  }
  for (const key of discarded) if (!used.has(key) && safe.routes) delete safe.routes[key];
  return safe;
}

export async function recoverSavedDay(saved, index, signal, { locate = findSavedVenue, directions = route } = {}) {
  const day = saved.plan.days[index];
  const locations = [], legs = [], routes = {};
  const budget = { remaining: 8 };
  const known = new Map();
  for (const stop of day.stops) {
    if (!stop.place?.fallback && coordinates(stop.ll)) { known.set(stop.id, stop.ll); continue; }
    if (typeof stop.query !== 'string' || !stop.query.trim()) continue;
    const ll = await locate(stop, saved.plan.setup?.cityLL, signal, budget);
    if (!coordinates(ll)) continue;
    known.set(stop.id, ll);
    locations.push({ id: stop.id, ll });
  }
  const recovered = new Set(locations.map(stop => stop.id));
  for (let i = 1; i < day.stops.length; i++) {
    const from = day.stops[i - 1], to = day.stops[i];
    if (!to.leg || !known.has(from.id) || !known.has(to.id) || !(recovered.has(from.id) || recovered.has(to.id))) continue;
    const road = await directions(known.get(from.id), known.get(to.id), to.leg.mode || to.leg.m, signal, false, to.leg);
    const end = road?.geom?.at(-1), start = road?.geom?.[0];
    if (road?.real && road.geom?.length >= 2 && start && end &&
        distance(known.get(from.id), [start[1], start[0]]) < 0.35 &&
        distance(known.get(to.id), [end[1], end[0]]) < 0.35) {
      routes[road.key] = { geom: road.geom };
      legs.push({ id: to.id, key: road.key, km: road.km, min: road.min, geometry: road.geometry });
    }
  }
  return { index, date: day.date, locations, legs, routes };
}
