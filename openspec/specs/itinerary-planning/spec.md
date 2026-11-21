# itinerary-planning Specification

## Purpose

Turn `POST /api/plan` with a `{ setup }` JSON object into a scheduled itinerary, route geometries and per-call diagnostics. The planner uses the configured provider for design, city and POI lookups to resolve locations, routing to calculate travel, and a constraint report to decide whether to attempt one repair.

Reference implementation in the prep repository at `292ba5f` includes `server/agent.mjs` (`runPlan`, `splitDesign`, `stayFlag`, `verifySrc`, `pickIssues`), `server/geo.mjs`, `server/openai.mjs`, `server/claude.mjs`, `server/cli-llm.mjs`, `src/plan.js` and `src/main.js`. Stream, source and routing checks are exercised by `scripts/smoke.mjs`. Hotel anchoring and the meal and opening-day rules are covered by `scripts/test-stays.mjs`, `scripts/test-diet.mjs` and `scripts/test-closed.mjs`.

## Requirements
### Requirement: Streamed planning
The endpoint SHALL stream Thai `step` lines while it works and SHALL end with exactly one `done` event carrying `plan`, `routes`, `summary`, `ms`, `repaired`, `timing` and `usage`, or one `error` event.

#### Scenario: Successful plan
- **WHEN** a valid setup is posted and a model is available
- **THEN** the stream contains steps such as "อ่านความต้องการของ 4 คน", "Bop ออกแบบแผน 3 วันในเชียงใหม่", "ตรวจเงื่อนไข: ผ่าน N/M" and ends with `done`

#### Scenario: Silent model
- **WHEN** no step was emitted for 15 s during design
- **THEN** a heartbeat step such as "Bop กำลังจัดเวลาให้ทันเวลาเปิด–ปิด" is emitted

### Requirement: Single design call for short trips
Trips shorter than `BOP_SPLIT_MIN_DAYS` (default 3) SHALL be designed in one design call on the configured provider’s deep model with up to `min(8, BOP_SEARCH_PLAN + 3 if outside Thailand + 2 if a direction is undecided)` web searches, reporting "ร่างวันที่ N จาก M" as the streamed output reaches each day.

#### Scenario: Two-day domestic trip
- **WHEN** a 2-day Chiang Mai trip is planned with default settings
- **THEN** one design call runs with a cap of 5 searches

#### Scenario: Abroad and undecided
- **WHEN** the destination is outside Thailand and one direction is undecided
- **THEN** the cap is 8 searches

#### Scenario: Incomplete short design
- **WHEN** the first design omits a requested day or returns an empty stop list for it
- **THEN** the planner requests a daily design for each missing day and retains the supplied days
- **AND** an incomplete daily response fails the request before a shortened plan is committed

### Requirement: Skeleton and parallel days for long trips
When the selected model adapter implements both the skeleton and per-day calls, trips of `BOP_SPLIT_MIN_DAYS` or more days SHALL first get a skeleton call (themes, area per day, one hotel, which day covers each wish, meals, 3-6 main places per day, no repeats; 1 search only for example hotels in auto stay mode), then one deep-model design call per day, `BOP_DAY_CONCURRENCY` (default 3) at a time, with up to 2 searches each.

#### Scenario: Per-day prompt content
- **WHEN** day 2 of a 4-day trip is designed
- **THEN** its prompt carries the skeleton row, the hotel name and coordinates, the day's budget share, the tightest walking cap, the places used on other days, and stop ids must start with `d2_`

#### Scenario: Short skeleton
- **WHEN** the skeleton returns fewer days than requested
- **THEN** missing days are filled with an empty "วันว่าง" row before the day calls

### Requirement: Progressive day events
The initial planning endpoint SHALL send cumulative `{ type: 'map', index, day: { date, title, stops }, routes }` previews as individual coordinates and routes become available for both short and split trips. Stop positions use `ll` in latitude/longitude order and a one-based `ordinal`. The source distinguishes catalog, geocoded, selected and model-estimated coordinates. Synthetic fallback coordinates SHALL be excluded. A stop SHALL gain an incoming `leg.key` only after routing returns geometry for both located endpoints. Route geometry uses longitude/latitude order and estimated geometry carries `approx: true`.

