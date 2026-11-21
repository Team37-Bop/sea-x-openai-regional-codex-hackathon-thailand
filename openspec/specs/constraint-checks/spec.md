# constraint-checks Specification

## Purpose

Compute member and system checks from a scheduled plan in both the browser and the planner's repair loop. The evaluation uses supplied schedule facts, prices and food labels.

Reference implementation in the prep repository at `292ba5f` includes `src/plan.js` (`dayStats`, `evalRules`, `checks`, `explain`, `stopFromSpec`) and `server/agent.mjs` (`report`, `failingDays`). Executable cases are in `scripts/test-closed.mjs`, `scripts/test-diet.mjs` and `scripts/test-stays.mjs`.

## Requirements

### Requirement: Check result shape
`checks()` SHALL return `{ mem, list, pass, total, maxWalk, ds }`: one Thai line per member, all rules with member rules first, the number passed, THB per person for the trip, the highest daily walking km and per-day walk and cost; called without a setup it SHALL use `SAMPLE_SETUP`.

#### Scenario: Sample plan
- **WHEN** `checks(BASE)` runs on the built-in Chiang Mai plan
- **THEN** all 8 rules pass

#### Scenario: Member without constraints
- **WHEN** a member has no structured constraint
- **THEN** `mem[id].txt` is "ไม่มีเงื่อนไขพิเศษ" and `ok` is true

