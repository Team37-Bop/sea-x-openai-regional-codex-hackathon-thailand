## Why

A delayed flight is the disruption that most often breaks day 1 or the airport buffer on the last day, but Bop only has a simulated delay scenario (`SCEN` "สายการบินแจ้ง: DMK → CNX เลื่อนเป็น 09:30 ถึง 10:45"). Live flight status from AeroDataBox or FlightAware AeroAPI lets Bop notice a real delay or cancellation and offer the same minimal replan.

## What Changes

- New server flight-status lookup for the chosen flights (`flags.transport.go|back` chosen option with `code`, or a Duffel order) by flight number and date.
- New endpoint `POST /api/flight-status` returning status, scheduled/revised/actual times and a `delay` event when arrival or departure moves by 30 min or more, or the flight is cancelled or diverted.
- The planner polls it while open on the travel days (from 24 h before departure until landing) and shows an alert with "ให้ Bop ปรับแผน", which sends `/api/replan` with a generated command; nothing changes without the organizer's tap.
- Phase 2 (with `add-line-messaging`): server-side watches with FlightAware alerts or scheduled polling push the alert to the group's LINE chat.
- The simulated delay scenario stays for the offline sample.

## Capabilities

### New Capabilities
- `flight-status`: status lookup, delay/cancellation detection, polling window, providers, caching and quotas.

### Modified Capabilities
- `replanning`: a flight-status event can start a replan with a generated command (added requirement).

## Impact

- Code: new `server/flight-status.mjs`, route in `server/api.mjs`, alert strip and poller in `src/main.js`, API.md changelog.
- Keys: `AERODATABOX_API_KEY` (API.market or RapidAPI host via `AERODATABOX_HOST`) or `FLIGHTAWARE_API_KEY` (AeroAPI); `.env.local`, server only.
- No-key fallback: today's behaviour (no live status; the simulated delay scenario on the sample; the organizer can still type "ไฟลต์ดีเลย์ …" as a replan command).
