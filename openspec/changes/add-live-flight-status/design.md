## Context

The chosen flight for each direction lives in `plan.flags.transport.<dir>` (`carrier`, `code`, `dep`, `arr`) or in `setup.arrive/depart.choice`; the first stop of day 1 is the arrival time and the last stop is departure − 90 min. `/api/replan` already handles "เปลี่ยนเที่ยวบิน…" commands, re-times the first/last stop and returns an updated `setup`. Bop has no server-side trip store or scheduler today: plans live in the browser.

## Goals / Non-Goals

**Goals:**
- Detect real delays (≥ 30 min), cancellations and diversions of the group's flights.
- Hand a precise command to the existing replan.
- Keep per-trip cost small.

**Non-Goals:**
- Gate/baggage belt details, live maps.
- Rebooking a cancelled flight (Duffel order changes are a later step of `add-flight-booking-duffel`).
- A server trip database (phase 2 adds only a watch list).

## Decisions

### Providers
- AeroDataBox (default): `GET /flights/number/{code}/{YYYY-MM-DD}` → scheduled, revised and actual times (local and UTC), status (`Expected`, `Delayed`, `Departed`, `Arrived`, `Canceled`, `Diverted`). Through API.market or RapidAPI; key `AERODATABOX_API_KEY`, host `AERODATABOX_HOST`. Pay-per-call tiers, cheap for low volume.
- FlightAware AeroAPI (alternative/upgrade): `GET /flights/{ident}` with header `x-apikey: $FLIGHTAWARE_API_KEY`; alerts (`POST /alerts`) push status changes to a webhook, removing polling in phase 2. Per-query pricing with a monthly minimum on paid tiers.
- AviationStack: considered; free tier lacks HTTPS and real-time precision, not chosen.
Provider choice: AeroDataBox when its key is set, else FlightAware, else none.

### Auth and keys
`AERODATABOX_API_KEY`, `AERODATABOX_HOST`, `FLIGHTAWARE_API_KEY`, `FLIGHTAWARE_WEBHOOK_SECRET` (phase 2) in `.env.local`; server only; never logged.

### Request flow (phase 1, client-driven)
1. UI posts `{ setup, plan }` to `POST /api/flight-status` when the planner is open and now is within [departure − 24 h, arrival + 1 h] for either direction.
2. Server extracts the chosen flights (code + date), skips options without a flight `code` (bus/train or unknown).
3. Lookup with cache; compute `delayArr = revisedArr − scheduledArr`, `delayDep` likewise.
4. Event if `|delay| >= 30` min, status `Canceled`/`Diverted`, or an airport change. Response `{ flights: [{ dir, code, status, sched, revised, actual }], events: [{ dir, kind: 'delay'|'cancel'|'divert', minutes?, newDep?, newArr? }] }`.
5. UI alert: "ไฟลต์ FD3433 ดีเลย์ 90 นาที ถึง 10:45" with "ให้ Bop ปรับแผน" → `/api/replan` command "สายการบินแจ้ง: FD3433 DMK → CNX เลื่อนเป็น 09:30 ถึง 10:45" and `day` = 0 (go) or last (back). Cancellation command asks Bop to propose options ("ไฟลต์ … ถูกยกเลิก ช่วยหาทางเลือก").
6. Poll interval: every 30 min until 6 h before departure, every 10 min within 6 h, stop after landing.

### Phase 2 (server watches, with LINE)
A small watch list (`server/.data/watches.json`: trip id, flight code, date, LINE group id) created when the organizer enables notifications. FlightAware alerts webhook, or a scheduler polling AeroDataBox at the same cadence, pushes alerts via `add-line-messaging`.

### Caching
In memory per `code|date`, TTL 5 min (10 min when > 6 h to departure); shared across clients. Breaker 10 min on 429/5xx.

### Cost and quotas
- Phase 1 with the cadence above: about 20-40 calls per flight on its day, 2 flights per trip.
- Guards: `BOP_FLIGHT_STATUS_DAILY_CAP`; no calls outside the window; one call per flight per cache period regardless of open tabs.

### Fallback to today's no-key path
No key, breaker open or cap reached → the endpoint returns `{ flights: [], events: [], reason: 'unavailable' }`; the UI shows nothing new. The organizer can still type a delay as a replan command, and the sample's simulated delay stays.

### ToS constraints
- AeroDataBox and FlightAware data are for display in the app; no redistribution or resale; FlightAware requires attribution where its data is shown ("ข้อมูลเที่ยวบิน: FlightAware").
- Times shown as provider-reported, labelled with the source.

## Risks / Trade-offs

- [Codeshare/code format mismatch] → normalise `code` (strip spaces, uppercase), try the operating carrier code from Duffel orders.
- [Early-morning flights while the app is closed] → phase 2 server watches.
- [Small delays causing noise] → 30-minute threshold; minor changes shown as info only.

## Migration Plan

Additive behind the key. Rollback by removing the key.

## Open Questions

- Should the 30-minute threshold depend on the day-1 slack (e.g. alert at 15 min when the first stop is a timed reservation)?