The endpoint SHALL send one `{ type: 'day', index, day, routes }` when the day is scheduled. Days MAY arrive out of order. The terminal `done` plan remains authoritative after transport adjustments and repair. A client that ignores intermediate events SHALL still receive the complete result.

#### Scenario: First day ready
- **WHEN** day 3 finishes before day 1
- **THEN** a `day` event with `index: 2` is sent first, followed by the step "วันที่ 3 พร้อมแล้ว (N จุด)"

#### Scenario: Streaming a day fails
- **WHEN** geocoding or routing a single day throws (not an abort)
- **THEN** split planning retries that day and publishes its completed event only on success

#### Scenario: Pins arrive before routes
- **WHEN** stop coordinates have been resolved and a route request is still pending
- **THEN** the preview contains the located pins in itinerary order and includes only routes that have already returned
- **AND** subsequent transport adjustments and constraint repairs do not repeat the preview stream

### Requirement: Geocoding of model places
Every stop spec SHALL be resolved to coordinates in this order: catalog id (Chiang Mai), coordinates the group picked or a booked hotel (`pick`), an OSM hit (`geocoded`) from Photon then Nominatim that is a real POI within 3 km of the model's coordinates (40 km of the city centre when it gave none), else the model's own coordinates (`model`).

#### Scenario: OSM hit near the model's point
- **WHEN** Photon returns a POI named like the query 1 km from the model's coordinates
- **THEN** the stop uses the OSM coordinates and `place.source` is `geocoded`

#### Scenario: Road or boundary hit
- **WHEN** the only hits are highways, boundaries or land-use areas
- **THEN** they are ignored and the model's coordinates stand

#### Scenario: Step line
- **WHEN** geocoding finishes
- **THEN** a step like "หาพิกัดสถานที่ 18 แห่ง · OSM 12 · คลังข้อมูล 4 · พิกัดประมาณ 2" is emitted

### Requirement: Valid coordinates on every stop
Every returned stop SHALL have `ll` as two finite numbers that are not `[0,0]`; a stop the server cannot place SHALL take the previous stop's coordinates, else the city centre, and be marked `place.source: 'model'`.

#### Scenario: Model omits coordinates and geocoding fails
- **WHEN** a stop has no coordinates after geocoding
- **THEN** it gets its neighbour's or the city centre's `ll` and the server logs a warning

### Requirement: Scheduling from real routes
After routing, `schedule()` SHALL keep each stop's planned start as the earliest start and its dwell time, slide a stop later when real travel takes longer, and set `leg.min`, `leg.km` and `leg.real` from the route; `priceLegs()` SHALL fill per-person THB leg costs the model left to the server.

#### Scenario: Travel longer than planned
- **WHEN** a leg needs 25 min but the model left 10 min of slack
- **THEN** the stop starts 15 minutes later and keeps its dwell. Later stops slide only to the extent that their own scheduled slack is exhausted.

#### Scenario: Server-priced songthaew
- **WHEN** a `red` leg of 2 km has `legCost` -1
- **THEN** its cost is ฿20 per person

#### Scenario: Own car
- **WHEN** a leg uses mode `own`
- **THEN** its cost is fuel at ฿4/km split between the people in the car (max 5) plus the model's parking and tolls

### Requirement: Web checks with honest sources
The server SHALL compare each available stop-level `src` labelled `web` with the actual search URLs. It SHALL downgrade an unmatched stop source to `estimate` with empty URL and title. The incoming leg has separate optional source metadata. This stop-level pass does not independently revalidate leg URLs.

#### Scenario: Invented URL
- **WHEN** the model marks a stop `web` with a URL that no search result contained
- **THEN** the stop's `src` becomes `{ url: '', title: '', checked: 'estimate' }`

