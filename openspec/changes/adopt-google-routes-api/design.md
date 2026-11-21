## Context

`routePlans()` (`server/geo.mjs`) fetches OSRM → Valhalla → straight line for every leg (3 at a time, breakers, disk cache keyed by `legKey`), and `schedule()` (`src/plan.js`) converts duration to minutes with `MODE_ADJ` (walk ×1.3, red ×1.2 +7, car ×1.15 +5, van ×1.1 +3, own ×1.1; transit 25 km/h +8 unless `leg.minSrc === 'web'`). There is no notion of departure time, so a 17:30 ride across Bangkok costs the same as one at 10:00.

## Goals / Non-Goals

**Goals:**
- Traffic-aware minutes for road legs at the planned departure time.
- Real transit itineraries (lines, transfers, walking, fare) for `transit` legs.
- Same `routes` geometry contract to the UI; today's path as fallback.

**Non-Goals:**
- Turn-by-turn navigation.
- Replacing the map or its geometry source (blocked on the Google map terms; see Places change).
- Intercity trains/buses (that is `transport-search` and a future 12Go change).

## Decisions

### Provider: Google Routes API
- `POST https://routes.googleapis.com/directions/v2:computeRoutes`, headers `X-Goog-Api-Key`, `X-Goog-FieldMask`.
- Road legs: `travelMode: DRIVE`, `routingPreference: TRAFFIC_AWARE`, `departureTime` = trip date + stop `t1` of the previous stop in the destination's time zone, `trafficModel: BEST_GUESS`. Field mask `routes.duration,routes.staticDuration,routes.distanceMeters`. For dates far ahead the prediction is historical traffic, which is still better than free flow.
- Walk legs stay on OSRM foot (Routes WALK adds little and costs a call); configurable.
- Transit legs: `travelMode: TRANSIT`, `departureTime`, `transitPreferences.routingPreference: LESS_WALKING` when any member has `maxWalkKm`, field mask `routes.duration,routes.distanceMeters,routes.legs.steps.transitDetails,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.travelAdvisory.transitFare`. The leg gets `min`, `km`, `leg.transit = { lines: [...], transfers, walkMin }`, `why` (e.g. "BTS สายสุขุมวิท 4 สถานี") and `cost` from the fare in THB (plan rate).
- Batching: `computeRouteMatrix` is used for the initial plan when a day has many legs with the same departure bucket; single legs (replan) use `computeRoutes`.
- Alternatives: TomTom Routing (traffic, keyed, no transit), HERE Routing v8 (traffic + public transit, keyed; a fallback candidate if Google terms block use), Mapbox Directions (traffic; terms require Mapbox map).

### Japan transit alternative
Google's transit results through the API must be verified for Japan before relying on them. Pluggable `transit-jp` source:
- NAVITIME API (route search with timetable, fares; commercial contract, `NAVITIME_API_KEY`), or
- ODPT (Public Transportation Open Data Center) APIs/GTFS for Tokyo operators (`ODPT_CONSUMER_KEY`, registration), with a GTFS router such as OpenTripPlanner self-hosted for the covered operators.
Selection: country `JP` → `transit-jp` when configured, else Google, else today's rule.

### Auth and keys
- `GOOGLE_MAPS_API_KEY` in `.env.local`, restricted to Routes API + Places API (New) and the server IP; server only, never logged.
- `NAVITIME_API_KEY` / `ODPT_CONSUMER_KEY` likewise, optional.

### Request flow
1. `finalize()` keeps calling `routePlans()` for geometry (OSRM/Valhalla, cached).
2. New `timeLegs(plans, setup)`: for each road/transit leg compute a time key `legKey|YYYY-MM-DD|HH:MM rounded to 15 min`; look up memory; call Routes for misses (pool 3, 4 s timeout).
3. `schedule()` uses `leg.provMin` when present: road = provider minutes + `MODE_ADJ[m].wait` (no factor, traffic is already in); transit = provider minutes as-is. Otherwise today's formula.
4. Because `schedule()` slides stops, departure times can shift; one re-time pass re-queries only legs whose bucket changed (max one extra pass).
5. Step line: "เวลาเดินทางตามสภาพจราจร 18 ช่วง · รถสาธารณะ 4 ช่วง · ประมาณ 2".

### Caching
- OSRM/Valhalla geometry and free-flow cache unchanged.
- Routes durations: in memory only, keyed by leg and 15-minute bucket, TTL 30 min for today's dates and 6 h for future dates; not written to disk (Maps Platform caching limits).

### Cost and quotas
- Per-route billing; `TRAFFIC_AWARE` and `TRANSIT` sit in a higher SKU tier than traffic-unaware routing; `TRAFFIC_AWARE_OPTIMAL` is avoided. Monthly free caps per SKU apply; check the current price sheet.
- Estimate: 3-day plan ~25 road + ~6 transit legs, plus one partial re-time pass; replan touches only changed legs.
- Guards: `BOP_ROUTES_MAX_PER_PLAN` (default 60), daily cap `BOP_ROUTES_DAILY_CAP`, breaker 10 min on 429/5xx.

### Fallback to today's no-key path
No key, breaker open, cap reached, timeout or `ZERO_RESULTS` → that leg keeps today's timing (OSRM/Valhalla free-flow × factor + wait; transit web minutes or 25 km/h + 8 min) and `leg.timing: 'freeflow'`. The UI shows "เวลาโดยประมาณ (ไม่รวมรถติด)" for such legs when other legs are traffic-aware.

### ToS constraints
- Routes content on a non-Google map: polylines from Routes are not drawn on the MapLibre map; geometry stays OSM-based until the map question is resolved (shared with the Places change).
- Attribution "Google Maps" next to traffic-aware times and transit details; transit agency names and links when returned.
- No persistent caching of Routes results; no bulk export.

## Risks / Trade-offs

- [Re-time loop when traffic shifts departures] → one extra pass maximum, then accept.
- [Transit fare missing in many cities] → keep `legCostEstimate` when no fare.
- [Cost per plan grows with stops] → caps and bucketed cache.
- [Japan coverage uncertainty] → spike before enabling `JP` transit via Google.

## Migration Plan

Behind the key; no key = no change. Compare 20 sample plans' arrival times with and without traffic. Rollback by removing the key.

## Open Questions

- Should the songthaew (`red`) use DRIVE times at all, or stay on the free-flow factor (it stops often)?
- Use `computeRouteMatrix` for the whole day upfront, or per leg after the first schedule pass?
