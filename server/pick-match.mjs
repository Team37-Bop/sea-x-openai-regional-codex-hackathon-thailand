import { coordinates, distance } from './domain.mjs';
import { placeText } from './place-text.mjs';
const normalizeName = (v) =>
  placeText(v)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
export function matchesPick(stop, pick, allowDistance = true) {
  const stopNames = [stop?.name, stop?.n, stop?.query, stop?.place?.query].map(normalizeName).filter(Boolean);
  const pickNames = (typeof pick === 'string' ? [pick] : [pick?.name, pick?.query])
    .map(normalizeName)
    .filter(Boolean);
  return (
    (typeof pick === 'object' && pick?.id && stop?.id === pick.id) ||
    stopNames.some((n) => pickNames.includes(n)) ||
    (allowDistance && !stop?.place?.fallback && coordinates(stop?.ll) && coordinates(pick?.ll) && distance(stop.ll, pick.ll) <= 0.25)
  );
}

const pickCategory = kind => {
  if (['hotel','stay'].includes(kind)) return 'stay';
  if (['food','restaurant','cafe'].includes(kind)) return 'food';
  if (['nature','view','sight','market','museum','culture'].includes(kind)) return 'sight';
  if (['transit','terminal'].includes(kind)) return 'transit';
};
export function misplacedPick(stop, picks = []) {
  if (stop?.place?.source !== 'pick' || stop.pinned || !coordinates(stop.ll)) return false;
  const category = pickCategory(stop.kind || stop.k);
  const samePoint = picks.filter(pick => coordinates(pick?.ll) &&
    stop.ll[0] === pick.ll[0] && stop.ll[1] === pick.ll[1]);
  return Boolean(category && samePoint.length && samePoint.every(pick =>
    pickCategory(pick.kind) && pickCategory(pick.kind) !== category && !matchesPick(stop, pick, false)));
}
