# constraint-checks Specification

## Purpose
`checks(plan, setup)` and `explain(plan, setup)` in `src/plan.js` evaluate every member rule and system rule on a plan. The browser recomputes them on every plan change; the server uses them to decide on a repair and to describe failures to the model. Both run without a network or a model.

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
Every day SHALL have a lunch stop starting 11:00-14:00 and a dinner stop ending after 17:30 and starting before 20:30, except lunch on day 1 when arrival is after 13:00, lunch on the last day when departure is before 13:00, and dinner on the last day when departure is before 19:30.

#### Scenario: Late arrival
- **WHEN** the group lands at 14:00 on day 1
- **THEN** day 1 needs no lunch

#### Scenario: Missing dinner
- **WHEN** day 2 has no dinner stop
- **THEN** "มื้อกลางวัน–เย็นครบ" fails with "วันที่ 2 ไม่มีมื้อเย็น …"

### Requirement: Departure buffers
When the last direction has a time, the last stop of the last day SHALL be reached at least 75 min before a flight ("ถึงสนามบินก่อนไฟลต์ N นาที") or 30 min before a bus or train ("ถึงสถานีก่อนรถออก/รถไฟออก N นาที"); an undecided direction SHALL use `plan.flags.arrivalSuggested.by`.

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
