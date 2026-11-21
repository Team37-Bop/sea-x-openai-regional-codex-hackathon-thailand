export function needsAutoLodging(plan) {
  const setup = plan?.setup;
  const stay = setup?.stay;
  const flag = plan?.flags?.stay;
  return stay?.mode === 'auto' && plan.days?.length > 1 && !flag?.booked &&
    !stay.name?.trim() && !stay.stays?.some(row => row?.name?.trim()) &&
    !flag?.stays?.some(row => row?.name?.trim());
}

export function isLodgingStop(stop) {
  return ['hotel', 'stay', 'ที่พัก', 'โรงแรม'].includes(stop?.kind || stop?.k);
}

export function needsLodgingChoice(plan) {
  const setup = plan?.setup;
  const stay = setup?.stay;
  const flag = plan?.flags?.stay;
  if (!setup || !(plan.days?.length > 1) || (stay?.mode && stay.mode !== 'auto') || flag?.booked ||
      stay?.name?.trim() || stay?.stays?.some(row => row?.name?.trim()) ||
      ['chosen', 'recommended'].includes(flag?.selection)) return false;
  if (plan.days.some(day => day?.stops?.some(stop =>
    stop.res?.done && isLodgingStop(stop)))) return false;
  // A neighborhood preference in the place survey still needs a specific property.
  const selectedNames = new Set((flag?.stays || []).map(row => row?.name?.trim()).filter(Boolean));
  return !(setup.picks?.must || []).some(pick => pick?.name?.trim() &&
    (pick.kind === 'hotel' || (pick.kind === 'stay' && selectedNames.has(pick.name.trim()))));
}
