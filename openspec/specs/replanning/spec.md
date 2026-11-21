# replanning Specification

## Purpose
`POST /api/replan` applies a natural-language command or disruption to an existing plan as minimal edits, offers options and a group vote only for real trade-offs, and lets the UI apply the result with undo. Code: `runReplan` in `server/agent.mjs`, `applyEdits`/`planBrief`/`diff` in `src/plan.js`, the replan card in `src/main.js`.
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
`needs_vote` SHALL be true only when an option breaks a member's constraint, adds more than ฿300 per person, or drops a starred wish; then 2-3 options A-C with `vote_reason` SHALL be returned, otherwise exactly one option A that the UI applies immediately.

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
The server SHALL treat a stop whose `res.done` is set as fixed: the plan brief marks it "จองแล้ว(done)", the model is told to keep it unless impossible, and removing it SHALL be recorded as an edit error. The UI SHALL track each reservation's state (todo, done, move) and, after a change, list cancelled bookings and bookings that need a call to move.

#### Scenario: Booked restaurant retimed
- **WHEN** a replan moves a restaurant the organizer marked "จองแล้ว"
- **THEN** the UI marks it "ต้องโทรเลื่อน" with the old time

#### Scenario: Booked restaurant removed
- **WHEN** a replan drops a restaurant marked done
- **THEN** the UI lists it under cancellations with its phone number

#### Scenario: Reservation state is not sent today
- **WHEN** the UI posts the plan to `/api/replan`
- **THEN** the reservation state stays in the UI's own store and the stops carry no `res.done`, so the server-side keep rule applies only to plans that carry the flag

### Requirement: Checks and repair per option
The server SHALL route, schedule and check every option, report "ทางเลือก A: ตรวจเงื่อนไข ผ่าน N/M · ±฿X/คน", and run one repair call for options with edit errors, new system-rule failures or (without a vote) new member-rule failures, keeping a repaired option only if it passes no fewer rules.

#### Scenario: Pre-existing failure
- **WHEN** a rule already failed on the current plan
- **THEN** it does not trigger a repair

### Requirement: Transport change by command
When the command changes the flight, train or bus, the server SHALL point `flags.transport.<dir>.chosen` of every option at the matching option (by code, else carrier and departure), append an unknown one with `checked: 'estimate'`, re-time the first or last stop, and return the updated `setup` in `done`.

#### Scenario: Change outbound flight
- **WHEN** the command is "เปลี่ยนเที่ยวบินขาไปเป็น Nok Air DD8302 ออก 08:00 ถึง 09:15"
- **THEN** the first stop of day 1 is set to 09:15 and `done.setup.arrive.time` is 09:15

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
A rain alert SHALL offer "ให้ Bop ปรับแผน", and only that tap SHALL send `/api/replan` with a generated Thai command naming the day, the time window, the stop, the probability and the amount; the replan then follows the normal minimal-edit and vote rules.

#### Scenario: Organizer accepts
- **WHEN** the organizer taps "ให้ Bop ปรับแผน" on a heavy-rain alert for day 2 at น้ำตกบัวตอง
- **THEN** the UI sends a command like "พยากรณ์ฝนตกหนัก 14:00–16:00 วันที่ 2 ที่น้ำตกบัวตอง (โอกาส 80% ~4 มม./ชม.) ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม" with `day: 1`

#### Scenario: Organizer ignores the alert
- **WHEN** the alert is dismissed
- **THEN** the plan is not changed and no replan is sent
