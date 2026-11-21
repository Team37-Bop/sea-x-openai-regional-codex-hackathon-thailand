## ADDED Requirements

### Requirement: Flight status endpoint
The server SHALL provide `POST /api/flight-status` that accepts `{ setup, plan }`, looks up each chosen flight that has a flight code by code and travel date, and returns `flights` (status with scheduled, revised and actual times) and `events`.

#### Scenario: On-time flight
- **WHEN** the outbound flight's revised arrival equals its schedule
- **THEN** `events` is empty

#### Scenario: Bus direction
- **WHEN** the chosen return option is a bus without a flight code
- **THEN** it is skipped

### Requirement: Delay and cancellation detection
The server SHALL emit an event when a chosen flight's arrival or departure moves by 30 minutes or more (`kind: 'delay'` with minutes and new times), or its status is cancelled (`cancel`) or diverted (`divert`).

#### Scenario: 90-minute delay
- **WHEN** FD3433 is scheduled to arrive 09:15 and the revised arrival is 10:45
- **THEN** the event is `{ dir: 'go', kind: 'delay', minutes: 90, newArr: '10:45' }`

#### Scenario: Cancellation
- **WHEN** the provider reports the return flight as cancelled
- **THEN** a `cancel` event is returned for `back`

### Requirement: Polling window
The UI SHALL poll only between 24 h before departure and 1 h after arrival of each chosen flight, every 30 min until 6 h before departure and every 10 min after that, and SHALL stop after landing.

#### Scenario: Trip next week
- **WHEN** the planner is opened 5 days before the flight
- **THEN** no flight-status request is made

### Requirement: Provider selection and keys
The server SHALL use AeroDataBox when `AERODATABOX_API_KEY` is set, else FlightAware AeroAPI when `FLIGHTAWARE_API_KEY` is set, else no provider; keys SHALL live in `.env.local`, be used server-side only and never reach the browser.

#### Scenario: No key
- **WHEN** neither key is set
- **THEN** the endpoint answers `{ flights: [], events: [], reason: 'unavailable' }` and makes no external call

### Requirement: Status cache and caps
Status SHALL be cached in memory per `code|date` for 5 min within 6 h of departure and 10 min otherwise, shared across clients, with a daily call cap and a 10-minute breaker after HTTP 429 or 5xx.

#### Scenario: Two tabs open
- **WHEN** two browsers poll the same flight within 5 minutes
- **THEN** only one provider call is made

### Requirement: Flight data attribution
Times from the provider SHALL be labelled with their source in the alert.

#### Scenario: FlightAware data
- **WHEN** the alert uses FlightAware data
- **THEN** it shows "ข้อมูลเที่ยวบิน: FlightAware"
