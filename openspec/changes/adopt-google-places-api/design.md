## Context

Today `runPlaceInfo` asks the fast model to web-search a stop (max 3 searches), normalises the answer (`normalizeInfo`) and adds photos from Wikimedia/og:image (`server/photos.mjs`). Plan stops get `open`, `days.closed/only` and `closures` from the model's own knowledge or its web checks. Coordinates come from Photon/Nominatim. Everything is keyless; owner decision 2026-11-08 parks keyed services until launch (KEYS.md).

## Goals / Non-Goals

**Goals:**
- Structured hours (incl. special days), phone, `reservable`, `servesVegetarianFood`, price level and photos for stops in any country Bop supports.
- Feed verified hours and closures into `checks()` before the repair round.
- Keep every current behaviour as the no-key path.

**Non-Goals:**
- Replacing the MapLibre/OpenFreeMap map (see Open Questions).
- Reviews text, menus (Places has no menu prices; dishes stay from web search).
- Booking through Google (Reserve with Google is partner-only).

## Decisions

### Provider: Google Places API (New)
- Text Search (New) `POST https://places.googleapis.com/v1/places:searchText` with `textQuery` = stop `query` or name + city, `locationBias.circle` = model or OSM coordinates (radius 2 km; 5 km for nature), `languageCode: 'th'`, `regionCode` = trip country. Field mask `places.id,places.displayName,places.location,places.businessStatus` (Essentials/Pro-tier SKU only).
- Place Details (New) `GET /v1/places/{id}` with an explicit field mask per use:
  - place-info: `displayName,formattedAddress,businessStatus,regularOpeningHours,currentOpeningHours,nationalPhoneNumber,internationalPhoneNumber,reservable,servesVegetarianFood,priceLevel,priceRange,rating,userRatingCount,websiteUri,googleMapsUri,editorialSummary,photos`
  - plan enrichment: `regularOpeningHours,currentOpeningHours,businessStatus,servesVegetarianFood,reservable,nationalPhoneNumber`
- Place Photos (New) `GET /v1/{photo.name}/media?maxWidthPx=960&skipHttpRedirect=true`, called server-side; the returned short-lived `photoUri` (no key in it) is what the browser loads.
- Alternatives: Foursquare Places (photos and hours, keyed, weaker coverage in Thailand); legacy Places API (being retired, no `specialDays`); Wongnai has no public API.

### Auth and keys
- `GOOGLE_MAPS_API_KEY` in `.env.local`, read by `server/places.mjs` only, sent as `X-Goog-Api-Key`, never logged, never in a URL the browser sees.
- Key restrictions in Google Cloud: API restriction to Places API (New) (+ Routes API if `adopt-google-routes-api` shares the key), application restriction by server IP. A separate browser key is not needed.

