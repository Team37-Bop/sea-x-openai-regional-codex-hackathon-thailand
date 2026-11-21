## Why

Flights (`add-flight-booking-duffel`), hotels (`add-hotel-booking`) and activities (`add-activity-booking`) can only be booked for real once Bop can take payment, and the earlier sandbox cart was removed ("Payments: None (cart removed)" in KEYS.md). Thai groups pay with PromptPay, cards and mobile banking; Opn Payments (Omise) is the local gateway and Stripe is the international alternative. Both have full test modes.

## What Changes

- A payment layer with two adapters: Opn Payments (default for THB: PromptPay, cards, mobile banking) and Stripe (cards, PromptPay where available, other currencies), in test mode first.
- Every payment follows one approval step: the organizer sees the itemised total (what, provider, THB amount, refund terms) and taps "ยืนยันชำระเงิน"; nothing is charged before that.
- Card data is collected only on provider-hosted pages or provider-hosted QR (no card fields in Bop, no publishable key needed in the browser); the server creates charges/sessions with secret keys.
- Authorise-then-capture for cards where supported: authorise, place the booking, capture on success, void on failure. PromptPay is pay-first with automatic refund if the booking fails.
- Payment records and statuses per trip; receipts in Thai.
- Phase 2: split payment links per member.

## Capabilities

### New Capabilities
- `payments`: approval, hosted payment, authorise/capture/refund, webhooks, test/live modes, records, keys.

### Modified Capabilities
<!-- none of the baseline specs change; booking changes depend on this capability -->

## Impact

- Code: new `server/payments/{opn,stripe}.mjs`, endpoints `POST /api/pay/intent`, `GET /api/pay/:id`, webhook `POST /api/pay/webhook/:provider`; payment records in the trip store (introduced by `add-line-messaging`, or its own file); approval screen and status UI in `src/main.js`; API.md changelog.
- Keys: `OMISE_SECRET_KEY` (`skey_test_…` / `skey_…`), `STRIPE_SECRET_KEY` (`sk_test_…` / `sk_live_…`), `STRIPE_WEBHOOK_SECRET`; `.env.local` (dev) or host secrets (prod), server only.
- Business: live mode needs merchant KYC/KYB with Opn or Stripe Thailand, a registered business and bank account.
- No-key fallback: today's behaviour (no payments; bookings are links to providers or sandbox text; prices shown as estimates).
