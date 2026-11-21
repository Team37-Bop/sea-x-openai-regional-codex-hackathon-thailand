# flight-booking Specification

## Purpose

Use Duffel to turn a dated group flight search into a priced offer, an explicitly confirmed booking, and an optional cancellation. Source paths in prep `292ba5f` are `server/duffel.mjs`, `server/api.mjs`, `server/state.mjs`, `src/main.js` (flight booking panel) and `scripts/test-duffel.mjs`. The executable tests use a mock Duffel server. Airline coverage, account verification and live sales are deployment concerns. Payment in this contract is against the supplier balance. Customer payment collection is a separate proposal.

## Requirements

### Requirement: Modes and public capability reporting

Bop SHALL keep `DUFFEL_ACCESS_TOKEN` on the server. A token beginning with `duffel_test_` enables test searches and bookings. A `duffel_live_` token enables live search and refresh. Live order creation and cancellation also require `BOP_FLIGHT_BOOKING=1`. `GET /api/health` exposes `flights: null` when disabled, otherwise `flights: {mode, booking}`. Flight offer, order and cancel routes SHALL accept JSON, return NDJSON, and run independently of model availability.

#### Scenario: Live search with order creation disabled

- **WHEN** a live token is configured and the live booking flag is unset
- **THEN** the search can return inventory with an offer ID, the refresh result has `bookable: false`, and order/cancel terminates with `not_enabled`. An option's supplier-level `bookable` field alone does not enable confirmation.

### Requirement: One-way inventory for the actual group

Search SHALL resolve the home and destination IATA codes from a three-letter code, a code within the text, the destination airport hint, the Bangkok alias, or Duffel place suggestions. It SHALL search one economy slice, one adult per traveler (at least one), and allow at most one connection. Outbound uses the start date. Return reverses the airports and uses start date plus days minus one.

#### Scenario: Missing, identical or unsupported airport pair

- **WHEN** either code cannot be resolved or the origin equals the destination
- **THEN** Duffel contributes no options and the transport picker can fall back to web estimates.

#### Scenario: Multi-person return

- **WHEN** two members travel for three days starting 20 November from DMK to CNX
- **THEN** the return supplier request searches CNX to DMK on 22 November for two adults.

### Requirement: Offer selection, source and price units

Bop SHALL inspect at most 60 valid single-slice offers, group duplicates by flight code and departure time, and retain the cheapest converted fare per duplicate. It SHALL return up to five distinct offers, selecting best fit, cheapest, fastest, then filling by fit score. The score accounts for arrival by late morning or return departure around 18:00–22:00, fare and connections. Exactly the first returned live offer is recommended.

#### Scenario: Amounts for comparing offers

- **WHEN** a USD 160 group offer covers two passengers
- **THEN** `priceLocal` is USD 80 per person and `price` is the rounded THB equivalent per person. THB fares need no conversion. Other currencies use Frankfurter rates cached for 12 hours, then a fixed fallback table, or null THB if unknown.

#### Scenario: Offer identity

- **WHEN** a single-slice offer with segments is accepted
- **THEN** its option includes a `go-dN` or `back-dN` ID, `checked: live`, `src.title: Duffel`, `offerId`, `expiresAt`, `bookable: true`, carrier, first flight code, endpoints, local departure/arrival times, connections, duration, bag and conditions text. A test token adds `test: true`.

#### Scenario: Quota and provider outages

- **WHEN** search reaches the per-process UTC daily cap (`BOP_DUFFEL_DAILY_SEARCHES`, default 200), two counted failures occur, or Duffel returns 429
- **THEN** the affected lookup returns no live options. Two counted failures or one 429 open a ten-minute provider circuit. A successful provider response resets the failure count.

### Requirement: Refresh the offer before taking passenger details