### Request flow
1. Match: Text Search with location bias; accept the first result whose `displayName` matches the stop name/query/aliases (`nameMatches` from `photos.mjs`) and lies within 1.5 km (3 km for areas) of the stop. Otherwise no match.
2. Details: one Place Details call with the field mask above.
3. Mapping to Bop fields:
   - `regularOpeningHours.periods` -> `stop.open` (default window) and `stop.days.hours[weekday]`; weekdays with no period -> `days.closed`.
   - `currentOpeningHours.specialDays` (next 7 days) -> `closures` for trip dates inside that window, `why` "เวลาทำการพิเศษ (Google)".
   - `businessStatus: CLOSED_PERMANENTLY` -> a repair problem line "ปิดถาวร"; `CLOSED_TEMPORARILY` -> closure on all trip dates.
   - `servesVegetarianFood` -> `veg` (true/false only when the field is present; absent keeps the model's value).
   - `reservable` -> `res` hint (true: keep/ask to call; false: `walkin`).
   - `nationalPhoneNumber` -> `res.phone` and `info.phone`.
   - `priceLevel`/`priceRange` -> `details.price` (priceRange converted to THB with the plan's stated rate).
   - `rating`/`userRatingCount` -> `details.rating`.
4. `stop.src` becomes `{ url: googleMapsUri, title: 'Google Maps', checked: 'web' }` and `info.provider: 'google'`.
5. Photos: Places photos first (`source: 'google'`, `match: 'exact'`, credit = `authorAttributions[].displayName`, link `uri`), then the current Wikimedia/og:image chain fills the remaining slots only if Places gives fewer than 2.
6. Dishes, tips and summary still come from the model's web research (Places has no menu), run in parallel.

### Caching
- Place IDs: may be stored indefinitely -> `server/.cache/places.json` keyed `query|lat,lng` -> `placeId`.
- Coordinates: may be cached up to 30 days -> same file with `ts`; purged after 30 days.
- All other Places content (hours, phone, photos, rating): in-memory only, per process, TTL 6 h, never written to disk and never placed in a persistent cache or in the plan's stored copy beyond the session. Photo `photoUri`s are short-lived and not stored.
- `PLACE_CACHE` (`stop.id|n`) keeps working on top for the session.

### Cost and quotas
- Billing is per SKU. Text Search with an ID/location mask is a low tier; Place Details with opening hours/phone is an Enterprise-tier SKU; `reservable`/`servesVegetarianFood` are Atmosphere fields (Enterprise + Atmosphere SKU); each photo is a Place Photos call. Google gives a monthly free-usage cap per SKU instead of the old $200 credit; check the current price sheet before launch.
- Per trip estimate: 3-day plan with ~18 stops -> ~18 Text Search + ~14 enrichment Details; each opened sheet -> 1 Details (cached) + up to 4 photos.
- Guards: `BOP_PLACES_MAX_PER_PLAN` (default 25), a daily counter that turns the provider off at a configured cap (`BOP_PLACES_DAILY_CAP`), quota/429 -> breaker 10 min.

### Fallback to today's no-key path
The provider is enabled only when `GOOGLE_MAPS_API_KEY` is set and the breaker is closed. Any of: no key, 403/429, quota cap reached, no confident match, timeout (4 s) -> the stop goes through today's path unchanged: model web search for facts (`confidence: 'web'|'estimate'`), Photon/Nominatim coordinates, Wikimedia then og:image photos. The step line says which source was used ("ข้อมูลจาก Google Maps" vs "ค้นเว็บ").

### ToS constraints (Google Maps Platform)
- Attribution: show the Google Maps logo/"Google Maps" text wherever Places content is shown without a Google map, and each photo's author attribution with its link. Keep Google's text unmodified.
- No use with a non-Google map: the Maps Platform terms restrict showing Google Maps content on or near a non-Google map. Bop's map is MapLibre + OpenFreeMap, so Places content is shown in the details sheet and stop rows only, markers keep OSM coordinates, and the map question is an open item for legal review before launch.
- Caching limits as above (place IDs indefinitely, lat/lng 30 days, nothing else persisted).
- No scraping or bulk export; no training or building datasets from Places content. Places fields pass to the model only inside the request that needs them and are not stored in prompts or logs.
- EEA customers have separate terms; Bop's market (Thailand) is under the standard terms.

## Risks / Trade-offs

- [Non-Google map restriction] -> keep Places off the map now; decide between moving the map to Google (Maps JS / Map Tiles) and limiting scope before launch.
- [Cost spikes from large groups or long trips] -> per-plan and daily caps, field masks, in-memory cache.
- [Wrong match for common names] -> name + distance gate; no match falls back to today's path.
- [Hours in Places can be stale too] -> still show the source ("Google Maps") and keep the "ตรวจจากเว็บ" badge semantics.

## Migration Plan

1. Ship `server/places.mjs` behind the key; without the key nothing changes.
2. Enable on the owner's machine with a test key and per-day cap; compare 20 plans against the web-search path.
3. Resolve the map/terms question, then enable for users.
Rollback: remove the key from `.env.local`.

## Open Questions

- Move the map to Google Maps when Places is on, or keep Places content off-map? Needs a legal read of the current Maps Platform terms.
- Is passing Places hours/phone into the repair prompt within the terms, or should the server apply them without the model seeing them?
