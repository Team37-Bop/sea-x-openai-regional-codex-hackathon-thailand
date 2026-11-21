const bangkok = 'กรุงเทพฯ';
const nameKey = (value) => (value || '').trim().toLowerCase().replace(/[\s.ฯ]/g, '');
const bangkokNames = new Set(['กรุงเทพ', 'กรุงเทพมหานคร', 'กทม', 'bangkok', 'krungthep', 'krungthepmahanakhon', 'bkk', 'dmk']);
const airportCode = (value) => (value?.trim().match(/^(?:([a-z]{3})|.*\(([a-z]{3})\))$/i) || []).slice(1).find(Boolean)?.toUpperCase();
const inBangkok = (value) => bangkokNames.has(nameKey(value)) || ['BKK', 'DMK'].includes(airportCode(value));

function returnPlace(origin, by) {
  if (inBangkok(origin)) {
    if (by !== 'flight') return bangkok;
    return airportCode(origin) === 'DMK' ? 'DMK' : 'BKK';
  }
  return by === 'flight' ? airportCode(origin) || origin : origin;
}

// Omitted directions stay absent for older saved trips. An explicit home or ticket wins.
export function resolveTransportEndpoints(setup) {
  const result = { ...setup };
  for (const [name, key] of [['arrive', 'from'], ['depart', 'to']]) {
    const leg = setup[name];
    if (!leg) continue;
    if (leg[key]?.trim()) continue;
    const ticketPlace = leg.choice?.[key]?.trim();
    const home = name === 'depart' ? result.arrive?.from : '';
    const place = ticketPlace || returnPlace(home || bangkok, leg.by);
    result[name] = { ...leg, [key]: place, ...(ticketPlace ? {} : { endpointDefault: true }) };
  }
  return result;
}

export function localTransport(setup, dir) {
  const leg = dir === 'go' ? setup.arrive : setup.depart;
  if (leg?.choice) return false;
  const place = dir === 'go' ? leg?.from : leg?.to;
  if (!place || !setup.city) return false;
  return nameKey(place) === nameKey(setup.city) ||
    (Boolean(setup.cityAirport) && airportCode(place) === setup.cityAirport.toUpperCase()) ||
    (inBangkok(place) && (inBangkok(setup.city) || inBangkok(setup.cityAirport)));
}
