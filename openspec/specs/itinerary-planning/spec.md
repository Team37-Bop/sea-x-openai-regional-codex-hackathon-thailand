# itinerary-planning Specification

## Purpose
`POST /api/plan` turns a `TripSetup` into a full, scheduled `Plan` with route geometry. The pipeline is: model design (single call or skeleton + parallel days) -> geocode -> route -> schedule -> price -> checks -> at most one repair round. Code: `runPlan`/`splitDesign` in `server/agent.mjs`, `design`/`skeleton`/`designDay`/`repair` in `server/claude.mjs` and `server/cli-llm.mjs`, `buildPlan`/`schedule`/`priceLegs` in `src/plan.js`.
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
Trips shorter than `BOP_SPLIT_MIN_DAYS` (default 3) SHALL be designed in one Opus call with up to `min(8, BOP_SEARCH_PLAN + 3 if outside Thailand + 2 if a direction is undecided)` web searches, reporting "ร่างวันที่ N จาก M" as the streamed output reaches each day.

#### Scenario: Two-day domestic trip
- **WHEN** a 2-day Chiang Mai trip is planned with default settings
- **THEN** one design call runs with a cap of 5 searches

#### Scenario: Abroad and undecided
- **WHEN** the destination is outside Thailand and one direction is undecided
- **THEN** the cap is 8 searches

### Requirement: Skeleton and parallel days for long trips
Trips of `BOP_SPLIT_MIN_DAYS` or more days SHALL first get a skeleton call (themes, area per day, one hotel, which day covers each wish, meals, 3-6 main places per day, no repeats; 1 search only for example hotels in auto stay mode), then one Opus design call per day, `BOP_DAY_CONCURRENCY` (default 3) at a time, with up to 2 searches each.

#### Scenario: Per-day prompt content
- **WHEN** day 2 of a 4-day trip is designed
- **THEN** its prompt carries the skeleton row, the hotel name and coordinates, the day's budget share, the tightest walking cap, the places used on other days, and stop ids must start with `d2_`

#### Scenario: Short skeleton
- **WHEN** the skeleton returns fewer days than requested
- **THEN** missing days are filled with an empty "วันว่าง" row before the day calls

### Requirement: Progressive day events
In split mode the endpoint SHALL send `{ type: 'day', index, day, routes }` as soon as each day is designed, geocoded, routed and scheduled; days MAY arrive out of order and the final `done` plan SHALL be authoritative.

#### Scenario: First day ready
- **WHEN** day 3 finishes before day 1
- **THEN** a `day` event with `index: 2` is sent first, followed by the step "วันที่ 3 พร้อมแล้ว (N จุด)"

#### Scenario: Streaming a day fails
- **WHEN** geocoding or routing a single day throws (not an abort)
- **THEN** the failure is logged, no `day` event is sent for it, and planning continues

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
- **THEN** the stop and every later stop that day move later by the difference, keeping their dwell

#### Scenario: Server-priced songthaew
- **WHEN** a `red` leg of 2 km has `legCost` -1
- **THEN** its cost is ฿20 per person

#### Scenario: Own car
- **WHEN** a leg uses mode `own`
- **THEN** its cost is fuel at ฿4/km split between the people in the car (max 5) plus the model's parking and tolls

### Requirement: Web checks with honest sources
Each stop and leg SHALL record what backs it as `src: { url, title, checked }`, and the server SHALL downgrade `checked: 'web'` to `estimate` with an empty URL whenever the URL is not one the web search actually returned.

#### Scenario: Invented URL
- **WHEN** the model marks a stop `web` with a URL that no search result contained
- **THEN** the stop's `src` becomes `{ url: '', title: '', checked: 'estimate' }`

#### Scenario: Summary of checks
- **WHEN** at least one search ran
- **THEN** a step "ตรวจจากเว็บ N จุด · ประมาณการ M จุด" is emitted

