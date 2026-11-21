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
    stopNames.some((n) => pickNames.includes(n)) ||
    (allowDistance && coordinates(stop?.ll) && coordinates(pick?.ll) && distance(stop.ll, pick.ll) <= 0.25)
  );
}
