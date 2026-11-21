## ADDED Requirements

### Requirement: Live hotel rates
When `LITEAPI_KEY` is set, the server SHALL search hotel rates around the chosen stay area for the trip's check-in and check-out dates with rooms of 2 adults (ceil(members ÷ 2) rooms), currency THB and guest nationality TH, and SHALL return offers with `offerId`, price per room per night in THB, refundability and cancellation deadline.

#### Scenario: Chiang Mai old town
- **WHEN** a 3-day trip for 4 people stays in เมืองเก่า
- **THEN** the server requests 2 rooms for 2 nights around the old town and gets live offers

### Requirement: Prebook and approval
Booking SHALL start with a prebook that re-checks price and policy, and the server SHALL book only after the organizer approves the exact total for all rooms and nights, taxes and fees, and the cancellation policy on an approval screen.

#### Scenario: Price changed at prebook
- **WHEN** the prebook price differs from the shown rate
- **THEN** the approval screen shows the new total before any booking

#### Scenario: No approval
- **WHEN** the organizer leaves the approval screen
- **THEN** no booking is made

### Requirement: Booking record
A successful booking SHALL be stored as `plan.flags.stay.booking = { provider, bookingId, hotel, checkin, checkout, rooms, total, refundableUntil? }`, and the hotel SHALL then be treated like a booked stay in later replans.

#### Scenario: Replan after booking
- **WHEN** the group asks to change areas after booking
- **THEN** the replan keeps the booked hotel unless the organizer cancels it

### Requirement: Hotel cancellation
Cancelling SHALL show the policy and refund first and SHALL cancel with the provider only after the organizer confirms.

#### Scenario: Past free-cancellation deadline
- **WHEN** the organizer cancels after the free-cancellation deadline
- **THEN** the UI shows the penalty before confirming

### Requirement: Sandbox first and provider adapters
The hotel provider SHALL sit behind an adapter (`searchRates`, `prebook`, `book`, `cancel`); LiteAPI sandbox (`sand_` key) SHALL be used first with "โหมดทดสอบ" shown, live booking SHALL stay disabled until `BOP_HOTEL_BOOKING=1`, and Hotelbeds, Agoda and Booking.com adapters SHALL be enabled only when their partner keys exist.

#### Scenario: Sandbox key
- **WHEN** `LITEAPI_KEY` starts with `sand_`
- **THEN** the bookings tab labels hotel booking "โหมดทดสอบ"

### Requirement: Hotel key handling
Hotel provider keys SHALL be read from `.env.local` on the server only, never logged and never sent to the browser; guest personal data SHALL never be sent to the model.

#### Scenario: Payment SDK
- **WHEN** the LiteAPI payment SDK is used in the browser
- **THEN** it receives only the per-transaction secret from prebook, not the API key