#### Scenario: Summary of checks
- **WHEN** the model recorded a search URL or the validation found a web-backed stop
- **THEN** a step "ตรวจจากเว็บ N จุด · ประมาณการ M จุด" is emitted

### Requirement: Transport search in parallel with design
When a direction has a supplied origin or return destination, `by` flight, bus, train or undecided and either `auto` is set or no time is given (and no `choice`), the plan SHALL search transport options in parallel with the design, design around placeholder times (arrive 10:00, depart 20:30), and afterwards retime a first or last transit stop to the chosen arrival or to departure minus 90 min (flight) or 40 min (bus/train), respectively.

#### Scenario: Recommended flight outside the window
- **WHEN** the recommended outbound option arrives at 19:00
- **THEN** the server looks for options arriving 07:00–12:00 inclusive, ranks live before web before estimates and prefers lower known prices within a rank. If it finds a fitting option it moves the recommendation.

#### Scenario: Search fails
- **WHEN** the transport search throws an error other than auth or rate limit
- **THEN** a step "หาเที่ยวบินขาไปไม่สำเร็จ ใช้เวลาประมาณ" is emitted and the plan keeps the placeholder time

#### Scenario: Result in flags
- **WHEN** the search finds options
- **THEN** the direction entry in `plan.flags.transport` contains `options` and a `chosen` string matching one option ID

### Requirement: Suggested travel mode per direction
When a direction was undecided, the plan SHALL store `{ by, why }` from its chosen option in `flags.arrivalSuggested` for outbound travel or `flags.departureSuggested` for return travel. If the outbound direction has a known origin but no chosen service, it can use a nonempty model arrival suggestion other than `none`. The plan SHALL preserve the requested mode alongside an automatically selected service so reopening setup retains the organizer's preference.

#### Scenario: Undecided trip
- **WHEN** `arrive.by` is undecided and the search recommends a train
- **THEN** `flags.arrivalSuggested.by` is `train`

#### Scenario: Independent return recommendation
- **WHEN** a return service is chosen for an undecided return leg
- **THEN** the plan records the return recommendation in `flags.departureSuggested`. A return without a recommendation SHALL NOT inherit an outbound suggestion from an older plan.

### Requirement: Stay selection
The plan SHALL set `plan.flags.stay = { area, why, booked?, examples[] }`; in auto mode the model SHALL pick the area that minimises travel and fits budgets and give 2-3 real example hotels found with at most one web search (`priceNight` THB per room per night, `checked: 'web'` only for a real search URL), and split design SHALL prefer the first example with usable coordinates as the hotel supplied to the per-day designer; in booked mode the server SHALL geocode every booked stay (also trying its first 3 and 2 words, then a 200 km radius around the city for a stay in another town), make no hotel search, and set `flags.stay.stays` to each stay with `nights`, `checkIn` and `checkOut` dates.

#### Scenario: Auto stay
- **WHEN** stay mode is auto
- **THEN** `flags.stay.examples` holds up to 3 hotels with web-estimated nightly prices labelled `web` or `estimate`, and the stay cost per person (priceNight × nights ÷ 2) sits on the first hotel stop

#### Scenario: Booked hotel found
- **WHEN** stay is booked as "Novotel Danang Premier Han River" and OSM only knows "Novotel Danang"
- **THEN** the shorter name geocodes, the step reads "ที่พักที่จองไว้: … · พบบนแผนที่", and no hotel search is made

#### Scenario: Booked hotel not found
- **WHEN** no form of the name geocodes
- **THEN** the step for that stay includes "ใช้พิกัดประมาณ". A usable approximate lookup coordinate may be retained. Hotel pinning and inserted hotel endpoints require usable coordinates.

#### Scenario: Stay in another town
- **WHEN** a Chiang Mai trip books "Reverie Siam Resort" in Pai, about 80 km from the city centre
- **THEN** the wider search geocodes it near Pai and its hotel stops use those coordinates

### Requirement: Repair round
After the first checks the plan SHALL run at most one repair call when any rule fails, a must-pick is missing, an avoided place is present or the split design reports a repeated non-stay, non-transit place across days, and SHALL keep the repaired plan only if `pass × 10 − problem lines` does not get worse.

