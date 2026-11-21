## Why

Many stops are ticketed activities (Doi Inthanon day tours, elephant sanctuaries, Ba Na Hills, theme parks, cooking classes). Bop plans them with a web-estimated entry `cost` and tells nobody whether tickets sell out or are cheaper online. Activity marketplaces (Viator, Klook, KKday) have partner/affiliate programmes with product search, live prices and booking or deep links.

## What Changes

- For stops of kind sight, nature, view and market that look ticketed, the server searches partner products near the stop and the trip date, and the place sheet shows up to 3 offers (title, price per person in THB, duration, free cancellation, rating, provider) with "จองล่วงหน้า".
- Phase 1 (affiliate): offers open the partner's page with Bop's affiliate id (Klook, KKday affiliate links; Viator Basic-access affiliate API with `exp-api-key`). No money passes through Bop.
- Phase 2 (full access, where granted): availability check, hold and book through Viator Partner API full access (merchant), following the same approval-before-payment rule as flights and hotels.
- The stop's `cost` may use the matched product price when the organizer picks an offer.
- Without keys, Bop keeps the model's web-estimated entry prices and the sources it found.

## Capabilities

### New Capabilities
- `activity-booking`: partner product search, matching to stops, affiliate links, availability/booking (phase 2), keys and disclosures.

### Modified Capabilities
- `place-research`: the details sheet can show bookable activity offers (added requirement).

## Impact

- Code: new `server/activities/{viator,klook,kkday}.mjs`, endpoint `POST /api/activities`, `src/ui/place.js` offers block, API.md changelog.
- Keys: `VIATOR_API_KEY`, `VIATOR_PARTNER_ID` (campaign/affiliate params), `KLOOK_AFFILIATE_ID`, `KKDAY_PARTNER_KEY`, `KKDAY_AFFILIATE_ID`; `.env.local`, server only.
- Business: affiliate programmes need approval; Viator full access and Klook/KKday booking APIs need partner contracts and usually a registered business.
- No-key fallback: today's behaviour (entry prices are web estimates in `stop.cost`, `details.price` and `details.booking` from research, sources linked).
