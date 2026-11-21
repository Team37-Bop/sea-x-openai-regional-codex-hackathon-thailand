## Why

In auto stay mode Bop picks an area and shows 2-3 example hotels found with one web search (`plan.flags.stay.examples`, `priceNight` web-estimated, `checked: 'web'|'estimate'`). There is no live price, availability or booking, so the group still books elsewhere and the plan's stay cost is a guess. LiteAPI offers a self-serve sandbox with search, rates, prebook, book and cancel, which lets Bop prove the flow before applying to partner-gated hotel APIs.

## What Changes

- With `LITEAPI_KEY` set, auto stay mode searches real rates around the chosen area for the trip dates and room occupancy (2 per room by default), and `flags.stay.examples` are filled from LiteAPI with live `priceNight` in THB, `checked: 'live'`, `offerId`, `bookable`, cancellation policy and refundability.
- The stay cost on the first hotel stop uses the chosen live rate.
- New hotel booking flow: prebook (price and policy re-check) → organizer approval → book → cancel; LiteAPI sandbox first.
- Later providers (Hotelbeds APItude, Agoda partner API, Booking.com Demand API) are designed as adapters; each is partner-gated and needs a registered business.
- Booked mode is unchanged (no search), and web search stays as the fallback for examples.

## Capabilities

### New Capabilities
- `hotel-booking`: rate search, prebook, approval, book, cancel, sandbox/live, provider adapters.

### Modified Capabilities
- `itinerary-planning`: stay selection takes example hotels and prices from live rates when available, web search otherwise.

## Impact

- Code: new `server/hotels/liteapi.mjs` (+ adapter interface), endpoints `POST /api/hotels/rates`, `/api/hotels/prebook`, `/api/hotels/book`, `/api/hotels/cancel`; `stayFlag()` and the skeleton/design prompts in `server/agent.mjs`; bookings tab in `src/main.js`; API.md changelog.
- Keys: `LITEAPI_KEY` (sandbox `sand_…` or production); later `HOTELBEDS_API_KEY` + `HOTELBEDS_SECRET`, `AGODA_PARTNER_ID` + `AGODA_API_KEY`, `BOOKING_DEMAND_API_TOKEN` + `BOOKING_AFFILIATE_ID`. All in `.env.local`, server only.
- Depends on: `add-payments` (or LiteAPI's payment SDK) for collecting payment.
- No-key fallback: today's behaviour (the model picks the area and finds up to 3 example hotels with one web search, web-estimated `priceNight`, no booking).
