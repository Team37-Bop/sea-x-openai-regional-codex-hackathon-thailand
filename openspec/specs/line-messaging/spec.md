# line-messaging Specification

## Purpose

Connect a planner session to a LINE group, send summaries, and collect real group votes. Source paths in prep `292ba5f` are `server/api.mjs`, `server/line.mjs`, `server/trips.mjs`, `src/main.js`, `src/liff.js`, `src/ui/api.js` and `scripts/test-line.mjs`. The regression suite uses a local trip store and simulated LINE responses. A deployed installation needs its own configured channel, active webhook and, for LIFF, a Login channel and LIFF app.

## Requirements

### Requirement: Public configuration and HTTP contracts

`GET /api/config` SHALL return only `{enabled, liffId}`. Both the server-side channel access token and channel secret are required for `enabled`. Missing LIFF configuration yields null. Trip routes SHALL use ordinary JSON requests and responses, independently of the planner's NDJSON model routes. Trip POST requests with an incompatible media type receive HTTP 415. Domain errors map to HTTP 400 (`bad_request`), 401 (`auth`), 429 (`rate_limit`), 503 (`no_key`) or 502 (other provider/storage failures).

#### Scenario: Channels not configured

- **WHEN** the server is missing the Messaging API token or secret
- **THEN** public config reports `enabled: false` and `POST /api/trips` returns `no_key`. No outbound LINE request is needed to discover the capability.

### Requirement: Organizer creates a trip and authorizes subsequent actions

`POST /api/trips` SHALL accept `{setup, summary}` and return the trip view plus `organizerToken`, `linkCode` and `codeExpiresAt`. The trip ID is a UUID, the organizer credential is generated from 32 random bytes, and the link code has six uppercase letters/digits from an alphabet excluding visually ambiguous characters. The server SHALL store the credential hash and require the original value in `x-bop-trip-token` for organizer reads, deletion, plan/post updates, vote creation, vote reads and closure.

#### Scenario: Organizer reads trip state

- **WHEN** `GET /api/trips/{tripId}` is called with the correct token
- **THEN** it returns `tripId`, `title`, `summary`, `members`, `linked`, `linkedAt`, `expiresAt` and the current vote or null. Member entries expose id, name, optional organizer role and whether linked. The group ID, raw LINE user IDs, token hash and link code stay out of this view.

#### Scenario: Missing or incorrect organizer token

- **WHEN** an organizer operation addresses an unknown trip or presents an incorrect token
- **THEN** the result is `auth` with HTTP 401.

### Requirement: Verify webhook authenticity and process redeliveries

`POST /api/line/webhook` SHALL check the base64 HMAC-SHA256 signature in `x-line-signature` against the unmodified request bytes using the channel secret. Verification precedes JSON parsing and event processing. A known webhook event ID SHALL suppress duplicate delivery; a failed event handler releases its claim to permit a later retry. Events without an ID cannot be deduplicated by ID.

#### Scenario: Invalid request

- **WHEN** a webhook has an invalid signature
- **THEN** Bop returns HTTP 401 with `invalid_signature`. A valid signature over malformed JSON instead yields HTTP 400 with `invalid_json`.

#### Scenario: LINE verifies the webhook

- **WHEN** the signed body contains an empty events list
- **THEN** Bop returns HTTP 200 with `{ok:true}`.

#### Scenario: Event handler fails after claiming its ID

- **WHEN** a signed event encounters a processing error
- **THEN** Bop attempts to release the claim and send a Thai error using the event's reply token if available. It continues processing the batch and acknowledges the handled envelope.

### Requirement: Link and unlink a group

Bop SHALL reply to a group join with instructions for sending the link code, accept a trimmed case-insensitive six-character group text matching the alphabet, and verify the lookup and its 30-minute expiry. A successful link writes the group-to-trip mapping, removes the link lookup and pending code, and replies with the trip title and any plan summary. Unrelated text SHALL be ignored. A leave event removes the group association; a member-joined event can reply with LIFF identity instructions.

#### Scenario: Organizer watches the link

- **WHEN** a code is shown and has not expired
- **THEN** the planner polls trip state about every five seconds until linked or expired. Sending a valid code in the group changes the organizer view to linked; an expired or previously consumed lookup cannot link another group in a later request.

### Requirement: Distinguish reply, push and quota

`POST /api/trips/{id}/plan` SHALL save the summary, then attempt a push for a linked group when a summary is supplied. `POST /api/trips/{id}/post` SHALL reject blank text or an unlinked trip and otherwise push a message prefixed with `Bop:` once. The server SHALL limit outbound text to 5,000 characters and each reply or push to five messages. A push first consumes one unit of the shared UTC monthly quota (`BOP_LINE_MONTHLY_CAP`, default 200). Replies use LINE reply tokens separately.

#### Scenario: Monthly allowance exhausted

- **WHEN** the trip is linked but the monthly push allowance has been consumed
- **THEN** manual post and vote-start respond with `posted:false` and `quotaReached:true`, skip the supplier push, and retain any newly created vote. A plan update still returns its saved summary with `posted:false`.

### Requirement: Send the applied change to the group

