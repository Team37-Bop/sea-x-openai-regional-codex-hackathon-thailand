# replanning Specification

## Purpose

Apply small proposed edits to a copy of the scheduled itinerary and let the group review a trade-off, apply a change and restore its prior state. `POST /api/replan` accepts `{ setup, plan, command, day? }`.

Reference implementation in the prep repository at `292ba5f` includes `server/agent.mjs` (`runReplan`, `applyTransportChange`), `server/prompts.mjs` (decision policy and response schema), `src/plan.js` (`applyEdits`, `diff`, `planBrief`) and `src/main.js` (`agentReplan`, `syncResv`, `apply`, `beginLineVote`). Booked-hotel edits are exercised in `scripts/test-stays.mjs`. LINE vote lifecycle tests are in `scripts/test-line.mjs`.

## Requirements
### Requirement: Minimal edits
The model SHALL answer with edits (`remove`, `insert`, `replace`, `flag`) against the current plan's stop ids instead of a new plan, changing only the affected part; the server SHALL apply them with `applyEdits()`, record edit errors and keep stops in time order.

#### Scenario: Remove a stop
- **WHEN** the command is "ตัดน้ำตกออก"
- **THEN** the option removes that stop, the next leg is re-priced and re-timed, and other days are unchanged

#### Scenario: Unknown id
- **WHEN** an edit names a stop id that does not exist
- **THEN** the error "ไม่พบ <id>" is recorded and sent to the repair round

### Requirement: Vote rules
The model prompt SHALL request a vote for a broken member constraint, a cost increase greater than ฿300 per person, or a lost starred wish. The server SHALL use the returned vote decision and require at least two options to hold a vote. It caps options at three and assigns A–C by position. With a false decision or one option it retains only A. The arithmetic threshold guides the model and is not a separate server-side decision.

#### Scenario: No trade-off
- **WHEN** the model returns one option and `needs_vote: false`
- **THEN** the `done` event has one option and the UI applies it with an undo button

#### Scenario: Model asks for a vote with one option
- **WHEN** `needs_vote` is true but only one option is returned
- **THEN** the server sets `needs_vote` to false

#### Scenario: Group vote
- **WHEN** `needs_vote` is true
- **THEN** the UI shows the options, a LINE-style message per option (starting "Bop: ") and the members' votes, and the organizer breaks a tie

### Requirement: Option output
Each option SHALL carry `key`, `title`, `head`, `line` (2-4 short Thai lines for the group chat, with the cost change per person and who has a new task) and a full scheduled `plan`; the `done` event SHALL also carry `summary`, `day` (0-based, most affected), `routes` for every leg of every option, `ms` and `repaired`.

#### Scenario: Routes for every option
- **WHEN** two options are returned
- **THEN** `routes` contains an entry for every leg key in both plans

### Requirement: Reservations kept
The server SHALL mark a confirmed reservation in the plan brief and ask the model to preserve it unless impossible. A remove operation on a confirmed stop SHALL record an edit error and remove the stop from the candidate plan, making the conflict visible to the repair round. The UI SHALL track each reservation's state (todo, done, move) and, after a change, list cancelled bookings and bookings that need a call to move.

#### Scenario: Booked restaurant retimed
- **WHEN** a replan moves a restaurant the organizer marked "จองแล้ว"
- **THEN** the UI marks it "ต้องโทรเลื่อน" with the old time

#### Scenario: Booked restaurant removed
- **WHEN** a replan drops a restaurant marked done
- **THEN** the UI lists it under cancellations with its phone number

#### Scenario: Browser carries confirmed reservations into the request
- **WHEN** the UI posts the plan to `/api/replan`
- **THEN** the browser clones the plan and marks `res.done = true` on a stop with a reservation whose local status is done. A pending or move-needed booking is not newly marked as confirmed.

### Requirement: Checks and repair per option
The server SHALL route, schedule and check every option, report "ทางเลือก A: ตรวจเงื่อนไข ผ่าน N/M · ±฿X/คน", and run one repair call for options with edit errors, new system-rule failures or (without a vote) new member-rule failures, keeping a repaired option only if it passes no fewer rules.

#### Scenario: Pre-existing failure
- **WHEN** a rule already failed on the current plan
- **THEN** it does not trigger a repair

### Requirement: Transport change by command
When the command changes the flight, train or bus, the server SHALL point `flags.transport.<dir>.chosen` of every option at the matching option (by code, else carrier and departure), append an unknown one with `checked: 'estimate'`, re-time the first or last stop, and return the updated `setup` in `done`.

#### Scenario: Change outbound flight
- **WHEN** the command is "เปลี่ยนเที่ยวบินขาไปเป็น Nok Air DD8302 ออก 08:00 ถึง 09:15"
- **THEN** a first-day transit stop is set to 09:15 and `done.setup.arrive.time` is 09:15

### Requirement: Undo
The UI SHALL push the previous plan, reservation states, cancellations and setup on a history stack before applying an option, and "ย้อนกลับ" SHALL restore them.

#### Scenario: Undo after apply
- **WHEN** the organizer taps "ย้อนกลับ" after a replan
- **THEN** the previous plan and reservation states are restored and the step "ย้อนกลับเป็นแผนก่อนหน้าแล้ว" is shown

