## Context

Activities are ordinary stops (`k` sight/nature/view/market) with a per-person THB `cost` the model estimates from the web, and `/api/place-info` adds `details.price` and `details.booking` strings. Nothing links to a ticket seller.

## Goals / Non-Goals

**Goals:**
- Show real, bookable offers for activity stops with THB prices.
- Earn affiliate commission in phase 1 without handling payments.
- Keep booking (phase 2) behind organizer approval and `add-payments`.

**Non-Goals:**
- Letting the model invent activities from catalogues (it still plans real places; offers attach to them).
- Restaurants (no marketplace here) and transport passes (could come later, e.g. JR Pass via Klook).

## Decisions

### Providers
| Provider | Phase 1 | Phase 2 | Notes |
|---|---|---|---|
| Viator Partner API | Basic access (affiliate): `/products/search`, `/products/{code}`, `/availability/schedules`, deep links with campaign params; header `exp-api-key: $VIATOR_API_KEY`, `Accept-Language: th` where supported | Full access (merchant): `/availability/check`, `/bookings/cart/hold`, `/bookings/cart/book`, cancellations | Global, strong in Thailand; affiliate payouts by commission |
| Klook | Affiliate links/widgets with `KLOOK_AFFILIATE_ID` | Partner API by contract | Strong in Asia (Japan passes, Ba Na Hills, Universal Japan) |
| KKday | Affiliate links with `KKDAY_AFFILIATE_ID`; Partner API (`KKDAY_PARTNER_KEY`) for approved partners | Booking via Partner API | Strong in Taiwan, Japan, Thailand |
Selection per country: TH → Viator, then Klook/KKday; JP/TW/KR/HK → Klook/KKday first, then Viator.

### Matching offers to stops
1. Query = stop `query`/name + city, filtered by distance from `stop.ll` (≤ 10 km; tours with pickup accepted when their destination matches the name variants) and trip date availability.
2. Name gate as for photos (`nameMatches` on title/destination); otherwise the offer is shown as "ทัวร์ใกล้เคียง" only when the organizer expands the list.
3. Rank: available on the trip day, free cancellation, rating, price within the strictest budget share.
4. Price: THB when the API returns THB, else converted with the plan's rate and labelled "≈".

### Auth and keys
All keys in `.env.local`, server only; affiliate ids appear in outbound links by design (they are not secrets), but API keys never reach the browser.

### Request flow
`POST /api/activities { city, country, date, stop }` → provider calls (5 s timeout each, in parallel) → `{ offers: [{ provider, title, priceTHB, priceLocal?, durationMin?, freeCancel?, rating?, reviews?, url, bookable: false|true, productCode }] }`. The place sheet calls it lazily for activity kinds; results are cached per `stop.id|date`.

### Phase 2 booking
Availability check → hold → approval screen (total, cancellation terms, traveller names) → payment via `add-payments` → book → voucher link stored in `stop.booking = { provider, ref, voucherUrl }`. Never automatic.

### Caching
Product search results: memory 6 h per stop/date; product content per provider's terms (Viator allows caching product content with periodic refresh; prices/availability always re-checked before booking).

### Cost and quotas
Affiliate APIs are free with rate limits; revenue is commission. Guards: one search per stop per day; daily cap `BOP_ACTIVITY_DAILY_SEARCHES`.

### Fallback to today's no-key path
No keys, timeouts or no matching offers → nothing new is shown; the stop keeps its web-estimated `cost`, and `details.price`/`details.booking` come from research with sources.

### ToS constraints
- Disclose affiliate links ("Bop อาจได้รับค่าคอมมิชชันจากการจองผ่านลิงก์นี้").
- Show provider names/branding as required; do not rewrite reviews; prices "ราคาอาจเปลี่ยน" until checked.
- Viator full access requires PCI-compliant payment handling via the provider or hosted pages.

## Risks / Trade-offs

- [Wrong match (a different elephant camp)] → strict name/distance gate; expanded list labelled "ใกล้เคียง".
- [Affiliate approval delays] → providers are independent; each turns on with its key.
- [Budget surprises] → offers do not change `cost` until picked.

## Migration Plan

Viator Basic access first (Thailand), then Klook/KKday links; phase 2 only after `add-payments` and partner contracts.

## Open Questions

- Should the planner prefer places with bookable offers when designing (a prompt hint), or stay neutral?
