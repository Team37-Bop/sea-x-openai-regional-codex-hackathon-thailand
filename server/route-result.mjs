import { distance } from './domain.mjs';
import { legMode, isScheduledService } from '../web/leg-modes.js';
export const legKey = (from, to, mode) =>
  (isScheduledService(mode) ? legMode(mode) : mode === 'walk' ? 'walk' : 'car') +
  '|' + [from, to].map(([lat, lng]) => lng + ',' + lat).join(';');
function adjusted(mode, seconds, km, leg) {
  if (mode === 'transit' || isScheduledService(mode))
    return leg?.minSrc === 'web' && leg.min > 0 ? Math.ceil(leg.min) : Math.ceil((km / 25) * 60 + 8);
  const [factor, wait] = { walk: [1.3, 0], red: [1.2, 7], car: [1.15, 5], van: [1.1, 3], own: [1.1, 0] }[
    mode
  ] ?? [1, 0];
  return Math.ceil((seconds / 60) * factor + wait);
}
export function routeResult(from, to, mode, leg = {}, measured, via) {
  const key = legKey(from, to, mode),
    km = distance(from, to);
  const geom = measured?.geom ?? [from, to].map(([lat, lng]) => [lng, lat]);
  const kmRoad = measured && Number.isFinite(measured.meters) ? measured.meters / 1000 : km;
  const min =
    measured && Number.isFinite(measured.sec)
      ? adjusted(mode, measured.sec, kmRoad, leg)
      : Number.isFinite(leg.min) && (leg.min > 0 || (leg.min === 0 && (!isScheduledService(mode) || km < 0.001)))
        ? leg.min
        : mode === 'transit' || isScheduledService(mode)
          ? adjusted(mode, 0, kmRoad, leg)
          : Math.ceil(km * (mode === 'walk' ? 14 : 3));
  return {
    key,
    geom,
    geometry: geom.map(([lng, lat]) => [lat, lng]),
    km: Math.round(kmRoad * 10) / 10,
    min,
    real: !!measured && !measured.approx,
    via: via ?? 'approx',
  };
}
