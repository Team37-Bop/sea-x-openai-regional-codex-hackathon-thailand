export function applySavedMap(plan, routes, patch) {
  const day = plan.days[patch.index];
  if (!day || day.date !== patch.date || !patch.locations?.length) return;
  const locations = new Map(patch.locations.map(pin => [pin.id, pin.ll]));
  const routed = new Map(patch.legs.map(leg => [leg.id, leg]));
  day.stops.forEach((stop, i) => {
    if (locations.has(stop.id)) {
      stop.ll = locations.get(stop.id);
      stop.place = { ...stop.place, source: 'geocoded' };
      delete stop.place.fallback;
    }
    if (!stop.leg || !(locations.has(stop.id) || locations.has(day.stops[i - 1]?.id))) return;
    const leg = routed.get(stop.id);
    if (leg) {
      const { id, ...measurements } = leg;
      stop.leg = { ...stop.leg, ...measurements, real: true };
      delete stop.leg.unlocated;
    } else {
      stop.leg = { ...stop.leg, key: '', km: 0, geometry: [], real: false, unlocated: true };
    }
  });
  Object.assign(routes, patch.routes);
}
