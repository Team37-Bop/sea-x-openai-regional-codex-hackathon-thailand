# trip-setup Specification

## Purpose

The organizer enters a destination, dates, travel, stays and the needs of each member. The browser validates the draft before submission. The API normalizes caller-supplied objects, including older saved shapes, before passing them to planning.

Reference implementation in the prep repository at `292ba5f` includes `src/ui/setup.js` (`validate`, `toSetup`, `addStay`, `delStay`), `server/agent.mjs` (`normalizeSetup`), `src/plan.js` (`bookedStays`) and `server/api.mjs` (`readJson` and the city route). Executable examples for old and multiple hotels are in `scripts/test-stays.mjs`.

## Requirements
### Requirement: Destination with any-city lookup
The UI SHALL offer a fixed list of suggested destinations (Thai and Asian cities with coordinates, ISO country, currency and main airport) and SHALL resolve any other typed city through `GET /api/city?q=`, which returns `{ name, cc, ll }` from Nominatim (then Photon) or HTTP 404 `{ error: 'not_found' }`.

#### Scenario: Suggested city
- **WHEN** the organizer picks "โตเกียว"
- **THEN** the setup gets `city: "โตเกียว"`, `country: "JP"`, `currency: "JPY"` without a network call

#### Scenario: Unlisted city
- **WHEN** the organizer types a city that is not in the suggestion list
- **THEN** the UI calls `/api/city`, fills `country` from `cc` and `currency` from its country table, and caches the answer for the page

#### Scenario: Unknown city
- **WHEN** neither Nominatim nor Photon finds the query
- **THEN** `/api/city` answers 404 and the city stays free text

### Requirement: Trip dates
The server SHALL require `startDate` as `YYYY-MM-DD` and SHALL derive `days` from `endDate` (inclusive) when it is valid, clamping the trip to 1-7 days.

#### Scenario: Missing start date
- **WHEN** a request has no valid `startDate`
- **THEN** the endpoint ends with `error` code `bad_request` and a Thai message

#### Scenario: End date sets the length
- **WHEN** `startDate` is 2026-11-20 and `endDate` is 2026-11-22
- **THEN** `days` is 3 regardless of the `days` value sent

#### Scenario: Long trip clamped
- **WHEN** the dates span 10 days
- **THEN** `days` is 7

### Requirement: Travel modes to and from the destination
The setup SHALL describe each direction as `arrive`/`depart` with `by` in flight, drive, bus, train or undecided, a place (`from`/`to`, airport code for flights), an optional `HH:MM` time, an optional `auto` flag and an optional picked `choice`; a missing `by` SHALL mean flight when a time is given and undecided otherwise.

#### Scenario: Old setup without by
- **WHEN** `arrive` is `{ from: "DMK", time: "09:15" }`
- **THEN** it is normalised to `by: "flight"`

#### Scenario: Drive implies own car
- **WHEN** either direction is `drive` and `hasCar` is not false
- **THEN** `hasCar` is true

#### Scenario: Picked transport option
- **WHEN** `arrive.choice` carries a carrier and valid `dep`/`arr` times
- **THEN** the choice is kept (id, by, carrier, code, from, to, times, THB price, source, `checked`) and is used without a new search

### Requirement: Stay mode
The setup SHALL carry `stay` as `{ mode: 'auto' }` or `{ mode: 'booked', stays: [{ name, nights }] }`, defaulting to auto, and SHALL accept the older `{ mode: 'booked', name }` shape as one stay for every night. The independent legacy `hotelArea` string is an area hint. A booked stay requires `stay.mode = booked`. Stays SHALL be in trip order, the first starting on night 1, and their nights SHALL add up to the trip's nights (days - 1).

#### Scenario: Choosing how to arrange accommodation
- **WHEN** the organizer opens trip setup
- **THEN** the accommodation section displays “ให้ Bop แนะนำ” and “จองไว้แล้ว” together as a keyboard-accessible single-choice group. A new trip selects recommendations by default. Selecting booked accommodation reveals hotel names and nights; selecting recommendations reveals the neighborhood field. Switching preserves entered values for the current draft and excludes inactive booked rows from form validation.

#### Scenario: Booked hotel
- **WHEN** the organizer chooses "จองไว้แล้ว" and types one hotel name
- **THEN** the setup sends `stay: { mode: 'booked', stays: [{ name, nights: days - 1 }] }`

