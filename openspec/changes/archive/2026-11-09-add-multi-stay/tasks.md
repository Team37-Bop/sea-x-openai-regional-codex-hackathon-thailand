## 1. Shared logic

- [x] 1.1 `bookedStays(stay, days)` in `src/plan.js`: old `{ name }` shape, blank names, missing nights, sums that do not add up to days - 1, 1-day trips
- [x] 1.2 `dayStays(setup)` (start/end hotel and move flag per day) and `stayLine(setup, i)` (Thai line for prompts)
- [x] 1.3 `planBrief(plan, setup)` adds the day's hotels to each day header

## 2. Server

- [x] 2.1 `normalizeSetup` returns `{ mode:'booked', stays }` or `{ mode:'auto' }`
- [x] 2.2 Geocode every stay (name forms, then a 200 km radius around the city); replans reuse the plan's hotel stops first
- [x] 2.3 Pin hotel stops per day and add a missing start/end hotel stop; check-out note on move days
- [x] 2.4 `TripSetup.stayPlan` for the design, skeleton, day, repair and replan calls; per-day role and hotel lines in split design
- [x] 2.5 Booked-stay rules in `server/prompts.mjs`; replan keeps each day's hotels
- [x] 2.6 `plan.flags.stay.stays` with nights and check-in/check-out dates
- [x] 2.7 Fake model names hotel stops by the day's start/end hotel

## 3. UI

- [x] 3.1 Stay rows in "จองไว้แล้ว" mode: name, nights, remove, "+ เพิ่มที่พัก", dates and running total
- [x] 3.2 Validation messages in Thai; 1-day trips handled
- [x] 3.3 Bookings tab lists each stay with nights and dates; header shows "พัก A → B"

## 4. Contract and checks

- [x] 4.1 API.md v16 changelog and TripSetup type
- [x] 4.2 `scripts/test-stays.mjs` wired into `npm test`
- [x] 4.3 End-to-end run with `BOP_FAKE_LLM=1` on a spare port: 2 and 3 stays, a stay in another town, a replan
