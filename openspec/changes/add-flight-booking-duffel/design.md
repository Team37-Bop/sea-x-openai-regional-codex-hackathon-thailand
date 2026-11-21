## Context

`runTransport` (`server/agent.mjs`) asks the fast model to web-search up to 4 times and returns 3-5 `TransportOption`s with web-estimated THB prices; `/api/plan` runs the same search in parallel with design and retimes the first/last stop to the chosen option. Replans can switch flights by command. Nothing is bookable. Owner decision 2026-11-08 parks keyed services (KEYS.md).

Market facts as of Nov 2026: Amadeus Self-Service APIs were decommissioned on 17 Jul 2026 (Enterprise only); Kiwi.com Tequila is partner-only; Skyscanner's API is for commercial partners only. Duffel offers self-serve test mode and booking for many airlines (NDC and other sources).

## Goals / Non-Goals

**Goals:**
- Live, bookable flight offers for the group in the existing transport picker.
- A safe booking flow: refresh, seats/bags, passenger details, explicit approval, order, cancel.
- Test mode end to end before any live booking.

**Non-Goals:**
- Buses, trains, ferries (12Go is a separate future change).
- Loyalty programmes, multi-city itineraries, group fares (10+).
- Collecting card data in Bop (handled by `add-payments` hosted pages).

## Decisions

### Provider: Duffel
- `POST /air/offer_requests?return_offers=true` with `slices: [{ origin, destination, departure_date }]`, `passengers: [{ type: 'adult' } × members]`, `cabin_class: 'economy'`, `max_connections: 1`. Headers `Authorization: Bearer $DUFFEL_ACCESS_TOKEN`, `Duffel-Version: v2`.
- Map the best offers (cheapest, fastest, best fit to the plan window as `fits()` does today) to `TransportOption`: carrier = `owner.name`, code = marketing carrier + flight number, dep/arr local times, `price` = `total_amount` per passenger converted to THB (or native THB), `bag` from `conditions`/baggage allowance, `src: { url: '', title: 'Duffel' }`, `checked: 'live'`, `offerId`, `expiresAt`, `bookable: true`.
- Before booking: `GET /air/offers/{id}?return_available_services=true` (fresh price + bag services), `GET /air/seat_maps?offer_id=` for seats.
- Order: `POST /air/orders` with `selected_offers`, `passengers` (Duffel passenger ids, given/family name, `born_on`, `gender`, `title`, email, phone, identity documents when `passenger_identity_documents_required`), `services` (bags/seats with quantity), and `payments: [{ type: 'balance', currency, amount }]` for instant orders, or `type: 'hold'` when `payment_requirements.requires_instant_payment` is false (pay before `payment_required_by`).
- Cancel: `POST /air/order_cancellations` (quote, refund amount) then `/confirm` after the organizer approves.
- Webhooks (`order.airline_initiated_change_detected`, order updates) verified with `DUFFEL_WEBHOOK_SECRET`, feeding `add-live-flight-status` replans.
- Alternatives: Amadeus Enterprise (contract), Travelport/Sabre direct (agency accreditation), Kiwi Tequila (partner approval), Skyscanner (commercial referral, not booking).

### Price-only data complement
SerpApi Google Flights (`SERPAPI_KEY`) MAY add display-only options for carriers or routes Duffel does not sell (e.g. some Thai LCCs). They carry `bookable: false`, `checked: 'web'`, a link to the airline site, and never enter the booking flow. Respect SerpApi's terms and Google's; treat as optional.

### Auth and keys
- `DUFFEL_ACCESS_TOKEN` (`duffel_test_…` in test, `duffel_live_…` live), `DUFFEL_WEBHOOK_SECRET`, `SERPAPI_KEY` in `.env.local`, server only, never logged. The mode is derived from the token prefix and shown to the organizer as "โหมดทดสอบ" in test.

### Request flow
1. Transport search: if Duffel is enabled and `by === 'flight'`, call Duffel (8 s timeout); in parallel (optional) SerpApi. If Duffel returns offers, the model web search is skipped for flights; else today's search runs.
2. The plan picks an option as today; `flags.transport.<dir>.chosen` can point to a Duffel offer.
3. Bookings tab: "จองเที่ยวบินนี้" → server refreshes the offer (`expiresAt`, price change → show the new total).
4. Seats and bags step (optional per passenger).
5. Passenger form (per member; PII kept server-side for the order only, encrypted at rest if stored, never passed to the model or logs).
6. Approval screen: exact total in THB and original currency, fare conditions (change/refund), hold vs pay now. The organizer taps "ยืนยันจอง".
7. Payment: test mode uses Duffel balance directly; live mode requires a captured payment from `add-payments` first, then `payments: balance`.
8. Order created → booking reference (PNR) stored in `plan.flags.transport.<dir>.order`; LINE message optional.
9. Failure (offer expired, price changed, sold out) → back to step 3 with fresh offers; never retry an order automatically.

### Caching
- Offers are not cached beyond their `expires_at` (typically 15-30 min); offer requests are per search.
- Orders are stored server-side (`server/.data/orders.json` or a DB) with the minimum PII Duffel needs back for changes/cancellations.

### Cost and quotas
- Duffel charges per order and a percentage on managed content, plus payment fees and ancillary fees; excess searches beyond a search-to-book ratio are billed. Check the current Duffel pricing page.
- Guards: one offer request per direction per search; reuse the request for re-sorting; daily search cap `BOP_DUFFEL_DAILY_SEARCHES`.

### Test mode first, then live
- Test: `duffel_test_` token, Duffel Airways (ZZ) routes, no money. Covers the full flow incl. holds and cancellations.
- Live: Duffel organisation verification (KYC/KYB: business details, directors, bank), fund balance or enable Duffel Payments, live token. Thai legal check on selling air tickets (licensing, consumer law, PDPA) before launch.

### Fallback to today's no-key path
No token, Duffel 4xx/5xx, timeout or no offers → today's web-search options (`checked: 'web'|'estimate'`, `bookable` absent) and the bookings tab shows the airline link only. Bus/train always use web search.

### ToS constraints
- Duffel terms: display fare conditions and the total before booking, airline-specific rules, no storage of card data.
- SerpApi results are display-only and must not be presented as bookable fares.

## Risks / Trade-offs

- [Thai LCC coverage gaps in Duffel] → price-only display + airline link; keep web search.
- [Price changes between search and order] → mandatory refresh and re-approval.
- [Merchant of record and licensing in Thailand] → legal review before live.
- [PII exposure] → never in prompts/logs; minimum retention.

## Migration Plan

Test token on the owner's machine → full flow on Duffel Airways → legal and KYC → live token with booking disabled by `BOP_FLIGHT_BOOKING=0` until approved → enable.

## Open Questions

- Merchant of record: Bop collects (Opn) and pays Duffel balance, or Duffel Payments collects directly?
- Is a Thai tourism/ticketing licence required for Bop's model?
- Which Thai domestic carriers (Thai AirAsia, Nok Air, Thai Lion Air, Bangkok Airways, Thai Airways, Thai VietJet) are bookable through Duffel today?
