## 1. Setup

- [ ] 1.1 Create a LiteAPI account; put the sandbox key in `.env.local` as `LITEAPI_KEY`
- [ ] 1.2 Decide payment path (LiteAPI payment SDK vs `add-payments`) and merchant of record

## 2. Provider adapter

- [ ] 2.1 Define the hotel adapter interface (`searchRates`, `prebook`, `book`, `cancel`)
- [ ] 2.2 Implement `server/hotels/liteapi.mjs` with `X-API-Key`, timeouts, breaker, daily cap, 15-minute rate cache, 7-day static data cache
- [ ] 2.3 Pick up to 3 examples (budget fit, rating, distance) and map them to `flags.stay.examples` with `checked: 'live'`

## 3. Planning integration

- [ ] 3.1 When a provider is on, set the skeleton/design hotel `searchCap` to 0 and fill examples from rates after the area is chosen
- [ ] 3.2 Use the live rate for the first hotel stop's cost per person
- [ ] 3.3 Keep the web-search path unchanged as the fallback

## 4. Booking flow

- [ ] 4.1 Endpoints `/api/hotels/rates`, `/api/hotels/prebook`, `/api/hotels/book`, `/api/hotels/cancel`
- [ ] 4.2 Approval screen with total, taxes/fees, policy; store `flags.stay.booking`
- [ ] 4.3 Treat a booked hotel as `stay.mode: 'booked'` in replans
- [ ] 4.4 `BOP_HOTEL_BOOKING` switch and "โหมดทดสอบ" label for sandbox

## 5. Contract and verification

- [ ] 5.1 API.md changelog for the new example fields and endpoints; KEYS.md update
- [ ] 5.2 Sandbox end-to-end: search, prebook, book, cancel; fallback tests with no key and provider errors
- [ ] 5.3 Later: apply to Hotelbeds / Agoda / Booking.com once Bop is a registered business; add their adapters