### Requirement: Member rules
For each member the checks SHALL add: wishes (at least as many stops with `star === member.id` as wishes), food restrictions when `avoid` is set (every meal stop has `diet`, or has `veg` when the `avoid` text means vegetarian; legacy `veg: true` is read as avoid "เนื้อสัตว์ (กินมังสวิรัติ)"), walking (every day's walk within `maxWalkKm`, counting place walking plus walk legs) and budget (trip total of stop and leg costs within `budget`).

#### Scenario: Food restriction miss
- **WHEN** a member has avoid "กุ้ง" and one lunch stop lacks `diet`
- **THEN** the rule "ไม่ทาน กุ้ง" fails and `explain()` names that stop

#### Scenario: Vegetarian fallback
- **WHEN** a member has avoid "เนื้อสัตว์ (กินมังสวิรัติ)" and every meal stop has `veg` but not `diet`
- **THEN** the rule passes

#### Scenario: Walking cap
- **WHEN** a member's cap is 3 km and day 2 totals 3.4 km
- **THEN** the rule "เดิน ≤ 3 กม./วัน" fails with "วันที่ 2 เดินรวม 3.4 กม. (เกิน 3)"

#### Scenario: Budget over
- **WHEN** the per-person total is ฿5,300 and the budget is ฿5,000
- **THEN** the member line reads "฿5,300 เกินงบ ฿300"

### Requirement: Opening hours
Every stop SHALL start and end inside its opening window for that weekday, where `stop.days.hours[weekday]` overrides `stop.open`; a window that closes after midnight SHALL be handled, and a stop without hours SHALL pass.

#### Scenario: Visit after closing
- **WHEN** a stop open 08:00-17:00 is scheduled 16:30-17:30
- **THEN** the rule "เวลาเปิด–ปิด" fails with the stop id, its times and its hours

### Requirement: Open on the day
The rule "เปิดวันที่ไป" SHALL fail when a stop's trip day (`startDate` + day index) is in `days.closed`, is not in `days.only` when `only` is set, or its date is in `closures`.

#### Scenario: Weekend market on a Friday
- **WHEN** Jing Jai (`only: ['sat','sun']`) is planned on a Friday
- **THEN** the rule fails with "ตลาดจริงใจ … เปิดเฉพาะวันเสาร์/อาทิตย์ (วันที่ 1, วันศุกร์ 2026-11-20, id jingjai)"

#### Scenario: Dated closure
- **WHEN** a stop has `closures: [{ date: '2026-12-25', why: 'คริสต์มาส' }]` and is planned that day
- **THEN** the rule fails with "ปิดวันที่ 2026-12-25 (คริสต์มาส)"

### Requirement: Meals
Every day SHALL have a lunch stop starting 11:00-14:00 and a dinner stop ending at or after 17:30 and starting at or before 20:30, except lunch on day 1 when arrival is after 13:00, lunch on the last day when departure is before 13:00, and dinner on the last day when departure is before 19:30.

#### Scenario: Late arrival
- **WHEN** the group lands at 14:00 on day 1
- **THEN** day 1 needs no lunch

#### Scenario: Missing dinner
- **WHEN** day 2 has no dinner stop
- **THEN** "มื้อกลางวัน–เย็นครบ" fails with "วันที่ 2 ไม่มีมื้อเย็น …"

### Requirement: Departure buffers
When the last direction has a time, the last stop of the last day SHALL be reached at least 75 min before a flight ("ถึงสนามบินก่อนไฟลต์ N นาที") or 30 min before a bus or train ("ถึงสถานีก่อนรถออก/รถไฟออก N นาที"); an undecided return direction SHALL use `plan.flags.departureSuggested.by` when available.

#### Scenario: Tight airport buffer
- **WHEN** the flight leaves 21:15 and the airport stop starts 20:30
- **THEN** the rule fails with the latest allowed arrival 20:00

### Requirement: Driving rules
When either direction is `drive`, each day's `own` driving SHALL be at most 8 h, and when the trip ends with an `own` leg of 50 km or more the group SHALL reach home by 22:00.

#### Scenario: Long drive day
- **WHEN** day 1 has 8 h 30 min of `own` legs
- **THEN** "ขับรถไม่เกิน 8 ชม./วัน" fails for day 1

### Requirement: Explanations for repair
`explain()` SHALL return each failing rule with its member and concrete Thai reasons that name stop ids and day numbers, so the server can tell the model what to fix and which days to touch.

#### Scenario: Reason lines
- **WHEN** a rule fails on two stops
- **THEN** `explain()` lists both with their ids

### Requirement: Aggregation and units

The evaluator SHALL sum per-person stop and leg costs for every day and then across the trip. It SHALL sum on-site walking and incoming walking legs in kilometres and round each daily sum to one decimal before comparing the largest day with an individual cap. Amounts held only in flight-offer metadata are outside the itinerary total. The display list exposes each rule label and Boolean result, the member name for member rules, and an independent summary for each member ID.

#### Scenario: Shared walking calculation
- **WHEN** a day includes 1.24 km of on-site walking, a walking leg of 1.10 km and a 14 km car ride
- **THEN** its reported daily walking distance is 2.3 km and a 2.3 km cap passes

#### Scenario: No corresponding member rule
- **WHEN** a member has a note about stairs and no positive numeric limit or structured wishes or dietary requirement
- **THEN** the note remains context for the planner and contributes zero tests to the denominator

#### Scenario: Wish count
- **WHEN** a member supplies two wishes and only one stop is starred with that member's ID
- **THEN** the evaluator reports one failed wish rule with the number of qualifying stops. It compares the count of stars with the count of wishes.

#### Scenario: Meal eligibility
- **WHEN** a meal-bearing market has a vegetarian marker and a member reports a shrimp allergy
- **THEN** the vegetarian marker alone fails that meal for that member. A truthy `diet` flag satisfies the evaluator for all specified restrictions. This is a planner-supplied indicator and carries no independent ingredient verification.

### Requirement: Rule boundaries and failure explanations

The daily rule evaluator SHALL calculate the weekday in UTC from the setup start date and day index. It SHALL prefer weekday-specific opening hours, evaluate explicit opening-day and closure constraints independently of hours, and report each failed rule with a concrete reason suitable for repair.

#### Scenario: Opening restrictions collide
- **WHEN** the same visit violates an allow-list of weekdays, a closed weekday, and a dated closure
- **THEN** the day rule reports the allow-list first, otherwise the closed weekday, otherwise the dated closure. The opening-hours rule can fail separately for the same visit.

#### Scenario: Lunch and dinner thresholds
- **WHEN** a one-day trip arrives at 13:00 and leaves at 19:30
- **THEN** both meals are required. A lunch tagged `meal: 'lunch'` starting exactly at 14:00 qualifies. A dinner tagged `meal: 'dinner'` ending exactly at 17:30 qualifies if its start also meets the upper bound.

#### Scenario: Configured own-car limits
- **WHEN** the return direction is drive, the last incoming own-car leg is at least 50 km and the final stop starts at 22:00
- **THEN** the home-arrival check passes at the boundary. For a driving arrival or departure, a day with 480 minutes of own-car legs passes and 481 minutes fails.

#### Scenario: Departure rule eligibility
- **WHEN** a final return time is missing or no final stop is present
- **THEN** the timed departure-buffer rule is omitted. When present, the calculation uses the final stop's start time and the resolved travel mode.

### Requirement: Explain group checks to travelers

The trip summary SHALL show the count of passed checks and list outstanding conditions first. Each condition SHALL disclose its supporting evidence on demand using a place or meal name and the travel date when known. Internal stop identifiers and repair instructions SHALL stay out of the traveler-facing text. Saved plans SHALL use the same presentation as newly generated plans.

#### Scenario: A visit falls outside opening hours
- **WHEN** one visit starts after closing and another starts during opening hours but finishes after closing
- **THEN** the organizer can distinguish arriving too late from staying too long, see the planned time and opening window for each visit, and review both places within the same condition.

#### Scenario: A planned meal is late
- **WHEN** a dinner is scheduled after the allowed meal window
- **THEN** the explanation names the dinner and shows its scheduled start and the meal window. A date with no dinner reports the missing meal.