`POST /api/flights/offer` SHALL accept `{offerId}`, require an `off_` identifier with an alphanumeric suffix and fetch current services. A successful event carries `mode`, the deployment's `bookable` flag, `offer`, and baggage `services`. Group totals and service amounts use `{amount, currency, thb}`. The offer includes expiry, first departure and last arrival, supplier passenger IDs, identity-document requirement, bag/conditions text, instant-payment requirement and optional pay-by time.

#### Scenario: Bags and holds

- **WHEN** Duffel returns a checkable bag, quantity limit, passenger restrictions and an offer permitting a hold
- **THEN** Bop exposes the bag's service ID, price, maximum quantity, eligible passenger IDs and available weight information, sets `instantOnly: false`, and exposes the payment deadline.

#### Scenario: Expired supplier offer

- **WHEN** refresh receives a supplier code for an expired or unavailable offer
- **THEN** the terminal event has `code: offer_expired` and the organizer must select a fresh offer to continue.

### Requirement: Validate the passenger manifest and approved group total

`POST /api/flights/order` SHALL refresh the offer again and check the number of passenger rows against the refreshed IDs. Each row must reference an offered passenger and supply a supported title, Latin-script given and family names of 1–40 characters, a date-shaped birth date, supported gender, email and international phone (8–15 digits after the plus). The server SHALL strip spaces and hyphens from phones and reject a route that requires passport document details. It SHALL total accepted bag quantities against the refreshed price, ignoring unknown service IDs and capping positive quantities at the supplier maximum.

#### Scenario: Price changed before confirmation

- **WHEN** the refreshed fare plus selected bags is USD 180 and the organizer approved USD 160
- **THEN** Bop returns `price_changed` with the new group `total` and sends no supplier order. A changed currency also requires another confirmation.

#### Scenario: Documents required

- **WHEN** the refreshed offer requires passport document data
- **THEN** Bop returns `bad_request` and the organizer can choose another flight.

### Requirement: Distinguish instant orders from holds

The web panel SHALL require a review/confirm action before order submission, show test mode, and supply a per-operation idempotency key. On approval Bop SHALL create one supplier order for the selected offer. An instant order uses the approved fare currency and group total as a Duffel balance payment, with selected bag services. A hold requires an offer permitting delayed payment and sends neither a payment nor ancillary services. A hold request on an instant-only offer follows the instant-order branch.

#### Scenario: Successful booking

- **WHEN** the supplier creates the order
- **THEN** the terminal `order` includes `orderId`, `bookingReference`, `offerId`, test/live mode, order type, supplier total, currency, `totalTHB`, creation time and optional `payBy`. The web panel clears its passenger rows and keeps the order with the chosen direction.

### Requirement: Cancellation requires a quote and explicit confirmation

`POST /api/flights/cancel` SHALL accept an `ord_` order ID. A request with just the order ID obtains a cancellation quote. A confirmation must identify the `ore_` quote and is subject to the same mutation gate and persistent idempotency policy as order creation.

#### Scenario: Quote only

- **WHEN** the organizer opens cancellation
- **THEN** Bop returns `quote.cancellationId`, the refund amount/currency and THB conversion when given, refund destination, and expiry. The UI offers confirm and keep-booking actions.

#### Scenario: Confirm quote

- **WHEN** the organizer confirms the quote and the supplier accepts it
- **THEN** Bop returns `cancelled.orderId`, `confirmedAt` and the supplier's refund or null, and the UI marks the booking cancelled.

### Requirement: External order outcomes and retry behavior

Bop SHALL attempt a supplier mutation once per acquired operation and avoid automatically retrying it. When persistent storage is enabled, it SHALL distinguish a failed preflight validation, a definitively completed response, and an uncertain external outcome as specified in [operational state](../operational-state/spec.md).

#### Scenario: Supplier success followed by an audit failure

- **WHEN** Duffel returns a successful order but Bop cannot persist the audit or completed operation
- **THEN** Bop still returns the supplier confirmation and attempts to mark the persisted claim uncertain for later reconciliation.
