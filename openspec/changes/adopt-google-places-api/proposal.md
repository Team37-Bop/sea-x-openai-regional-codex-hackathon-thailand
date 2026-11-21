## Why

Opening hours, phone numbers, vegetarian flags and photos are the facts Bop's plans depend on most, and today they are best-effort: the model reads them from web search, hours and phones are "shown with a source link", and photos of small restaurants are patchy (Wikimedia + og:image). Google Places API (New) returns these as structured fields, including special-day hours, so checks like "เปิดวันที่ไป" can rest on real data.

## What Changes

- With `GOOGLE_MAPS_API_KEY` set, `/api/place-info` resolves the stop with Text Search (New) and reads Place Details (New) fields: `displayName`, `formattedAddress`, `location`, `businessStatus`, `regularOpeningHours`, `currentOpeningHours.specialDays`, `nationalPhoneNumber`/`internationalPhoneNumber`, `reservable`, `servesVegetarianFood`, `priceLevel`/`priceRange`, `rating`/`userRatingCount`, `websiteUri`, `googleMapsUri`, `photos`.
- Place Photos (New) replace Wikimedia and og:image as the first photo source; photos carry Google author attributions.
- After design, `/api/plan` and `/api/replan` enrich food/sight/market/nature/view stops with Places hours, weekly closed days, special-day closures, phone, `reservable` and `servesVegetarianFood` before `checks()` runs, so the repair round fixes real conflicts.
- Web search (model) + OSM + Wikimedia/og:image stay as the fallback when there is no key, the quota is spent, Places has no match, or the breaker is open.
- Google attribution and display rules are applied in the UI.

## Capabilities

### New Capabilities
<!-- none: the behaviour extends existing capabilities -->

### Modified Capabilities
- `place-research`: details and photos come from Places when available; adds Places provider, attribution and fallback requirements.
- `itinerary-planning`: adds Places enrichment of stops (hours, closures, phone, veg, reservable) before checks.

## Impact

- Code: new `server/places.mjs`, changes in `runPlaceInfo`, `runPlan`, `runReplan` (`server/agent.mjs`), `server/photos.mjs` ordering, `src/ui/place.js` attribution, API.md changelog (`photos[].source: 'google'`, `info.provider`).
- Keys: `GOOGLE_MAPS_API_KEY` in `.env.local`, server-only, restricted to Places API (New) and the server's IP.
- Cost: per-call SKUs (Text Search, Place Details Enterprise/Atmosphere fields, Place Photos); see design.
- No-key fallback: unchanged from today (model web search for facts, Photon/Nominatim for coordinates, Wikimedia + og:image for photos, `confidence: 'estimate'` when nothing reliable is found).
- Legal: Google Maps Platform terms on non-Google maps and caching must be resolved before launch (design, Open Questions).
