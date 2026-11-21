## Why

The setup screen takes one booked hotel, and every day starts and ends there. Many Thai group trips change hotel along the way (2 nights in เชียงใหม่ then 1 night in ปาย), so the plan sends the group back to the wrong hotel on the move day and on every night after it.

## What Changes

- `TripSetup.stay` in booked mode becomes `{ mode:'booked', stays: [{ name, nights }] }`, in trip order, the first stay starting on night 1. The old `{ mode:'booked', name }` is still accepted and means one stay for every night.
- Setup UI: in "จองไว้แล้ว" mode the organizer sees one row covering all nights by default, can add rows with "+ เพิ่มที่พัก", set nights per row, and see each row's dates. Planning is blocked with a Thai message when the nights do not add up to the trip's nights (days - 1). A 1-day trip has no nights: the name is optional and is used as a base for the day.
- Server: every stay is geocoded with the existing fallbacks plus a wider radius for stays in another town. Day i starts at the hotel of night i-1 and ends at the hotel of night i (day 1 starts at the arrival point, the last day ends at departure). On a move day the start hotel stop carries a check-out/luggage note. Hotel stops from the model are pinned to that day's hotels and a missing start/end hotel stop is added.
- The model is told each day's hotels: `TripSetup.stayPlan` lines in every design, skeleton, day, repair and replan call, the system prompt rule for booked stays, and `planBrief` day headers. Replans pin inserted or replaced hotel stops the same way.
- `plan.flags.stay.stays` lists each booked stay with nights and check-in/check-out dates; the bookings tab shows them.
- Auto mode is unchanged.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `trip-setup`: the stay mode carries a list of booked stays with nights.
- `itinerary-planning`: booked stay selection geocodes every stay, and each day starts and ends at the hotel of its nights.

## Impact

- Code: `src/plan.js` (`bookedStays`, `dayStays`, `stayLine`, `planBrief(plan, setup)`), `server/agent.mjs` (normaliser, geocoding, pinning, anchoring, split-day prompts, `stayFlag`, replan), `server/prompts.mjs` (booked-stay rules), `server/fake-llm.mjs` (names hotel stops per day), `src/ui/setup.js` and `src/main.js` (stay rows, bookings tab), `src/style.css`.
- Contract: API.md v16 (fields added, old shape still accepted).
- Tests: `scripts/test-stays.mjs` in `npm test`.
- No new keys or services.
