# operational-state Specification

## Purpose

Describe persistence and recovery for LINE group trips, push quotas and supplier booking mutations. These records do not store a complete itinerary. Reference code at prep `292ba5f` is `server/trips.mjs`, `server/state.mjs`, `server/line.mjs`, and `server/duffel.mjs`. Local LINE lifecycle and disabled-state behavior are exercised by `scripts/test-line.mjs` and `scripts/test-state.mjs`. The [AWS deployment spec](../aws-deployment/spec.md) describes provisioning.

## Requirements

### Requirement: Persistence selection

A configured `BOP_STATE_TABLE` with `BOP_NO_STORE` other than `1` SHALL select DynamoDB with string partition key `record_key`. LINE trip reads SHALL use strongly consistent reads in that mode. With DynamoDB disabled, LINE trip/identity/vote/quota functions SHALL use a JSON file, using `BOP_TRIP_STORE_FILE` or the default `server/.data/trips.json`. Writes use a temporary file with mode 0600 followed by rename. File storage is local to one installation and has no DynamoDB TTL sweeper.

#### Scenario: Disabled booking store differs from the LINE local store

- **WHEN** `BOP_NO_STORE=1` is set even with a table name configured
- **THEN** order audit and persistent idempotency functions issue no DynamoDB calls. Booking claims report `persisted:false`; the LINE store selects its local file. This switch alone does not disable all local LINE persistence.

### Requirement: Compact trip records and retention

A trip SHALL contain the dates, title limited to 200 characters, summary limited to 2,000, and up to 20 projected roster entries with nonempty ID and name (limits of 80 and 120 characters). Only the organizer role is retained. Linked LINE identities/display names and current vote/ballots are kept with the trip. Bop SHALL calculate `expires_at` in Unix seconds from the last trip date at 23:59:59 UTC plus 30 days, falling back to start date plus days minus one if needed.

#### Scenario: Independent lookup records

- **WHEN** a trip is created in DynamoDB
- **THEN** a transaction conditionally creates `TRIP#<uuid>` and `LINK#<code>`. The link expires after 30 minutes. A successful link updates the trip, writes `GROUP#<groupId>` with the trip expiry and removes the link record in a transaction.

#### Scenario: Read after a retention deadline

- **WHEN** the six-character link code has expired but its storage row still exists
- **THEN** link validation rejects it using the stored timestamp. Ordinary trip reads use the presence of the trip record. Production TTL deletion is asynchronous; local files rely on explicit deletion for retained trip records.

### Requirement: Ballot, event and quota storage

The vote SHALL be stored on the trip. A DynamoDB ballot update SHALL target the voter's map entry and condition on the vote ID matching and status being open. The updated item SHALL drive the subsequent check for all members represented or the deadline. LINE webhook deduplication uses `LINE_EVENT#<eventId>` with a one-day TTL and conditional acquisition. Monthly push accounting uses `LINE_QUOTA#YYYY-MM` with a 40-day expiry.

#### Scenario: Two sends near the monthly limit

- **WHEN** two DynamoDB push attempts compete for the last available unit
- **THEN** quota consumption uses a conditional atomic counter increment. A rejected increment suppresses the push. A permitted increment happens before calling LINE; delivery failure does not refund the unit in this implementation.

#### Scenario: Retrying the message that used the last available unit

- **WHEN** the first attempt's delivery status is unknown and the organizer retries the same keyed push within 24 hours
- **THEN** the retry uses its existing reservation even across a UTC month boundary. DynamoDB creates the `LINE_PUSH#<scoped retry key>` receipt and increments the monthly counter in one transaction. Other messages still require their own unit.

### Requirement: Order audit omits passenger manifests

After a successful supplier order Bop SHALL attempt a conditional create of `ORDER#<orderId>`. Audit fields are supplier order ID, booking reference, offer ID, mode, type, total, currency, creation time and optional payment deadline. Default retention is 90 days from record creation and `BOP_STATE_RETENTION_DAYS` overrides it with a minimum of one day. Passenger names, birth dates, contact details and passport data are excluded from the audit record.

#### Scenario: Cancellation audit update

- **WHEN** a cancellation is confirmed and an audit record exists
- **THEN** Bop updates that record with cancellation time. An update requires the record to exist and cannot implicitly create a cancellation-only order record.

### Requirement: Persistent idempotency for external mutations

With persistent state enabled, order creation and cancellation confirmation SHALL claim a UUID-format idempotency key. Bop computes a SHA-256 hash of the serialized operation body and conditionally inserts `IDEMPOTENCY#<key>` as `IN_PROGRESS` with creation time and a one-day TTL. The hash is stored in place of the request body. Disabled persistence skips both key validation and durable replay protection.

#### Scenario: Matching replay

- **WHEN** the same key and request hash refer to a completed operation
- **THEN** Bop returns its saved response without creating another supplier order or confirming cancellation again.

#### Scenario: Key collision or ongoing outcome

- **WHEN** the key already exists with a different request hash
- **THEN** Bop returns `bad_request`. A matching key still `IN_PROGRESS` or marked `UNCERTAIN` returns `rate_limit` to the caller rather than sending a second mutation.

#### Scenario: Failure before contacting the supplier mutation endpoint

- **WHEN** a persisted claim is acquired but validation or price approval fails before the external mutation starts
- **THEN** Bop releases the in-progress claim. Once submission starts, an error triggers an attempt to mark the claim `UNCERTAIN` with a bounded reason. A known success conditionally transitions the claim to `COMPLETE` with its response and completion time.

#### Scenario: Persistence boundary

- **WHEN** two valid identical requests arrive without an active DynamoDB table
- **THEN** both can proceed past acquisition. The local file used by LINE does not provide flight-order audit or idempotency protection.

### Requirement: Complete automatic lodging on a saved trip

When an overnight local trip was saved with automatic lodging and has no chosen hotel, opening its existing link SHALL start a hotel lookup. The itinerary SHALL remain available while the lookup runs. A successful, located recommendation SHALL be reusable at the same link after restart, with the original snapshot retained. Booked lodging, a previously named property, and day trips SHALL keep their existing lodging state.

#### Scenario: An archived trip only identified a neighborhood

- **WHEN** the traveler opens the link in multiple tabs
- **THEN** concurrent requests share the lookup. The itinerary and booking view show the selected hotel, its unbooked status, and the room rate as an estimate when available. The booking view links to the venue source when checked and exposes a separate availability search for the trip dates.

#### Scenario: A lodging lookup is interrupted or cannot confirm a hotel

- **WHEN** the provider fails or the traveler begins editing the trip during the lookup
- **THEN** the current trip and its existing reservations remain available. The traveler can retry, and a late result cannot replace a newer edit.
