## ADDED Requirements

### Requirement: Group linking
The organizer SHALL link a trip to a LINE group by adding the Bop official account to the group and sending a one-time 6-character code, and the server SHALL store the `groupId` with the trip and reply "เชื่อมทริป … แล้ว".

#### Scenario: Valid code
- **WHEN** the code is typed in a group where Bop is a member
- **THEN** the trip is linked to that group and the code is invalidated

#### Scenario: Expired code
- **WHEN** a code older than 30 minutes is typed
- **THEN** Bop replies that the code expired and nothing is linked

### Requirement: Outbound plan and replan messages
For a linked trip the server SHALL post the plan summary after planning, a Flex vote card when a replan needs a vote, the result after a vote, reservation tasks and enabled alerts, using the reply API when a reply token is available and the push API otherwise; every message SHALL be signed "Bop".

#### Scenario: Replan without a vote
- **WHEN** a replan is applied without a vote
- **THEN** the option's `line` text is posted to the group

### Requirement: Votes from LINE
Vote cards SHALL carry one postback button per option; the webhook SHALL record one ballot per LINE user (the last one counts), map it to a trip member, and the vote SHALL close when every member voted, the deadline passes or the organizer chooses.

#### Scenario: Member votes
- **WHEN** ปาล์ม taps "โหวต B"
- **THEN** the ballot is stored for member palm and the in-app card shows ปาล์ม's vote

#### Scenario: Tie
- **WHEN** the vote closes 2-2
- **THEN** the organizer decides, as in the in-app vote

### Requirement: Webhook security
The webhook SHALL verify `x-line-signature` (HMAC-SHA256 of the raw body with `LINE_CHANNEL_SECRET`) before handling any event and SHALL reject unsigned or mismatched requests.

#### Scenario: Forged postback
- **WHEN** a request arrives with an invalid signature
- **THEN** the server answers 401 and records no vote

### Requirement: LIFF identity
The LIFF page SHALL verify the member's LINE ID token on the server and let the member pick "ฉันคือ…" once per trip; only the LIFF ID SHALL be exposed to the browser, never the channel token or secrets.

#### Scenario: Member opens Bop in LINE
- **WHEN** a member opens the LIFF link from the group
- **THEN** after picking their name, their later votes map to that member

### Requirement: LINE keys and quotas
`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` and `LINE_LOGIN_CHANNEL_ID` SHALL be loaded only by server-side code, from ignored `.env.local` in local development or from the KMS-encrypted runtime Secrets Manager document in AWS. Terraform SHALL create no secret version. Push messages SHALL stop at `BOP_LINE_MONTHLY_CAP`, after which the UI SHALL offer "คัดลอกข้อความ" instead.

#### Scenario: AWS runtime starts
- **WHEN** Lambda starts with `BOP_RUNTIME_SECRET_ID`
- **THEN** it loads only allowlisted LINE fields from Secrets Manager and exposes none of them through `/api/config`

#### Scenario: No LINE keys
- **WHEN** the LINE keys are absent
- **THEN** the in-app vote and LINE-style preview work as today and no LINE call is made

### Requirement: LINE data retention
LINE user ids, display names and ballots SHALL be stored only with the trip and deleted 30 days after the trip ends or on request.

#### Scenario: Trip over
- **WHEN** 30 days pass after the last trip day
- **THEN** the trip's LINE data is deleted
