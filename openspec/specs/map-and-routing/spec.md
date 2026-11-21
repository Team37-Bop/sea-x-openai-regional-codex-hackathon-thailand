# map-and-routing Specification

## Purpose
The server routes every leg on real roads with free public routers and returns the geometry; the browser draws it on a keyless MapLibre + OpenFreeMap map. Code: `server/geo.mjs` (geocoding, routing, breakers, disk cache), `legKey`/`allLegs`/`schedule`/`MODE_ADJ` in `src/plan.js`, map code in `src/main.js`.

## Requirements

### Requirement: Routing chain
Each leg SHALL be routed by OSRM (routing.openstreetmap.de, `routed-foot` for walk, `routed-car` otherwise), then Valhalla (valhalla1.openstreetmap.de, `pedestrian` or `auto`), and when both fail SHALL get a straight line `{ geom: [[lng,lat],[lng,lat]], approx: true }` that is not cached.

#### Scenario: OSRM down
- **WHEN** OSRM times out for a leg
- **THEN** Valhalla routes it and the step names the source, e.g. "คำนวณเส้นทางจริง 28 ช่วง · Valhalla 4 · แคช 24"

#### Scenario: No router reachable
- **WHEN** both routers fail
- **THEN** the leg gets an `approx` straight line and `schedule()` keeps its estimated minutes

### Requirement: Geometry for every leg
`routes` in every `done` and `day` event SHALL hold an entry keyed `legKey(prev.ll, stop.ll, leg.m)` for every leg in `allLegs(plan)` of each returned plan, as `[lng,lat]` geometry.

#### Scenario: Browser needs no router
- **WHEN** the UI renders a plan from the server
- **THEN** it draws `routes[legKey]` (or `src/routes.json`) without calling OSRM

### Requirement: Travel time model
Road legs SHALL be timed as OSRM/Valhalla free-flow duration × a mode factor plus waiting time (walk ×1.3; songthaew ×1.2 +7 min; ride-hail ×1.15 +5; van ×1.1 +3; own car ×1.1), with no live traffic; transit legs SHALL use web-found minutes when `leg.minSrc === 'web'` and otherwise 25 km/h plus 8 min.

#### Scenario: Ride-hail leg
- **WHEN** OSRM returns 10 min for a `car` leg
- **THEN** the leg takes ceil(10 × 1.15 + 5) = 17 min

#### Scenario: Transit without a web time
- **WHEN** a 10 km transit leg has no web minutes
- **THEN** it takes ceil(10 / 25 × 60 + 8) = 32 min

### Requirement: Circuit breakers and politeness
Each of OSRM, Valhalla, Photon and Nominatim SHALL be skipped for 10 min after two consecutive failures or one HTTP 429; legs SHALL be fetched 3 at a time with a 120 ms gap per worker; Nominatim SHALL be serialised at 1 request per second and limited to 8 lookups per request.

#### Scenario: Rate limited
- **WHEN** OSRM answers 429
- **THEN** OSRM is skipped for 10 min and Valhalla serves routes

### Requirement: Persistent caches
Routes, geocodes (including searched-but-no-match answers, never outage fallbacks) and city lookups SHALL persist in `server/.cache/*.json`, written atomically, with `src/routes.json` seeding routes, so a repeated plan for the same places makes no routing calls.

#### Scenario: Chiang Mai sample offline
- **WHEN** the sample is scheduled without network
- **THEN** all legs come from the seed and cache

### Requirement: Deployable MapLibre worker
The production build SHALL copy MapLibre 6.19's `maplibre-gl-worker.mjs` to `dist/assets/`, deployment SHALL serve `.mjs` as `text/javascript; charset=utf-8`, and packaging SHALL fail when the worker is absent.

#### Scenario: Production map starts
- **WHEN** the deployed browser requests `/assets/maplibre-gl-worker.mjs?v=6.19.0`
- **THEN** it receives JavaScript with HTTP 200 and the route map creates a visible MapLibre canvas

#### Scenario: Worker copy fails
- **WHEN** the production build does not contain `dist/assets/maplibre-gl-worker.mjs`
- **THEN** Lambda packaging stops before Terraform can deploy the incomplete frontend

### Requirement: Map display
The map SHALL use OpenFreeMap tiles (positron light, dark following the OS theme) with Thai labels preferred, draw `approx` or missing legs dashed and faded with the tooltip "เส้นทางโดยประมาณ", list only the modes the plan uses in the legend, widen to fit legs of 100 km or more, and accept `ll` as `[lat,lng]`, `{lat,lng}` or "lat,lng" (fixing swapped pairs).

#### Scenario: Approximate leg
- **WHEN** a leg has `approx: true`
- **THEN** its line is dashed and its row says "เส้นทางโดยประมาณ" instead of "ตามถนนจริง"

#### Scenario: Stop without coordinates
- **WHEN** a stop has no valid `ll`
- **THEN** it stays in the list and is left off the map
