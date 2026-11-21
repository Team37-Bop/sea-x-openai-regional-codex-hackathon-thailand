## Context

There is no payment code in Bop today; the sample's cart was removed. Bookings in the planner are reservation calls (phone scripts) and sandbox text. The booking changes (flights, hotels, activities) each require "approval before payment" and a captured payment before a live order.

## Goals / Non-Goals

**Goals:**
- Take payment in THB with PromptPay and cards, test mode first.
- One approval step before any charge; no card data in Bop.
- Clean failure handling between payment and the provider booking.

**Non-Goals:**
- Storing cards for later, subscriptions, wallets inside Bop.
- Accounting/tax invoices beyond a simple Thai receipt (later).
- Splitting the bill automatically between members in phase 1.

## Decisions

### Providers
- Opn Payments (Omise), default for THB: Charges API with a `source` (`promptpay`, mobile banking types) created server-side, or the hosted payment page/Payment Links for cards; `capture: false` for card authorisation where supported; `return_uri` for 3-D Secure and bank redirects. Test keys `skey_test_…`.
- Stripe: Checkout Sessions (hosted) with `payment_method_types` including card and PromptPay where enabled for the account, `payment_intent_data.capture_method: 'manual'` for cards, webhook `checkout.session.completed` / `payment_intent.*`. Test keys `sk_test_…`.
- Selection: `BOP_PAYMENT_PROVIDER=opn|stripe`; default Opn when `OMISE_SECRET_KEY` is set, else Stripe when `STRIPE_SECRET_KEY` is set, else none.
- Alternatives: 2C2P (enterprise onboarding), GB Prime Pay (local, fewer docs), LINE Pay (could pair with `add-line-messaging` later).

### Auth and keys
- `OMISE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in `.env.local` (dev) / host secret store (prod), read in `server/payments/` only, never logged, never sent to the browser.
- No publishable key in the browser: card entry happens on provider-hosted pages; PromptPay QR images come from the server response.

### Request flow
1. A booking flow (flight/hotel/activity) prepares a quote: items `[{ kind, provider, ref, description, amountTHB, refundTerms }]`.
2. Approval screen: itemised total in THB (and original currency when different), refund terms, payer = organizer, test-mode label "โหมดทดสอบ". Organizer taps "ยืนยันชำระเงิน".
3. `POST /api/pay/intent { tripId, quoteId, method }` → server re-validates the quote amounts (never trusts browser totals) → creates the Opn charge/source or Stripe Checkout Session with an idempotency key `trip|quote` → returns a redirect URL or a PromptPay QR and expiry.
4. Webhook (`/api/pay/webhook/opn`, `/api/pay/webhook/stripe`) → verify (Stripe signature; Opn by re-fetching the event/charge with the secret key) → mark `authorized` or `paid`.
5. Booking step runs only when the payment is `authorized`/`paid`:
   - success → capture (cards) → `captured`; receipt.
   - failure → void the authorisation (cards) or refund (PromptPay) → `refunded`; the organizer sees the reason.
6. UI polls `GET /api/pay/:id` until a final state.

### Records
Per payment: `{ id, tripId, quoteId, provider, providerRef, amountTHB, method, status: created|authorized|paid|captured|failed|voided|refunded, items, createdAt, updatedAt }`. No card numbers or CVC ever; only the provider's references and last4 if the provider returns it.

### Caching
Not applicable; quotes expire with their underlying offers (flight offers ~15-30 min, hotel prebook validity).

### Cost and quotas
Per-transaction fees differ by method (PromptPay lower than cards; international cards higher); check Opn and Stripe Thailand price pages. No monthly minimums assumed. Refunds may not return the fee.

### Test mode first
All flows run against test keys with provider test cards and test PromptPay; live keys only after merchant KYC/KYB, a registered business and a legal review of refunds and consumer terms. `BOP_PAYMENTS_LIVE=1` required in addition to live keys.

### Fallback to today's no-key path
No keys → no payment UI; bookings stay as today (phone reservations, provider links, sandbox text). Booking changes that need payment show "ยังจองผ่าน Bop ไม่ได้ เปิดเว็บผู้ให้บริการ" with the provider link.

### ToS constraints
- PCI DSS: card data only on hosted pages (SAQ A scope).
- Thai consumer and e-payment rules: clear price, refund terms before payment; Thai receipts.
- PDPA for payer details.

## Risks / Trade-offs

- [Payment succeeds but booking fails] → authorise-then-capture for cards; automatic refund for PromptPay; idempotency keys.
- [Browser tampering with amounts] → server recomputes from stored quotes.
- [Webhook delays] → polling plus webhook; final state required before booking.

## Migration Plan

Test keys → end-to-end with Duffel test mode and LiteAPI sandbox → merchant onboarding → live behind `BOP_PAYMENTS_LIVE`.

## Open Questions

- Split payments per member (phase 2): payment links per share, or organizer pays and Bop tracks who owes whom?
- Merchant of record per vertical (Bop vs provider-collected, e.g. LiteAPI payment SDK, Duffel Payments).
