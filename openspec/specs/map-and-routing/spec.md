# map-and-routing Specification

## Purpose

The server resolves places and obtains road geometry; the browser draws the active itinerary and exposes estimated segments. Reference evidence in prep commit `292ba5f` includes `server/geo.mjs`, `src/plan.js` (`legKey`, `allLegs`, `schedule`, `MODE_ADJ`), `src/main.js` (`normLL`, `routeInfo`, `mapPlan`, `drawMap`, `goBox`), `vite.config.js`, `scripts/package-lambda.sh`, `scripts/test-infrastructure.mjs` and `terraform/app/compute.tf`.

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
`routes` in plan/replan `done` and progressive plan `day` events SHALL hold an entry keyed `legKey(prev.ll, stop.ll, leg.m)` for every leg in `allLegs(plan)` of each returned plan, as an object containing a `geom` array of `[lng,lat]` pairs and optional `approx: true`.

#### Scenario: Browser needs no router
- **WHEN** the UI renders a plan from the server
- **THEN** it checks the bundled seed first, then the merged server geometry. If both miss, the browser draws an approximate straight line without calling a router

### Requirement: Travel time model
Road legs SHALL be timed as OSRM/Valhalla free-flow duration × a mode factor plus waiting time (walk ×1.3; songthaew ×1.2 +7 min; ride-hail ×1.15 +5; van ×1.1 +3; own car ×1.1), with no live traffic; transit legs SHALL use web-found minutes when `leg.minSrc === 'web'` and otherwise 25 km/h plus 8 min.

#### Scenario: Ride-hail leg
- **WHEN** OSRM returns 10 min for a `car` leg
- **THEN** the leg takes ceil(10 × 1.15 + 5) = 17 min

#### Scenario: Transit without a web time
- **WHEN** a 10 km transit leg has no web minutes
- **THEN** it takes ceil(10 / 25 × 60 + 8) = 32 min

### Requirement: Circuit breakers and politeness
Each of OSRM, Valhalla, Photon and Nominatim SHALL be skipped for 10 min after two consecutive failures or one HTTP 429; legs SHALL be fetched 3 at a time with a 120 ms gap per worker; Nominatim fallback POI searches SHALL be serialized with a 1.1-second delay between operations. Each batch passed to `resolveSpecs` gets an eight-lookup Nominatim budget shared across its four geocoding workers.

#### Scenario: Rate limited
- **WHEN** OSRM answers 429
- **THEN** OSRM is skipped for 10 min and Valhalla serves routes

### Requirement: Persistent caches
Successful routes, successful city lookups, geocoding hits and answered geocoding misses that retain model coordinates SHALL be cached in memory and persisted in `routes.json`, `cities.json` and `geocode.json`. The default directory is `server/.cache`; `BOP_CACHE_DIR` overrides it, including the deployed Lambda setting `/tmp/bop/cache`. Files are written using a temporary file then rename after a 500 ms debounce. When present, `src/routes.json` seeds the route cache before disk entries are applied. Failed external lookups alone do not populate persisted caches.

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

### Requirement: Route identity and provider units

The planner SHALL route legs between consecutive distinct coordinates within each day when the arriving stop carries a leg. Route keys SHALL encode the routing profile and both endpoints in travel order as `profile|lng1,lat1;lng2,lat2`. Walking has its own profile. Songthaew, car, van, own-car and transit share the car geometry profile. One routing batch SHALL deduplicate keys across all candidate plans.

#### Scenario: Two modes use the same road
- **WHEN** an option changes from ride-hail to own-car for an identical directed leg
- **THEN** the server can reuse the car route for both options while scheduling a different wait, duration adjustment and fare for each mode. The return direction uses a separate key

#### Scenario: Provider response has no usable line
- **WHEN** OSRM returns fewer than two geometry points or no route
- **THEN** the next available router is tried. Successful provider values are kept as rounded seconds and metres, with geometry rounded to five decimal places. Valhalla shape decoding uses precision six

#### Scenario: Client response versus scheduling data
- **WHEN** a route includes duration and distance internally
- **THEN** the scheduler updates leg minutes, kilometres rounded to one decimal and the real-route flag. The route dictionary sent to the browser contains geometry and approximation status only

### Requirement: City and POI resolution

A city lookup SHALL cache a trimmed, lower-case name. It asks Nominatim for one result with address details and English language preference, then falls back to Photon place or boundary hits. A Photon city fallback can return an empty country code. Catalog stops and pinned stops with coordinates SHALL bypass external POI search. Other POIs use the stop query or display name, geographic bias and a bounded search radius.

