## 1. Setup

- [ ] 1.1 Create a Duffel account; put the test token in `.env.local` as `DUFFEL_ACCESS_TOKEN`
- [ ] 1.2 Check which Thai domestic and regional carriers Duffel can sell; record gaps
- [ ] 1.3 Legal review: selling air tickets from Thailand, merchant of record, PDPA for passenger data

## 2. Offers

- [x] 2.1 (seat maps not yet) Add `server/duffel.mjs`: offer requests, offers, seat maps, `Duffel-Version: v2`, timeouts, breaker, daily search cap
- [x] 2.2 Map offers to `TransportOption` with `offerId`, `expiresAt`, `bookable`, `checked: 'live'`, THB price
- [x] 2.3 Use Duffel first in `searchTransport` for flights; keep web search for bus/train and as fallback
- [ ] 2.4 Optional SerpApi Google Flights display-only options behind `SERPAPI_KEY`

## 3. Booking flow

- [x] 3.1 (seat map not yet) Endpoints `POST /api/flights/offer` (refresh + services + seat map), `/api/flights/order`, `/api/flights/cancel`
- [x] 3.2 (no PII stored at all; passport fields not yet) Passenger form and server-side PII store with minimal retention; keep PII out of prompts and logs
- [x] 3.3 Approval screen with totals, conditions, hold vs pay now; one order per approval, no auto-retry
- [x] 3.4 Store the booking reference in `plan.flags.transport.<dir>.order`; show it in the bookings tab
- [x] 3.5 Cancellation quote → approval → confirm
- [ ] 3.6 Webhook endpoint with `DUFFEL_WEBHOOK_SECRET` signature check

## 4. Live readiness

- [ ] 4.1 Wire live instant orders to a captured payment from `add-payments`
- [ ] 4.2 Duffel organisation verification and balance funding; `BOP_FLIGHT_BOOKING` switch
- [x] 4.3 API.md changelog and KEYS.md update

## 5. Verification

- [ ] 5.1 End-to-end test mode on Duffel Airways: search, seats, bags, order, hold, cancel
- [x] 5.2 Fallback tests: no token, Duffel 500, no offers
