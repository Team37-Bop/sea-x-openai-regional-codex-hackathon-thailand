# trip-setup Specification

## Purpose
The onboarding screen collects a `TripSetup` (destination, dates, how the group travels there and back, where it stays, members and their constraints, autonomy) and the server validates and normalises it before any agent work. Code: `src/ui/setup.js`, `normalizeSetup()` in `server/agent.mjs`, `GET /api/city` in `server/api.mjs`.
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
The setup SHALL carry `stay` as `{ mode: 'auto' }` or `{ mode: 'booked', stays: [{ name, nights }] }`, defaulting to auto, and SHALL still accept the older `hotelArea` field and the older `{ mode: 'booked', name }` shape, which means one stay for every night. Stays SHALL be in trip order, the first starting on night 1, and their nights SHALL add up to the trip's nights (days - 1).

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
The server SHALL trim strings to fixed lengths, reject bodies over 2 MB or invalid JSON with `bad_request`, and pass `pace` (chill, normal, packed), `currency` (ISO 4217), `country` and `extra` through only when valid.

#### Scenario: Oversized body
- **WHEN** a request body exceeds 2 MB
- **THEN** the stream ends with `error` code `bad_request` "ข้อมูลใหญ่เกินไป"

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