#### Scenario: Geocoder proposes a non-POI
- **WHEN** a result is a highway, place classification, boundary, land-use area, railway, power feature or natural peak
- **THEN** the POI resolver skips it. Candidates must also lie within the caller's configured radius of model coordinates (3 km by default), or within 40 km of the city centre when only the centre is known

#### Scenario: Repeated geocoding query
- **WHEN** two stops have the same trimmed query and model coordinates rounded to two decimals
- **THEN** concurrent lookups share the in-flight promise. If a lookup produces only an outage fallback, a later request can retry it

### Requirement: Map updates and readable route changes

The browser SHALL normalize array, object and comma-separated stop coordinates into latitude/longitude order and reject nonfinite numbers, out-of-range coordinates and the zero pair. The map SHALL show delivered days as a split plan arrives, the current plan after completion, and the option preview during replanning. Single-day and all-days views SHALL use their respective visible stops for fitting. In single-day view, qualifying long road geometries and removed stops affect the framing.

#### Scenario: Legacy server geometry order
- **WHEN** a merged server geometry has at least two points and its first point is closer to the segment origin when read as latitude/longitude
- **THEN** the client reverses the coordinate pairs before drawing. Bundled seed geometry is already longitude/latitude

#### Scenario: Preview removes a stop
- **WHEN** an option removes a positioned stop from the selected day in single-day view
- **THEN** its previous position appears as a removal marker with adjacent ghost segments. In the all-days view, the map draws the visible routes without those single-day removal markers

#### Scenario: Progressive or incomplete coordinates
- **WHEN** only some planned days have arrived
- **THEN** the browser fits the valid positions of the available days. A marker or line with insufficient usable coordinates is omitted; other itinerary entries remain available in the list

### Requirement: Route strokes and map key

The visible map SHALL display a compact bottom-left key for the lines currently drawn. Each entry SHALL pair its Thai label with the line's color and stroke. Confirmed walks use dots, public transit uses long dashes and road vehicles use solid lines. Estimated geometry uses a distinct faded dash-dot pattern and names the estimate explicitly. A removed preview route has its own key. The key SHALL update with the day, preview and incoming routing data and stay hidden when there are no lines.

#### Scenario: Exact and estimated public transit
- **WHEN** the visible day includes both confirmed and estimated transit legs
- **THEN** the map and its key distinguish the long-dashed transit service from the dash-dot estimated transit segment. A resolved leg that first appears during planning adds its own matching swatch.

### Requirement: Framing the active destination and map overlays

Each setup submission or retry SHALL begin with an empty itinerary overlay, even when the destination is unchanged. The camera SHALL show the requested city as soon as its coordinates are available. The draft SHALL display only places and routes received for the current request. Returning to the saved trip SHALL restore its markers, routes and bounds. Focusing a stop and fitting visible routes SHALL use map space clear of the open place sheet and chat dock, including when both overlap the map.

#### Scenario: Rebuilding a trip in the same city
- **WHEN** the organizer regenerates an existing trip without changing its destination
- **THEN** previous pins, route lines, popups and legend entries clear before discovery. Canceling restores the committed itinerary and ignores delayed events. Completing the request replaces the provisional layer with its final itinerary.

#### Scenario: Inspecting a stop with the response dock open
- **WHEN** the user selects a stop and its sheet opens alongside a visible Bop response
- **THEN** the camera places the stop in the available map area. At narrow widths the camera can use the space below the dock. A response outside the map does not consume map space.

### Requirement: Geographically anchored visits

The map SHALL exclude synthetic city or neighbour coordinates marked as location fallbacks, and exclude segments attached to those placeholders. These visits remain available in the itinerary. The all-days map SHALL use distinct place markers and group counts rather than repeating each day's stop numbers. A single day retains its stop order. Labels SHALL yield space to visible markers and the selected visit.

#### Scenario: Multiple visits at one place or nearby places
- **WHEN** different visits or candidates coincide or would visually overlap at the current zoom
- **THEN** a single mark stays at a real location. A keyboard-accessible chooser lists the visits chronologically with their dates and stop numbers and opens each one's own details or candidate card. Zooming in separates nearby places that now have sufficient screen space; repeat visits at identical coordinates remain grouped.

#### Scenario: Geocoding an overseas stop for a Thai-language trip

- **WHEN** the plan has a localized city name and an address or venue name in its own language
- **THEN** search uses the original query, with the trip coordinates as its geographic bias, and can retry a shorter venue name or alias. A failed search does not permanently block future lookups. If an endpoint remains unresolved, its itinerary row remains accessible and the planner does not route to its placeholder coordinate.
