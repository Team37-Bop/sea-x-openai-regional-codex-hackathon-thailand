## MODIFIED Requirements

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

## ADDED Requirements

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
