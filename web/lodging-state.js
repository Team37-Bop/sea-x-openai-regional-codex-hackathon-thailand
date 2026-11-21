export function needsAutoLodging(plan) {
  const setup = plan?.setup;
  const stay = setup?.stay;
  const flag = plan?.flags?.stay;
  return stay?.mode === 'auto' && plan.days?.length > 1 && !flag?.booked &&
    !stay.name?.trim() && !stay.stays?.some(row => row?.name?.trim()) &&
    !flag?.stays?.some(row => row?.name?.trim());
}
