## ADDED Requirements

### Requirement: Offer refresh before booking
Before any booking step the server SHALL refresh the selected Duffel offer (`GET /air/offers/{id}` with available services) and SHALL show the organizer the new total when the price or availability changed.

#### Scenario: Price went up
- **WHEN** the refreshed total is higher than the shown price
- **THEN** the UI shows the new total and asks for approval again

#### Scenario: Offer expired
- **WHEN** the offer is past `expiresAt`
- **THEN** the server runs a new offer request and the organizer picks again

### Requirement: Seats and baggage
The booking flow SHALL offer seat selection from Duffel seat maps and bag services from the offer's available services per passenger, and SHALL include chosen services with their prices in the approval total.

#### Scenario: Extra bag
- **WHEN** a member adds one 20 kg bag
- **THEN** the order includes that service and the total includes its price

### Requirement: Passenger details and privacy
The booking flow SHALL collect the passenger fields Duffel requires (title, given and family name, birth date, gender, email, phone, and identity documents when the offer requires them) and SHALL keep them server-side only for the order, never sending them to the model or writing them to logs.

#### Scenario: Passport required
- **WHEN** the offer has `passenger_identity_documents_required: true`
- **THEN** the form asks for passport number, issuing country and expiry for each passenger

#### Scenario: Replan after booking
- **WHEN** the plan is replanned after an order exists
- **THEN** the replan prompt contains the booking reference and times but no passenger personal data

### Requirement: Approval before ordering
The server SHALL create a Duffel order only after the organizer explicitly approves the exact total (THB and original currency), the fare conditions and the hold or pay-now choice on an approval screen, and SHALL never create or retry an order automatically.

#### Scenario: Organizer approves
- **WHEN** the organizer taps "ยืนยันจอง"
- **THEN** one `POST /air/orders` is sent and the booking reference is stored in `plan.flags.transport.<dir>.order`

#### Scenario: Order fails
- **WHEN** Duffel rejects the order
- **THEN** no retry is made and the organizer sees the reason in Thai with a fresh search option

### Requirement: Payment before a live order
In live mode an instant order SHALL be sent only after the payment for it is captured through `add-payments`; a hold order SHALL show its `payment_required_by` deadline.

#### Scenario: Hold available
- **WHEN** the offer does not require instant payment
- **THEN** the organizer may hold it and sees the pay-by time

### Requirement: Cancellation
Cancelling SHALL first request a Duffel order cancellation quote, show the refund amount and conditions, and confirm only after the organizer approves.

#### Scenario: Non-refundable fare
- **WHEN** the quote shows a refund of 0
- **THEN** the UI says so before the organizer confirms

### Requirement: Test mode first
The mode SHALL follow the `DUFFEL_ACCESS_TOKEN` prefix; test mode SHALL be labelled "โหมดทดสอบ" in the UI, and live booking SHALL stay disabled until Duffel organisation verification, a payment setup and `BOP_FLIGHT_BOOKING=1` are in place.

#### Scenario: Test token
- **WHEN** the token starts with `duffel_test_`
- **THEN** every booking screen shows "โหมดทดสอบ" and no real ticket is issued

### Requirement: Duffel key handling
`DUFFEL_ACCESS_TOKEN`, `DUFFEL_WEBHOOK_SECRET` and `SERPAPI_KEY` SHALL be read from `.env.local` on the server only, never logged and never sent to the browser; Duffel webhooks SHALL be accepted only with a valid signature.

#### Scenario: Unsigned webhook
- **WHEN** a webhook arrives with a wrong signature
- **THEN** it is rejected with 401 and ignored