#### Scenario: Booked without a name
- **WHEN** booked is chosen with an empty name on a trip with at least one night
- **THEN** the UI blocks submission with "ใส่ชื่อหรือที่อยู่ที่พักที่จองไว้ หรือเลือก “ให้ Bop แนะนำ”"

#### Scenario: Old booked shape
- **WHEN** a setup arrives as `{ mode: 'booked', name: 'Tamarind Village' }` for a 4-day trip
- **THEN** the server and the UI treat it as `stays: [{ name: 'Tamarind Village', nights: 3 }]`

### Requirement: Members and their constraints
The setup SHALL have 1-12 members, each with a unique slug id, a name and optional `avoid` (free text ≤120 chars: allergies / foods they do not eat, entered in the field "แพ้/ไม่ทาน"; replaces the vegetarian toggle), `maxWalkKm` (per day), `budget` (THB per person for the trip, excluding flights), up to 5 `wants` and a free-text `note` that is context only.

#### Scenario: No members
- **WHEN** `members` is empty
- **THEN** the endpoint ends with `bad_request` "ต้องมีสมาชิกอย่างน้อย 1 คน"

#### Scenario: Duplicate ids
- **WHEN** two members share an id
- **THEN** the second id gets a suffix so ids stay unique

#### Scenario: Adding and removing member wishes
- **WHEN** the organizer chooses a place suggestion, or types an activity and presses Enter or “เพิ่ม”
- **THEN** the member's wish appears as an individually removable item. Each member can have up to five items.
- **AND** planning and transport searches include a nonempty draft wish even before it is added. Pasted comma-separated wishes are also accepted, and saved wishes reopen as individual items in their original order.

#### Scenario: Note is not an instruction
- **WHEN** a member note contains text that looks like an instruction to the agent
- **THEN** the prompts treat it as trip data and the output rules are unchanged

### Requirement: Autonomy
The setup SHALL carry `autonomy` as `auto` (default) or `ask`; `ask` SHALL make the UI fetch candidates before planning, and `picks` SHALL carry the group's answers.

#### Scenario: Ask mode
- **WHEN** autonomy is `ask`
- **THEN** the UI calls `/api/plan/candidates` first and then `/api/plan` with `setup.picks`

#### Scenario: Default
- **WHEN** autonomy is missing or any other value
- **THEN** it is normalised to `auto`

### Requirement: Input limits
The server SHALL trim strings to field-specific limits and accept JSON object requests up to 2 MiB. Currency and city-airport codes must match three uppercase letters. Country accepts up to 60 characters, pace accepts `chill`, `normal` or `packed`, and free-form `extra` accepts up to 1,000 characters.

#### Scenario: Oversized body
- **WHEN** a request body exceeds 2 MB
- **THEN** the body reader rejects the request as `bad_request` with "ข้อมูลใหญ่เกินไป" and destroys the request stream. A caller can observe a closed connection.

### Requirement: Booked stays by night
In "จองไว้แล้ว" mode the setup screen SHALL show one stay row covering every night by default, SHALL let the organizer add rows with "+ เพิ่มที่พัก" (up to one per night), set the nights of each row, and remove rows, and SHALL show each row's check-in → check-out dates and the running total of nights. The UI SHALL block planning with a Thai message naming the row when a name is missing, a row has fewer than 1 night, or the nights do not add up to the trip's nights. The server SHALL repair sums that still do not add up (the last stay takes the rest, or nights are taken back from the end) and drop blank names.

#### Scenario: Two hotels
- **WHEN** a 4-day trip books "Chiang Mai Inn" for 2 nights and "Pai Resort" for 1 night
- **THEN** the setup sends `stays: [{ name: 'Chiang Mai Inn', nights: 2 }, { name: 'Pai Resort', nights: 1 }]` and the rows show "ศ. 20 พ.ย. → อา. 22 พ.ย." and "อา. 22 พ.ย. → จ. 23 พ.ย."

#### Scenario: Nights do not add up
- **WHEN** the rows add up to 5 nights on a 3-night trip
- **THEN** submission is blocked with "จำนวนคืนรวม 5 คืน ไม่ตรงกับทริป 3 คืน แก้ให้รวมกันได้ 3 คืน" and the total reads in red

#### Scenario: Adding a row
- **WHEN** every night is already assigned and the organizer taps "+ เพิ่มที่พัก"
- **THEN** a new empty row takes one night from the last row with more than one night

#### Scenario: Day trip
- **WHEN** the trip is 1 day (0 nights) and booked is chosen
- **THEN** no nights field or "+ เพิ่มที่พัก" is shown, the name is optional, and an empty name sends `{ mode: 'auto' }`

