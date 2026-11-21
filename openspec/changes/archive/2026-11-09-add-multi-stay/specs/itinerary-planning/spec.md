## MODIFIED Requirements

### Requirement: Stay selection
The plan SHALL set `plan.flags.stay = { area, why, booked?, examples[] }`; in auto mode the model SHALL pick the area that minimises travel and fits budgets and give 2-3 real example hotels found with at most one web search (`priceNight` THB per room per night, `checked: 'web'` only for a real search URL), and the first example SHALL become the hotel stop; in booked mode the server SHALL geocode every booked stay (also trying its first 3 and 2 words, then a 200 km radius around the city for a stay in another town), make no hotel search, and set `flags.stay.stays` to each stay with `nights`, `checkIn` and `checkOut` dates.

#### Scenario: Auto stay
- **WHEN** stay mode is auto
- **THEN** `flags.stay.examples` holds up to 3 hotels with web-estimated nightly prices labelled `web` or `estimate`, and the stay cost per person (priceNight × nights ÷ 2) sits on the first hotel stop

#### Scenario: Booked hotel found
- **WHEN** stay is booked as "Novotel Danang Premier Han River" and OSM only knows "Novotel Danang"
- **THEN** the shorter name geocodes, the step reads "ที่พักที่จองไว้: … · พบบนแผนที่", and no hotel search is made

#### Scenario: Booked hotel not found
- **WHEN** no form of the name geocodes
- **THEN** the step for that stay ends "ใช้พิกัดประมาณ" and the model's coordinates are used

#### Scenario: Stay in another town
- **WHEN** a Chiang Mai trip books "Reverie Siam Resort" in Pai, about 80 km from the city centre
- **THEN** the wider search geocodes it near Pai and its hotel stops use those coordinates

## ADDED Requirements

### Requirement: Per-day start and end hotel
With booked stays, day 1 SHALL start at the arrival point and end at the hotel of night 1, every day i in between SHALL start at the hotel of night i-1 and end at the hotel of night i, and the last day SHALL start at its hotel (check-out) and end at the departure point. The model SHALL be told each day's hotels (`TripSetup.stayPlan`, per-day role and hotel lines in split design, `planBrief` day headers in repair and replan). The server SHALL pin the day's hotel stops to that day's hotels (by name, else the first stop to the start hotel, else the nearest), add a hotel stop when the model leaves out the start or the end, and put a check-out/luggage note on the start hotel stop of a day that changes hotel. Replans SHALL pin inserted or replaced hotel stops to that day's hotels. Auto mode SHALL keep its single recommended hotel.

#### Scenario: Move day
- **WHEN** a 4-day trip books 2 nights at "Chiang Mai Inn" and 1 night at "Pai Resort"
- **THEN** day 3 starts at Chiang Mai Inn with the note "เช็กเอาต์ ขนกระเป๋าไปPai Resort" and ends at Pai Resort, and day 4 starts at Pai Resort and ends at the departure airport

#### Scenario: Model forgets the end hotel
- **WHEN** the model's day 3 ends at a café in Pai
- **THEN** the server appends a Pai Resort hotel stop 30 minutes after the café's end time

#### Scenario: Single stay unchanged
- **WHEN** one stay covers every night
- **THEN** every day starts and ends at it as before

#### Scenario: Replan keeps the hotels
- **WHEN** a replan inserts a hotel stop on the move day near Pai
- **THEN** it is pinned to Pai Resort, and the plan text the model read showed "ที่พัก: เริ่มวันจาก Chiang Mai Inn … → นอนที่ Pai Resort" for that day
