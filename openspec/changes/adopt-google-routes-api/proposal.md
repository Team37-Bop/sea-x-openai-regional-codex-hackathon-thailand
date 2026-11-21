## Why

Bop times road legs from free-flow OSRM/Valhalla durations times a fixed mode factor, with no traffic, and times city transit from web-searched ride times or a 25 km/h guess. Bangkok and Chiang Mai rush hours and Tokyo transfers make those numbers wrong exactly where a schedule is tight (airport buffers, reservations). Google Routes API gives traffic-aware driving times for the planned departure time and real TRANSIT itineraries with lines, transfers and fares.

## What Changes

- With `GOOGLE_MAPS_API_KEY` set, the server times `car`, `van`, `own` and `red` legs with Routes API `computeRoutes` (`DRIVE`, `TRAFFIC_AWARE`, `departureTime` = the leg's planned start on the trip date) and keeps mode waiting times (ride-hail pickup, songthaew hailing).
- `transit` legs use Routes API `TRANSIT` for the trip date and time: duration, lines, transfers, walking and fare (`travelAdvisory.transitFare`, converted to THB) replace web-searched minutes and the 25 km/h estimate.
- Map geometry keeps coming from OSRM → Valhalla → straight line (and their disk cache); Routes is used for timing and transit details only while the map is not a Google map.
- For Japan, where Google's transit coverage through the API must be verified, an alternative transit provider (NAVITIME API or ODPT/GTFS feeds) is designed as a pluggable source.
- No key, quota spent or an error → today's OSRM/Valhalla timing with mode factors and today's transit rule.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `map-and-routing`: the travel time model gains traffic-aware and transit timing from Routes API with the current model as fallback; adds key handling and a Japan transit alternative.

## Impact

- Code: new `server/routes-google.mjs` (and optional `server/transit-jp.mjs`), `finalize()`/`routePlans()` in `server/agent.mjs`/`server/geo.mjs`, `schedule()` and `MODE_ADJ` in `src/plan.js` (accept a provided duration), API.md changelog (`leg.timing: 'traffic'|'transit'|'freeflow'`, `leg.transit`).
- Keys: `GOOGLE_MAPS_API_KEY` (shared with Places, restricted to Routes API + Places API (New)); optional `NAVITIME_API_KEY` or `ODPT_CONSUMER_KEY` for Japan. All in `.env.local`, server only.
- Cost: per-element SKUs; traffic-aware and transit are higher tiers than basic routing (see design).
- No-key fallback: unchanged from today (OSRM/Valhalla free-flow × mode factor + waiting; transit = web minutes or 25 km/h + 8 min; straight line `approx` when no router answers).
