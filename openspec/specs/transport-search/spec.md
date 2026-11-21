# transport-search Specification

## Purpose
`POST /api/transport-options` finds flights, buses or trains to or from the destination for one direction, from the web only (no fare API), so the group can pick one before or after planning. The same search runs inside `/api/plan` when a direction has no time. Code: `runTransport`/`searchTransport`/`normalizeTransport` in `server/agent.mjs`, `transport` in `server/claude.mjs` and `server/cli-llm.mjs`.

## Requirements

### Requirement: Transport options request
The endpoint SHALL accept `{ setup, dir: 'go'|'back' }` and SHALL end with `bad_request` when `dir` is invalid, the direction is missing, or the direction is `drive`.

#### Scenario: Drive direction
- **WHEN** `dir` is `go` and `arrive.by` is `drive`
- **THEN** the stream ends with `bad_request`

### Requirement: Web search on the fast model
The search SHALL run on the fast model at low effort with at most 4 web searches, localised to the destination country, and SHALL stream a step naming the mode, route and date (e.g. "ค้นเที่ยวบิน DMK → เชียงใหม่ ศ. 20 พ.ย.") plus each query.

#### Scenario: Undecided direction
- **WHEN** `by` is undecided
- **THEN** the prompt asks the model to compare flight, train and bus and pick the best

### Requirement: Option shape
The `done` event SHALL carry 0-5 options `{ id: 'go-1'…, by, carrier, code?, from, to, dep, arr, price, bag?, src: { url, title }, checked, recommended?, why? }`, where `price` is a web-estimated THB per person or `null`, `checked` is `web` only if `src.url` was really returned by the search, and options without a carrier or valid times are dropped.

#### Scenario: Unverified option
- **WHEN** the model cites a URL that no search returned
- **THEN** the option keeps its data with `checked: 'estimate'` and `src.url: ''`

#### Scenario: Prices are estimates
- **WHEN** the UI shows a price from this endpoint
- **THEN** it is a web estimate with no live fare or seat availability, and booking is not possible

### Requirement: Exactly one recommendation
Exactly one option SHALL be `recommended` (the model's choice, else the first), and it SHALL have a `why`, defaulting to "ราคาเป็นค่าประมาณจากเว็บ".

#### Scenario: Model marks none
- **WHEN** no option is marked recommended
- **THEN** the first option becomes recommended

#### Scenario: Summary step
- **WHEN** options are found
- **THEN** the step "พบ N ตัวเลือก · แนะนำ <carrier> <code> <dep>–<arr>" is emitted; with none, "ไม่พบตัวเลือกที่เชื่อถือได้"

### Requirement: Picking and changing an option
A picked option SHALL be passed back unchanged as `arrive.choice`/`depart.choice` and used without a search; "เปลี่ยนเที่ยวบิน" in the bookings tab SHALL list the other options and send a replan command that names the new carrier, code and times.

#### Scenario: Change flight from the bookings tab
- **WHEN** the organizer picks another flight
- **THEN** the UI updates the setup choice and sends `/api/replan` with a command like "เปลี่ยนเที่ยวบินขาไปเป็น Nok Air DD8302 ออก 08:00 ถึง 09:15"