#### Scenario: Repair improves the plan
- **WHEN** a member's food-restriction rule fails and the repair swaps the restaurant
- **THEN** the repaired plan is returned with `repaired: true` and the step "ตรวจเงื่อนไขหลังซ่อม: ผ่าน M/M"

#### Scenario: Repair makes it worse
- **WHEN** the repaired plan scores lower
- **THEN** the original plan is returned and the step ends "(แย่ลง ใช้แผนเดิม)"

#### Scenario: Split trip repairs only failing days
- **WHEN** a split trip fails only on day 2 and the failure is not the budget
- **THEN** the repair report contains only day 2 and says the other days must not be touched

#### Scenario: Repair call fails
- **WHEN** the repair call errors with anything but auth or rate limit
- **THEN** the step "ซ่อมไม่สำเร็จ ใช้แผนก่อนซ่อม" is emitted and the unrepaired plan is returned

### Requirement: Group picks
When `setup.picks` is present, must-picks SHALL be pinned to the coordinates they were shown with (`place.source: 'pick'`), the step "ใส่ที่ที่กลุ่มเลือก N/M แห่ง" SHALL be emitted, and missing must-picks or present avoided places SHALL go to the repair round.

#### Scenario: Avoided place appears
- **WHEN** the design includes a place the group answered "ไม่เอา"
- **THEN** the repair report says "ต้องเอา "…" ออก (กลุ่มไม่เอา)"

### Requirement: Offline sample without a model
When `/api/health` reports no usable model, the UI SHALL offer the built-in Chiang Mai sample plan and its pre-built offline scenarios, and agent endpoints SHALL answer with `no_key` (no provider) or `auth` (subscription CLI logged out).

#### Scenario: No provider
- **WHEN** neither an API key nor the CLI is available
- **THEN** `/api/plan` ends with `error` code `no_key` and the UI offers the sample plan as an explicit action. The sample is also available on the demo URL.

### Requirement: Per-day start and end hotel
With booked stays, day 1 SHALL start at the arrival point and end at the hotel of night 1, every day i in between SHALL start at the hotel of night i-1 and end at the hotel of night i, and the last day SHALL start at its hotel (check-out) and end at the departure point. The model SHALL be told each day's hotels (`TripSetup.stayPlan`, per-day role and hotel lines in split design, `planBrief` day headers in repair and replan). The server SHALL pin the day's hotel stops to that day's hotels (by name, else the first stop to the start hotel, else the nearest), add a hotel stop when the model leaves out the start or the end, and put a check-out/luggage note on the start hotel stop of a day that changes hotel. Replans SHALL pin inserted or replaced hotel stops to that day's hotels. Auto mode SHALL keep its single recommended hotel.

#### Scenario: Move day
- **WHEN** a 4-day trip books 2 nights at "Chiang Mai Inn" and 1 night at "Pai Resort"
- **THEN** day 3 starts at Chiang Mai Inn with the note "เช็กเอาต์ ขนกระเป๋าไปPai Resort" and ends at Pai Resort, and day 4 starts at Pai Resort and ends at the departure airport

#### Scenario: Model forgets the end hotel
- **WHEN** the model's day 3 ends at a café in Pai
- **THEN** the server appends a Pai Resort hotel stop 30 minutes after the café's end time

#### Scenario: Single stay unchanged
- **WHEN** one stay covers every night
- **THEN** intermediate days start and end at it. The first day can start at the arrival point and the last day can end at the departure point.

#### Scenario: Replan keeps the hotels
- **WHEN** a replan inserts a hotel stop on the move day near Pai
- **THEN** it is pinned to Pai Resort, and the plan text the model read showed "ที่พัก: เริ่มวันจาก Chiang Mai Inn … → นอนที่ Pai Resort" for that day

### Requirement: Serializable plan and route contract