The applied replan card SHALL display the selected option's exact group-facing text with line breaks. A linked trip SHALL send it once when an ordinary change is applied. A preview, re-render, undo or a result selected by a LINE vote SHALL not trigger a duplicate automatic post. The same group link SHALL follow a changed trip duration. The result card SHALL distinguish a pending request, a LINE-accepted post, an unlinked group, an unavailable channel, an exhausted quota and an unconfirmed delivery.

#### Scenario: Apply an ordinary change
- **WHEN** Bop applies a restaurant change for a trip linked to LINE
- **THEN** the result card displays the message sent to the authenticated trip endpoint and confirms submission only after LINE accepts it. During LINE's 24-hour retry window, a retry after an uncertain response reuses the same key and monthly quota reservation for this message and group. After the window closes the organizer is asked to check the group.

#### Scenario: Review a vote or an unlinked trip
- **WHEN** a LINE vote selects an option
- **THEN** the result card displays the selected summary and allows the organizer to send that summary separately. An unlinked trip displays the proposed text and, when the service is configured, offers access to group linking.

### Requirement: Open a vote and publish the choices

`POST /api/trips/{id}/vote` SHALL require a linked trip and at least one option. It stores a new current vote with a UUID, status `OPEN`, capped reason (500 characters), up to three compact options, empty ballots, creation time and deadline. Deadline defaults to 120 minutes and is clamped to 5–1,440 minutes. The group receives a Flex carousel with each option's key, title, optional head and vote postback. An optional LIFF button deep-links to this trip. The result includes the vote and delivery state.

#### Scenario: Group taps a Flex button

- **WHEN** a signed group postback provides the group's active vote ID, a valid option and a LINE user ID
- **THEN** Bop resolves the group-to-trip mapping, attempts a display name lookup and records the ballot. If profile lookup fails it uses a generic LINE member label. It replies with a Thai acknowledgement or final result.

#### Scenario: The planner asks the linked group to decide

- **WHEN** a replan returns choices requiring a decision for a linked trip
- **THEN** the planner starts one LINE vote for that decision, shows accepted delivery, the names and choices of recorded voters, and the roster members still pending. The organizer may close an open or tied ballot by choosing an option. An unconfirmed or quota-limited card leaves local choice and local ballots available.

#### Scenario: The organizer sends pending reservation work

- **WHEN** the organizer chooses to send booking tasks to the linked group
- **THEN** the message identifies the organizer and lists outstanding calls, reschedules and cancellations with their dates and times. Confirmed and handled work is omitted. With no pending tasks the organizer sees that the list is empty and no message is sent.

### Requirement: Identify LIFF participants and protect member mappings

The LIFF page SHALL require a trip ID, an enabled server config and a public LIFF app ID. It initiates login if necessary, obtains an ID token from the SDK and sends it to the Bop backend. The server SHALL verify the token with LINE using `LINE_LOGIN_CHANNEL_ID` or legacy `LINE_CHANNEL_ID` as client ID. A successful verification uses the returned subject as identity and the verified display name when present.

#### Scenario: Participant claims a roster entry

- **WHEN** the LIFF page posts `{idToken}` to `/api/trips/{id}/identity`
- **THEN** it receives a trip view plus `identity.displayName` and the current member ID or null. Posting a valid `memberId` links the identity. Requesting a second different member ID or claiming a member linked to another LINE account fails with `bad_request`.

#### Scenario: LIFF voting

- **WHEN** a linked participant chooses an option on the LIFF page
- **THEN** the page posts `{idToken,voteId,option}` to `/api/trips/{id}/vote/ballot`. The backend re-verifies the ID token, and the UI refreshes linked participant state about every five seconds while idle.

### Requirement: Count ballots and close voting

Votes SHALL use one storage entry per LINE user ID so changing an open ballot replaces the earlier choice. Member matching prefers a bound LINE identity, then a normalized display-name match; an unmatched ballot carries a null member ID. Public ballot keys correspond to member IDs or generated anonymous labels. The tally counts stored ballots, while the all-members-voted check counts distinct matched roster IDs. Votes from webhook and LIFF share the same vote and ballot logic.

#### Scenario: Unanimous participation or deadline

- **WHEN** every roster member is represented, or an organizer reads an open vote after its deadline
- **THEN** a unique highest count produces `CLOSED` with a winner. A tie or zero ballots produces `TIE` with no winner. Deadline evaluation runs on vote reads or submissions. On submission the current implementation records the ballot before testing the deadline.

#### Scenario: Organizer settles a tie

- **WHEN** the organizer posts `{option}` naming an existing choice to `/api/trips/{id}/vote/close`
- **THEN** the selected option wins an unresolved ballot and the group result is pushed subject to quota. The planner polls `GET /api/trips/{id}/vote` about every three seconds during an active voting card and applies the matching option on a closed result.

#### Scenario: Already closed vote

- **WHEN** another ballot names the same vote and an existing choice after it has left `OPEN`
- **THEN** the existing vote is returned without changing stored ballots. A mismatched vote ID or nonexistent choice returns `bad_request`.

### Requirement: Organizer deletion

`DELETE /api/trips/{id}` SHALL require the organizer token and remove the trip record and any current group or outstanding code lookup. The response is `{deleted:true}`. The reference storage's retention timestamps and local fallback are detailed in [operational state](../operational-state/spec.md).

#### Scenario: Delete before group linking

- **WHEN** the organizer deletes a trip which still has a pending code
- **THEN** later organizer reads fail authentication and the code can no longer resolve the deleted trip.
