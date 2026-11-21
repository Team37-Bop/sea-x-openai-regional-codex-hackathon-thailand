## 1. Accounts

- [ ] 1.1 Opn Payments test account; put `OMISE_SECRET_KEY` (`skey_test_…`) in `.env.local`
- [ ] 1.2 Stripe test account (Thailand); `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- [ ] 1.3 Legal: refunds, consumer terms, receipts, PDPA; merchant of record per vertical

## 2. Server

- [ ] 2.1 Payment adapter interface and `server/payments/opn.mjs`, `server/payments/stripe.mjs`
- [ ] 2.2 Quote store and `POST /api/pay/intent` with server-side amounts and idempotency keys
- [ ] 2.3 Webhooks with verification; `GET /api/pay/:id`
- [ ] 2.4 Capture / void / refund hooks used by the booking flows
- [ ] 2.5 Payment records (no card data) in the trip store

## 3. UI

- [ ] 3.1 Approval screen with itemised THB total, refund terms and "โหมดทดสอบ"
- [ ] 3.2 Redirect to hosted pages; PromptPay QR with expiry; status polling and Thai receipts

## 4. Integration and verification

- [ ] 4.1 Wire to Duffel test orders and LiteAPI sandbox bookings
- [ ] 4.2 Tests: approve, cancel, double tap, tampered amount, booking failure → void/refund, forged webhook
- [ ] 4.3 API.md changelog; KEYS.md row; `BOP_PAYMENTS_LIVE` switch documented