### Requirement: Offline scenarios
Without a usable model on the sample plan, the UI SHALL run pre-built scenarios (`SCEN`: rain, closed restaurant, full restaurant, flight delay) instead of calling the server.

#### Scenario: Offline rain
- **WHEN** the model is unavailable and the organizer types "ถ้าฝนตกล่ะ"
- **THEN** the rain scenario runs locally with simulated votes

### Requirement: Bad input
The endpoint SHALL end with `bad_request` when the plan is invalid (no days, a stop without string id, array `ll` or `HH:MM` times) or the command is empty.

#### Scenario: Empty command
- **WHEN** `command` is blank
- **THEN** the error message is "ไม่มีคำสั่ง"

### Requirement: Rain-triggered replan
An actionable rain alert SHALL offer "ให้ Bop ปรับแผน" (near-term rain or a heavy longer-range trend). Only that tap SHALL send `/api/replan` with a generated Thai command naming the day, the time window, the stop, the probability and the amount; the replan then follows the normal minimal-edit and vote rules.

#### Scenario: Organizer accepts
- **WHEN** the organizer taps "ให้ Bop ปรับแผน" on a heavy-rain alert for day 2 at น้ำตกบัวตอง
- **THEN** the UI sends a command like "พยากรณ์ฝนตกหนัก 14:00–16:00 วันที่ 2 ที่น้ำตกบัวตอง (โอกาส 80% ~4 มม./ชม.) ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม" with `day: 1`

#### Scenario: Organizer ignores the alert
- **WHEN** the alert is dismissed
- **THEN** the plan is not changed and no replan is sent

### Requirement: Input and output bounds

The endpoint SHALL validate the setup and plan before asking the model. Every submitted day has a stop array. Every stop has a string ID, coordinate array and time strings in the accepted hour-and-minute format. Commands are trimmed and bounded to 1,000 characters. The selected day is zero based, defaults to zero and is constrained to the range of plan days.

#### Scenario: Out-of-range selected day
- **WHEN** day 9 is sent for a three-day plan
- **THEN** the request to the model uses day index 2. The returned most-affected day is also constrained to the available days.

#### Scenario: Returned option metadata
- **WHEN** options are finalized
- **THEN** the terminal event provides a summary (up to 600 characters), each option's title (120), headline (200), group-chat text (800), complete scheduled plan, timing, usage and union of used route geometries
- **AND** it includes `vote_reason` only for a vote and a replacement `setup` only for a recognized transport change

### Requirement: Independent candidates and edit placement

The server SHALL base every initial option on the same pre-change plan. It SHALL record errors for individual edits and continue applying subsequent edits in order. It SHALL re-evaluate directions and eligible costs after a stop is removed or its location changes.

#### Scenario: Insertion anchor is missing or on another day
- **WHEN** an insert asks to follow a stop outside the target day
- **THEN** that edit records an error. A valid insert without an anchor goes at the start of its day. A duplicate inserted ID receives a unique suffix.

#### Scenario: Candidate repair deteriorates
- **WHEN** a repair changes multiple proposed options
- **THEN** each repaired candidate is evaluated against its own earlier pass count and only candidates scoring at least that count replace their earlier versions. An ordinary repair failure returns the earlier options; authentication and rate-limit errors propagate.

#### Scenario: Existing failure appears in multiple options
- **WHEN** a failed rule with the same label already existed in the base plan
- **THEN** it is excluded from the new-failure list. During voting, new member-rule failures can be shown as trade-offs, while edit errors and new system-rule failures still request repair.

### Requirement: Reservation tasks, previews and linked votes

The UI SHALL distinguish a preview from an applied option. Applying an option snapshots the prior plan, setup, reservation statuses and cancellation list, updates the call tasks, refreshes the forecast and displays a change summary.

#### Scenario: A confirmed stop disappears
- **WHEN** an applied plan removes a previously confirmed stop with a reservation
- **THEN** the cancellations list records its name, available phone number, former day label and former start time. A retained confirmed reservation with a changed start time is marked for rescheduling with its old time.

#### Scenario: Group linked to LINE
- **WHEN** the planner receives a vote with at least two choices and has a linked trip and organizer token
- **THEN** it previews option A, starts a LINE vote with the choices and a 120-minute deadline, and polls about every three seconds while the vote card is active. A closed vote with a matching winning key applies that option.

#### Scenario: Offline command outside the sample vocabulary
- **WHEN** a sample user without a usable provider enters an unrecognized command
- **THEN** the UI explains the sample commands and leaves the plan in place. Recognized waterfall removal, rain, restaurant closure and flight-delay commands use their local scenarios.

### Requirement: Review before applying a group option

The organizer SHALL be able to inspect a proposed plan alongside the committed itinerary, including affected visits, changed times, changes to budget per traveler and newly failing checks. Copying the option summary SHALL require a user action.

#### Scenario: Resolving a local choice

- **WHEN** a change needs a decision and the group has no linked remote vote
- **THEN** the organizer may select a proposed plan, collect local ballots or discard the preview. A linked LINE vote follows its own result and tie-break rules.
