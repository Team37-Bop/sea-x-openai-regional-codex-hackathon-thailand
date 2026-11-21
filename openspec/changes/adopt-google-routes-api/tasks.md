## 1. Setup

- [ ] 1.1 Enable Routes API on the Google Cloud project; restrict `GOOGLE_MAPS_API_KEY` to Routes API + Places API (New) and the server IP
- [ ] 1.2 Spike: Routes TRANSIT coverage in Bangkok, Tokyo, Osaka, Seoul, Taipei, Singapore, Hong Kong; record gaps
- [ ] 1.3 Decide the Japan source (NAVITIME API contract vs ODPT key + GTFS router); add `NAVITIME_API_KEY` or `ODPT_CONSUMER_KEY` to KEYS.md

## 2. Server

- [ ] 2.1 Add `server/routes-google.mjs`: computeRoutes/computeRouteMatrix, field masks, time-zone aware `departureTime`, breaker, caps, 15-minute bucket memory cache
- [ ] 2.2 Add `timeLegs()` after `routePlans()` in `finalize()`; one re-time pass for shifted buckets
- [ ] 2.3 Transit mapping: `leg.transit`, Thai `why`, fare → THB, `LESS_WALKING` when a walking cap exists
- [ ] 2.4 Optional `server/transit-jp.mjs` behind its key

## 3. Shared logic

- [ ] 3.1 `schedule()` accepts provider minutes (`leg.provMin`) and sets `leg.timing`; keep the current formula as the fallback
- [ ] 3.2 Keep `legKey` and geometry unchanged so the UI contract stays the same

## 4. UI and contract

- [ ] 4.1 Show "ตามสภาพจราจร" / transit lines on leg rows; "เวลาโดยประมาณ (ไม่รวมรถติด)" for fallback legs; Google attribution
- [ ] 4.2 API.md changelog: `leg.timing`, `leg.transit`

## 5. Verification

- [ ] 5.1 Recorded-response tests for traffic, transit with/without fare, ZERO_RESULTS, 429 fallback
- [ ] 5.2 No-key run of `npm test` and the Chiang Mai sample: identical timings to today