A successful run SHALL emit a final plan with `flags` and ordered `days`. Days carry an ISO `date`, display `label` and `short` label, and ordered `stops`. Each stop has an ID unique across the plan, `n` (display name), `k` (kind), `t0` and `t1` (local clock times), `ll` (latitude then longitude), per-person cost and on-site walking distance. A stop's optional incoming `leg` connects it to the previous stop on that day. Terminal `routes` is separate from the plan and uses the router profile and directional endpoints as its key.

#### Scenario: Duplicate stop ID
- **WHEN** two model stop specs propose the same ID
- **THEN** the first retains it, and later IDs gain the next available suffix starting at `_2`. A newly built day contains no incoming leg on its first stop.

#### Scenario: Unresolvable coordinates
- **WHEN** a stop still lacks usable coordinates after geocoding and neither its previous stop nor the city has usable coordinates
- **THEN** the server uses the numeric sentinel `[0.0001, 0.0001]`, marks its location source as `model` and logs the fallback. This location is an estimate.

#### Scenario: Fewer days than requested in a single design
- **WHEN** the single-call model returns fewer days than requested
- **THEN** the planner logs the short result and builds the returned days. If extra days are returned the server discards days beyond the requested length.

#### Scenario: Split-mode timing
- **WHEN** an interim day has been emitted and a final plan succeeds
- **THEN** the final timing record includes elapsed milliseconds for skeleton design, first day shown, parallel day generation, overall design, geocoding, transport wait and routing. Repair timing is present when repair ran. Provider usage is accumulated during the run.

### Requirement: Design budgets and route costing

The short-trip planner SHALL use a zero design search cap if `BOP_SEARCH_PLAN` is zero or negative, including for an international trip. In split mode, the per-day prompt SHALL derive its spending allowance from the tightest positive member budget minus estimated hotel cost, divided by trip days, and its walking allowance from the tightest member walking limit. The auto-price pass SHALL operate on eligible legs after routing.

#### Scenario: Booked travelers enter both directions
- **WHEN** a valid arrival or departure choice was supplied
- **THEN** the planner uses its arrival or departure time, stores that choice as the sole option in the direction flag and skips a new search for that direction. For a searched return the preferred departure window is 19:30–23:00 inclusive.

#### Scenario: Server-priced car or transit
- **WHEN** a car leg is auto-priced for five members
- **THEN** it uses two cars at ฿60 plus ฿14 per km per car, splits the total by five and rounds to the nearest ฿5. Auto-priced local transit uses ฿35 plus ฿3 per km rounded to the nearest ฿5. Walking costs zero.

#### Scenario: Hotel arrival missing from the model's nonempty day
- **WHEN** a geocoded booked stay is due at the end of a day and the model omitted it
- **THEN** the server adds a zero-dwell, zero-cost hotel endpoint, initially 30 minutes after the previous stop's end and capped at 23:30 before route scheduling. A missing morning anchor is initially 20 minutes before the first activity with a 06:00 lower bound.

### Requirement: Repair scoring and source limits

The planner SHALL combine failed constraint labels, missing or avoided group picks, and cross-day duplicates detected during split design into one repair report. Duplicate detection uses catalog identity or a compacted place query/name and skips stays and transit stops. A split report is limited to specific days only when every problem can be mapped to a day. One unlocatable issue requests a whole-trip brief.

#### Scenario: Pick is recognized by proximity
- **WHEN** a must-picked point lies within 0.25 km of a stop but its spelling differs
- **THEN** the presence check can count it as placed. Avoided picks are matched by name or query.

#### Scenario: Repaired candidate may retain a failure
- **WHEN** the repair proposes edits, re-routing and checks are run again
- **THEN** the candidate replaces the original when its pass-count weighted by ten minus remaining pick issues is at least the original score. Original split duplicate lines count in the original score and are not recomputed in the candidate score. An accepted edit sets `repaired`; a successful terminal event can still contain unmet constraints.

#### Scenario: Optional source metadata
- **WHEN** a model supplies no source label for a new non-catalog stop
- **THEN** the stop can lack a `src` field. Verification compares present stop URLs case-insensitively, ignoring fragments and trailing slashes.
