## 1. Partners

- [ ] 1.1 Apply for Viator Partner API Basic access, Klook affiliate and KKday affiliate/partner; record terms
- [ ] 1.2 Put `VIATOR_API_KEY`, `VIATOR_PARTNER_ID`, `KLOOK_AFFILIATE_ID`, `KKDAY_PARTNER_KEY`, `KKDAY_AFFILIATE_ID` in `.env.local`

## 2. Server

- [ ] 2.1 Provider modules with timeouts, caps and per-provider caching rules
- [ ] 2.2 Matching (name variants + distance + trip-date availability) and ranking
- [ ] 2.3 `POST /api/activities` with THB conversion and "≈" flag

## 3. UI

- [ ] 3.1 Offers block in `src/ui/place.js` with disclosure, "ราคาอาจเปลี่ยน" and "ทัวร์ใกล้เคียง"
- [ ] 3.2 Pick offer → confirm → update `stop.cost` and rerun checks

## 4. Phase 2

- [ ] 4.1 Viator full access: availability check, hold, approval, payment via `add-payments`, book, voucher in `stop.booking`

## 5. Contract and verification

- [ ] 5.1 API.md changelog; KEYS.md row
- [ ] 5.2 Recorded-response tests: match, mismatch, no availability, no keys
