## 1. Setup and legal

- [ ] 1.1 Create a Google Cloud project, enable Places API (New), create a key restricted to that API and the server IP; put it in `.env.local` as `GOOGLE_MAPS_API_KEY`
- [ ] 1.2 Legal read of the Maps Platform terms for a MapLibre/OpenFreeMap map, caching and passing Places content to the model; record the decision in design.md
- [ ] 1.3 Set budget alerts and the per-SKU quota caps in Google Cloud

## 2. Server provider

- [ ] 2.1 Add `server/places.mjs`: Text Search and Place Details with field masks, `X-Goog-Api-Key`, 4 s timeout, breaker, per-plan and daily caps
- [ ] 2.2 Match gate: name variants + distance (reuse `nameMatches`/`variants` from `photos.mjs`)
- [ ] 2.3 Map Places fields to `open`, `days.hours`, `days.closed`, `closures`, `veg`, `res`/`walkin`, `phone`, `details.*`
- [ ] 2.4 Place Photos via `skipHttpRedirect=true`; return `photoUri` with author attributions
- [ ] 2.5 Caches: place IDs and 30-day coordinates on disk; everything else in memory with 6 h TTL

## 3. Wiring

- [ ] 3.1 `runPlaceInfo`: Places first, model research in parallel for dishes/tips, fallback to today's path
- [ ] 3.2 `runPlan`/`runReplan`: enrichment step before `checks()`; step line names the source
- [ ] 3.3 `photosFor`: Places photos first, existing chain fills remaining slots

## 4. UI and contract

- [ ] 4.1 `src/ui/place.js`: Google Maps attribution and photo author links; keep "ตรวจจากเว็บ" logic
- [ ] 4.2 API.md changelog: `info.provider`, `photos[].source: 'google'`, `src.title: 'Google Maps'`
- [ ] 4.3 KEYS.md row status update

## 5. Verification

- [ ] 5.1 Recorded-response tests: match, no match, closed Monday, special day, permanently closed, 429 fallback
- [ ] 5.2 Run `npm test` and a no-key smoke run to confirm the fallback path is unchanged
