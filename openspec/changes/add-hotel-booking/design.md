## Context

`stayFlag()` (`server/agent.mjs`) builds `plan.flags.stay = { area, why, booked?, examples[] }` from the model's answer; examples are web-checked only if their URL came from a search. In split mode the skeleton picks the area and hotel (1 search); the first example becomes the hotel stop, and its cost per person (priceNight × nights ÷ 2) sits on the first hotel stop. Booked mode geocodes the given name and pins every hotel stop.

## Goals / Non-Goals

**Goals:**
- Live hotel rates for the chosen area and dates, feeding the plan's stay cost.
- Prebook → approve → book → cancel, sandbox first.
- A provider adapter so partner APIs can be added later.

**Non-Goals:**
- Letting the model book; it only chooses the area.
- Homestays/vacation rentals, loyalty rates.
- Splitting room bills between members (that is `add-payments`).

## Decisions

### Provider: LiteAPI (sandbox first)
- Rates: `POST https://api.liteapi.travel/v3.0/hotels/rates` with `latitude`, `longitude`, `radius` (area centre from the model or geocoded area, 2-3 km), `checkin`, `checkout`, `occupancies` (rooms = ceil(members/2), 2 adults each), `currency: 'THB'`, `guestNationality: 'TH'`, `limit`. Static data from `/data/hotels` for names, stars, photos, coordinates.
- Prebook: `POST https://book.liteapi.travel/v3.0/rates/prebook` with `offerId` → `prebookId`, final price, cancellation policy.
- Book: `POST /rates/book` with `prebookId`, holder (organizer), guests per room, payment. Payment via LiteAPI's payment SDK (per-transaction secret, no API key in the browser) or, when Bop is merchant of record, after capture in `add-payments`.
- Cancel: `PUT /bookings/{bookingId}` (cancel) after showing the policy and refund.
- Auth header `X-API-Key: $LITEAPI_KEY`; sandbox keys start with `sand_`.
- Why LiteAPI: self-serve signup, a sandbox, global inventory, commission/margin model, no registered-business gate for the sandbox.

### Later providers (adapters)
| Provider | Access | Notes |
|---|---|---|
| Hotelbeds APItude | Contract, registered business, certification | Wholesale rates; `HOTELBEDS_API_KEY` + `HOTELBEDS_SECRET` (signature) |
| Agoda partner API | Partner approval, registered business | Strong Thai/Asian inventory; affiliate links as an interim (`AGODA_PARTNER_ID`) |
| Booking.com Demand API | Partner-gated, registered business, approval | `BOOKING_DEMAND_API_TOKEN`, `BOOKING_AFFILIATE_ID`; display rules from Booking.com |
Adapter interface: `searchRates(area, dates, occupancy)`, `prebook(offer)`, `book(prebook, holder, guests, payment)`, `cancel(booking)`.

### Request flow
1. Design/skeleton picks the area as today (the prompt no longer asks the model to search hotels when a provider is on; `searchCap` for the skeleton drops to 0).
2. Server geocodes the area centre, calls `searchRates`, picks up to 3 examples: best value within the strictest member budget share, best rated, and nearest the day's centroid.
3. `flags.stay.examples[i] = { name, priceNight, src: { url: '', title: 'LiteAPI' }, checked: 'live', ll, offerId, bookable: true, refundable, cancelBy?, stars? }`; first example becomes the hotel stop (coordinates from the provider).
4. Bookings tab: "จองที่พักนี้" → prebook → approval screen (total for all rooms and nights in THB, policy, refundable until) → book → booking id stored in `flags.stay.booking`.
5. A later stay change by command goes through `/api/replan`; a booked hotel is treated like `stay.mode: 'booked'` from then on.

### Caching
- Rates: not persisted; in-memory 15 min per area/dates/occupancy (rates change).
- Static hotel data: disk cache 7 days (allowed by LiteAPI terms; re-check per provider).

### Cost and quotas
- LiteAPI: no fee for search in sandbox; production earns commission/margin per booking; rate-limit per key. Hotelbeds/Agoda/Booking have contract terms.
- Guards: one rates call per plan (+1 per replan that changes area); daily cap `BOP_HOTEL_DAILY_SEARCHES`.

### Fallback to today's no-key path
No key, sandbox/production error, timeout (8 s) or no rates → the model's web-found examples as today (`checked: 'web'|'estimate'`, no `bookable`), and the skeleton keeps its 1 hotel search.

### Auth and keys
All keys in `.env.local`, read server-side only, never logged or sent to the browser. LiteAPI payment SDK uses a per-transaction secret returned by prebook, not the API key.

### ToS constraints
- Show the provider's cancellation policy, taxes/fees and the total before booking; show "ราคาอาจเปลี่ยน" until prebook.
- Booking.com and Agoda have brand/display rules for their content; follow them when their adapters ship.
- Guest data (names, contact) is PII under PDPA; never sent to the model.

## Risks / Trade-offs

- [Sandbox inventory differs from production] → production key tests on a few real Chiang Mai dates before launch.
- [Rates exceed member budgets] → examples sorted by budget fit; the budget check still runs.
- [Partner-gated providers need a company] → LiteAPI only until Bop is registered.

## Migration Plan

Sandbox key → end-to-end sandbox bookings → production key with booking off (`BOP_HOTEL_BOOKING=0`) showing live prices only → enable booking after payment and legal review.

## Open Questions

- Merchant of record: LiteAPI payment SDK vs Bop collecting through `add-payments`?
- Room split: default 2 per room, or ask members in setup?