### Requirement: Draft validation and server normalization

The browser SHALL block a blank city, missing date, reversed date range, more than seven calendar days, invalid booked-stay allocation, and a group with no named member. The server SHALL normalize direct callers independently. With usable member data, a blank city defaults to Chiang Mai, a missing title to "ทริปของเรา", and a missing numeric day count to three. The server checks the start-date string pattern and uses an inclusive positive end-date span when supplied.

#### Scenario: Eight-day request through different entry points
- **WHEN** an organizer enters November 20–27 in the form
- **THEN** the form identifies the end-date field and its seven-day limit
- **AND** a direct request with those dates normalizes to seven planning days and retains the supplied end-date string

#### Scenario: Named members and organizer
- **WHEN** the browser converts a draft with one blank member and two named members, neither marked organizer
- **THEN** it sends the two named members and gives the first one the organizer role

#### Scenario: Duplicate direct-call IDs and text limits
- **WHEN** a request includes more than 12 members or repeats a sanitized member ID
- **THEN** only the first 12 entries are normalized and each collision is resolved by appending underscores until the ID is unique
- **AND** each name is capped at 40 characters, each note at 400, and up to five nonempty wishes at 120 characters each

#### Scenario: Numeric constraints
- **WHEN** a direct caller sends a numeric budget of 1234.6 and a negative walking cap
- **THEN** the budget is stored as 1235 and the walking cap is omitted. The browser converts positive numeric form values before posting.

### Requirement: Trusted fields for choices, stays and picks

The server SHALL reconstruct selected transport and accommodation entries from allowed fields. It SHALL take booked-stay coordinates from its own lookup, preserve a live Duffel offer reference only for a matching offer-ID format, and bound group picks before planning.

#### Scenario: Client supplies hotel coordinates
- **WHEN** a booked stay carries caller-supplied latitude and longitude
- **THEN** the normalized setup keeps its name and night count. The planner resolves the hotel's position separately.

#### Scenario: Live flight selected before planning
- **WHEN** a timed flight choice has a carrier, `checked: 'live'` and an `offerId` beginning with `off_` followed by alphanumeric characters
- **THEN** the normalized choice carries the offer ID, expiry, explicit bookability and test-mode flags
- **AND** without the valid offer ID a caller's `live` label becomes an estimate

#### Scenario: Bounded group answers
- **WHEN** more than 15 named must-picks or 30 avoid entries are received
- **THEN** the server processes at most 15 and 30 respectively. It can use a remembered candidate ID for missing query or coordinates and turns an unknown avoid string into a name for matching.

#### Scenario: Legacy hour formatting
- **WHEN** an arrival object has `time: "9:05"` and no mode
- **THEN** the normalized mode is flight and the time is `09:05`. An entirely omitted direction stays absent.

#### Scenario: JSON media type
- **WHEN** an agent route receives a POST using a media type other than `application/json`
- **THEN** it returns HTTP 415 with an NDJSON `bad_request` error. An array, scalar or malformed JSON sent under the correct media type also fails body validation.

### Requirement: Partial place names

The destination, outbound origin, return destination, booked lodgings and individual wish lists SHALL offer selectable place suggestions while the organizer types. Suggestions SHALL accept Thai or English names and known airport codes.

#### Scenario: Selecting a partial name

- **WHEN** the organizer types part of a place name and selects a result by pointer or keyboard
- **THEN** the field accepts the canonical name and uses known coordinates for that selection. Editing the text invalidates the selection. In a member's wish field, selecting a result adds its name as a new item and clears the field for the next wish.

#### Scenario: Search service unavailable

- **WHEN** the online service times out or returns no matches
- **THEN** local matches remain available and the organizer can enter a free-text location.

### Requirement: Visible pace and place-selection preferences

The organizer SHALL see two separate, keyboard-operable groups for trip pace and place selection. Pace SHALL offer relaxed, balanced and packed in that order. Place selection SHALL explain the choice between letting Bop plan directly and reviewing candidate places first.

#### Scenario: Create and reopen a trip

- **WHEN** an organizer selects a packed trip and asks to review places first
- **THEN** the candidate request and the final planning request both carry `pace: packed` and `autonomy: ask`, and reopening setup selects those options.

#### Scenario: Unspecified preferences

- **WHEN** the organizer starts a new trip or opens a saved trip with missing preferences
- **THEN** balanced pace and automatic place selection are checked, and submission proceeds directly to planning.
