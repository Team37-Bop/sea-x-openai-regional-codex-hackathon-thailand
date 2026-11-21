## ADDED Requirements

### Requirement: Traffic-aware road timing
When `GOOGLE_MAPS_API_KEY` is set and the Routes breaker is closed, `car`, `van`, `own` and `red` legs SHALL be timed with Routes API `computeRoutes` using `DRIVE`, `TRAFFIC_AWARE` and `departureTime` set to the leg's planned start on the trip date in the destination's time zone, and the leg SHALL be marked `timing: 'traffic'`.

#### Scenario: Evening ride in Bangkok
- **WHEN** a ride-hail leg departs 17:30 on a weekday and Routes predicts 42 min
- **THEN** the leg takes 42 + 5 = 47 min, with no free-flow factor applied

#### Scenario: Departure shifts after scheduling
- **WHEN** scheduling moves a leg into a different 15-minute bucket
- **THEN** that leg is re-queried once and not again

### Requirement: Transit timing and fares from Routes API
`transit` legs SHALL be timed with Routes API `TRANSIT` at the planned departure, storing minutes, distance, lines, transfers and walking minutes in `leg.transit`, a Thai `why` naming the lines, and `cost` from `transitFare` converted to THB when present; `LESS_WALKING` SHALL be requested when any member has a walking cap.

#### Scenario: BTS ride
- **WHEN** a transit leg in Bangkok returns one BTS step of 4 stops and a fare of ฿47
- **THEN** the leg shows "BTS สายสุขุมวิท 4 สถานี", `cost` 47 and `timing: 'transit'`

#### Scenario: No fare
- **WHEN** Routes returns no fare
- **THEN** `cost` keeps the server estimate

### Requirement: Japan transit source
For trips with country `JP`, transit legs SHALL use the configured Japan transit source (NAVITIME API or ODPT/GTFS) when its key is set, else Google TRANSIT when it returns results, else today's transit rule.

#### Scenario: Tokyo with NAVITIME configured
- **WHEN** `NAVITIME_API_KEY` is set and a Tokyo transit leg is timed
- **THEN** its minutes, lines and fare come from NAVITIME

### Requirement: Routes key and caching
Routes and Japan transit keys SHALL live in `.env.local`, be used server-side only and never reach the browser; Routes results SHALL be cached in memory only, by leg and 15-minute departure bucket, and SHALL NOT be written to disk.

#### Scenario: Restart
- **WHEN** the server restarts
- **THEN** OSRM/Valhalla geometry is still cached on disk and Routes durations are fetched again

### Requirement: Geometry stays OSM-based
Map geometry SHALL keep coming from OSRM, Valhalla or the straight-line fallback while the map is not a Google map; Routes polylines SHALL NOT be drawn on the MapLibre map.

#### Scenario: Traffic-timed leg on the map
- **WHEN** a leg is timed by Routes
- **THEN** its line on the map is the OSRM/Valhalla geometry

## MODIFIED Requirements

### Requirement: Travel time model
Road legs SHALL be timed from provider minutes plus the mode's waiting time when a traffic-aware duration is available (`timing: 'traffic'`), and otherwise as OSRM/Valhalla free-flow duration × a mode factor plus waiting time (walk ×1.3; songthaew ×1.2 +7 min; ride-hail ×1.15 +5; van ×1.1 +3; own car ×1.1) with `timing: 'freeflow'`; transit legs SHALL use the transit provider's minutes when available, else web-found minutes when `leg.minSrc === 'web'`, else 25 km/h plus 8 min.

#### Scenario: Ride-hail leg without a key
- **WHEN** no Google key is set and OSRM returns 10 min for a `car` leg
- **THEN** the leg takes ceil(10 × 1.15 + 5) = 17 min

#### Scenario: Transit without a web time
- **WHEN** no transit provider answers and a 10 km transit leg has no web minutes
- **THEN** it takes ceil(10 / 25 × 60 + 8) = 32 min

#### Scenario: Routes quota spent
- **WHEN** Routes answers 429
- **THEN** Routes is skipped for 10 min and legs fall back to the free-flow model with `timing: 'freeflow'`
