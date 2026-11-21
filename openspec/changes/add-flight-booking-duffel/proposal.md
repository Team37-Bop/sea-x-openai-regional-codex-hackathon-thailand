## Why

Bop's flight options are web-search estimates (`/api/transport-options`, `checked: 'web'|'estimate'`, "ราคาเป็นค่าประมาณจากเว็บ") and booking is sandbox text only. Groups need live fares they can actually buy, with seats and bags. The usual self-serve flight APIs are gone or gated: Amadeus Self-Service was decommissioned on 17 Jul 2026 (Enterprise only), Kiwi Tequila is partner-only and Skyscanner's API is commercial-only. Duffel still offers self-serve signup, a full test mode and booking (offer requests → orders).

## What Changes

- With `DUFFEL_ACCESS_TOKEN` set, `/api/transport-options` for `by: 'flight'` creates a Duffel offer request (one slice per direction, the group's passenger count) and returns live offers mapped to the existing `TransportOption` shape plus `offerId`, `expiresAt`, `bookable: true`, `checked: 'live'`.
- New flight booking flow: refresh the offer, show seat maps and bag services, collect passenger details, the organizer approves the exact total, then create a Duffel order; cancel via order cancellations.
- Test mode first (`duffel_test_` token, Duffel Airways). Live mode only after Duffel organisation verification (KYC/KYB) and a payment setup (Duffel balance funded from `add-payments`, or Duffel Payments).
- Optional price-only data (`SERPAPI_KEY`, SerpApi Google Flights) to show prices for carriers Duffel cannot sell, labelled as not bookable.
- Web search stays for buses and trains, for flights when Duffel has no key or no offers, and as the current no-key path.

## Capabilities

### New Capabilities
- `flight-booking`: Duffel offers, seat/baggage services, passenger details, approval, order creation, cancellation, test/live modes.

### Modified Capabilities
- `transport-search`: flight options come from Duffel when available (live, bookable) with web search as fallback; option shape gains `offerId`, `expiresAt`, `bookable`, `checked: 'live'`.

## Impact

- Code: new `server/duffel.mjs`, `server/flight-booking.mjs`, endpoints `POST /api/flights/offer`, `/api/flights/order`, `/api/flights/cancel`; `runTransport`/`searchTransport` in `server/agent.mjs`; bookings tab in `src/main.js`; API.md changelog.
- Keys: `DUFFEL_ACCESS_TOKEN` (test or live), optional `DUFFEL_WEBHOOK_SECRET`, optional `SERPAPI_KEY`; `.env.local`, server only.
- Data: passenger PII (names, birth dates, passport where required) handled under Thai PDPA, never sent to the model.
- Depends on: `add-payments` for collecting money before a live order.
- No-key fallback: today's web-searched flight options with `checked: 'web'|'estimate'`, "ราคาเป็นค่าประมาณจากเว็บ", no booking.
