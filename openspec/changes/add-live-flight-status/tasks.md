## 1. Setup

- [ ] 1.1 Get an AeroDataBox key (API.market or RapidAPI) and set `AERODATABOX_API_KEY` / `AERODATABOX_HOST` in `.env.local`
- [ ] 1.2 Optional: FlightAware AeroAPI key as `FLIGHTAWARE_API_KEY`

## 2. Server

- [ ] 2.1 Add `server/flight-status.mjs`: provider clients, code normalisation, cache, breaker, daily cap
- [ ] 2.2 Event rules: delay ≥ 30 min, cancel, divert
- [ ] 2.3 `POST /api/flight-status` in `server/api.mjs` (works without a model)

## 3. UI

- [ ] 3.1 Poller with the 24 h window and 30/10-minute cadence; stop after landing
- [ ] 3.2 Alert strip with source label and "ให้ Bop ปรับแผน" → generated replan command
- [ ] 3.3 Keep the offline delay scenario for the sample

## 4. Phase 2 (after add-line-messaging)

- [ ] 4.1 Watch list and FlightAware alerts webhook (`FLIGHTAWARE_WEBHOOK_SECRET`) or a scheduled poller
- [ ] 4.2 Push alerts to the group's LINE chat

## 5. Contract and verification

- [ ] 5.1 API.md changelog; KEYS.md update
- [ ] 5.2 Recorded-response tests: on time, 90-min delay, cancel, divert, no key
