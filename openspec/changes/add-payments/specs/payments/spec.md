## ADDED Requirements

### Requirement: Approval before payment
The server SHALL create a charge or checkout session only after the organizer approves an itemised quote (each item's provider, description, THB amount and refund terms, plus the total) on an approval screen by tapping "ยืนยันชำระเงิน".

#### Scenario: Organizer approves
- **WHEN** the organizer approves a quote of a flight and a hotel totalling ฿18,400
- **THEN** one payment for ฿18,400 is created for that quote

#### Scenario: Organizer cancels
- **WHEN** the organizer closes the approval screen
- **THEN** no payment is created

### Requirement: Server-side amounts and idempotency
The server SHALL compute the amount from the stored quote, never from a browser-sent total, and SHALL create at most one payment per quote using an idempotency key.

#### Scenario: Tampered amount
- **WHEN** the browser sends a lower total than the quote
- **THEN** the server charges the quote amount and ignores the browser total

#### Scenario: Double tap
- **WHEN** "ยืนยันชำระเงิน" is sent twice for the same quote
- **THEN** only one payment exists

### Requirement: Hosted payment only
Card details SHALL be entered only on provider-hosted pages, PromptPay SHALL be shown as a provider-generated QR, and no secret or publishable key SHALL be sent to the browser.

#### Scenario: Card payment
- **WHEN** the organizer pays by card
- **THEN** the browser is redirected to the Opn or Stripe hosted page and returns to Bop afterwards

### Requirement: Payment and booking coupling
A booking SHALL be placed only after its payment is authorised or paid; on booking success a card authorisation SHALL be captured, and on booking failure the authorisation SHALL be voided or the PromptPay payment refunded, with the reason shown in Thai.

#### Scenario: Flight order fails after authorisation
- **WHEN** the Duffel order is rejected after the card was authorised
- **THEN** the authorisation is voided and the payment status becomes `voided`

#### Scenario: PromptPay and failed hotel booking
- **WHEN** a hotel booking fails after a PromptPay payment
- **THEN** a refund is created and the status becomes `refunded`

### Requirement: Verified webhooks
Payment status changes SHALL be accepted only from verified webhooks (Stripe signature with `STRIPE_WEBHOOK_SECRET`; Opn by re-fetching the event or charge with the secret key) or from direct API reads.

#### Scenario: Forged webhook
- **WHEN** a webhook claims a payment succeeded but verification fails
- **THEN** the status is unchanged

### Requirement: Test mode first
The payment mode SHALL follow the key prefix (`skey_test_`, `sk_test_` = test), test mode SHALL be labelled "โหมดทดสอบ", and live charges SHALL require live keys plus `BOP_PAYMENTS_LIVE=1`.

#### Scenario: Live key without the switch
- **WHEN** a live key is set but `BOP_PAYMENTS_LIVE` is not 1
- **THEN** payments are disabled and the UI shows provider links instead

### Requirement: Payment keys and records
`OMISE_SECRET_KEY`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` SHALL be read on the server only and never logged; payment records SHALL hold provider references, amounts, method and status but never card numbers or CVC.

#### Scenario: No payment keys
- **WHEN** no payment key is set
- **THEN** no payment UI is shown and bookings stay as provider links or sandbox text