### Requirement: Transport search in parallel with design
When a direction has `by` flight, bus, train or undecided and either `auto` is set or no time is given (and no `choice`), the plan SHALL search transport options in parallel with the design, design around placeholder times (arrive 10:00, depart 20:30), and afterwards set the first stop to the chosen arrival and the last stop to departure minus 90 min (flight) or 40 min (bus/train).

#### Scenario: Recommended flight outside the window
- **WHEN** the recommended outbound option arrives at 19:00
- **THEN** the server prefers a web-checked option arriving 07:00-12:00 (cheapest first) and marks it recommended

#### Scenario: Search fails
- **WHEN** the transport search throws an error other than auth or rate limit
- **THEN** a step "หาเที่ยวบินขาไปไม่สำเร็จ ใช้เวลาประมาณ" is emitted and the plan keeps the placeholder time

#### Scenario: Result in flags
- **WHEN** the search finds options
- **THEN** `plan.flags.transport.go|back = { chosen, options }`

### Requirement: Suggested arrival mode
When a direction is undecided, the plan SHALL set `plan.flags.arrivalSuggested = { by, why }` from the chosen transport option, or from the model's own comparison when no option was found.

#### Scenario: Undecided trip
- **WHEN** `arrive.by` is undecided and the search recommends a train
- **THEN** `flags.arrivalSuggested.by` is `train`

### Requirement: Stay selection
The plan SHALL set `plan.flags.stay = { area, why, booked?, examples[] }`; in auto mode the model SHALL pick the area that minimises travel and fits budgets and give 2-3 real example hotels found with at most one web search (`priceNight` THB per room per night, `checked: 'web'` only for a real search URL), and the first example SHALL become the hotel stop; in booked mode the server SHALL geocode every booked stay (also trying its first 3 and 2 words, then a 200 km radius around the city for a stay in another town), make no hotel search, and set `flags.stay.stays` to each stay with `nights`, `checkIn` and `checkOut` dates.

#### Scenario: Auto stay
- **WHEN** stay mode is auto
- **THEN** `flags.stay.examples` holds up to 3 hotels with web-estimated nightly prices labelled `web` or `estimate`, and the stay cost per person (priceNight × nights ÷ 2) sits on the first hotel stop

#### Scenario: Booked hotel found
- **WHEN** stay is booked as "Novotel Danang Premier Han River" and OSM only knows "Novotel Danang"
- **THEN** the shorter name geocodes, the step reads "ที่พักที่จองไว้: … · พบบนแผนที่", and no hotel search is made

#### Scenario: Booked hotel not found
- **WHEN** no form of the name geocodes
- **THEN** the step for that stay ends "ใช้พิกัดประมาณ" and the model's coordinates are used

#### Scenario: Stay in another town
- **WHEN** a Chiang Mai trip books "Reverie Siam Resort" in Pai, about 80 km from the city centre
- **THEN** the wider search geocodes it near Pai and its hotel stops use those coordinates

### Requirement: Repair round
After the first checks the plan SHALL run at most one repair call when any rule fails, a must-pick is missing, an avoided place is present or a place repeats across days, and SHALL keep the repaired plan only if `pass × 10 − problem lines` does not get worse.

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
When `/api/health` reports no usable model, the UI SHALL fall back to the built-in Chiang Mai sample plan and its pre-built offline scenarios, and agent endpoints SHALL answer with `no_key` (no provider) or `auth` (subscription CLI logged out).

#### Scenario: No provider
- **WHEN** neither an API key nor the CLI is available
- **THEN** `/api/plan` ends with `error` code `no_key` and the UI shows the sample plan

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
- **THEN** every day starts and ends at it as before

#### Scenario: Replan keeps the hotels
- **WHEN** a replan inserts a hotel stop on the move day near Pai
- **THEN** it is pinned to Pai Resort, and the plan text the model read showed "ที่พัก: เริ่มวันจาก Chiang Mai Inn … → นอนที่ Pai Resort" for that day
