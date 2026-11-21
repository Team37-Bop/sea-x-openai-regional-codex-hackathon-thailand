## MODIFIED Requirements

### Requirement: Stay selection
The plan SHALL set `plan.flags.stay = { area, why, booked?, examples[] }`; in auto mode the model SHALL pick the area that minimises travel and fits budgets, and the examples SHALL come from live hotel rates around that area when a hotel provider is available (`checked: 'live'`, `offerId`, `bookable`, live `priceNight` THB per room per night) or otherwise from at most one web search (`checked: 'web'` only for a real search URL), with the first example becoming the hotel stop; in booked mode the server SHALL geocode the name (also trying its first 3 and 2 words) and pin every destination hotel stop to it.

#### Scenario: Auto stay
- **WHEN** stay mode is auto and no hotel provider is available
- **THEN** `flags.stay.examples` holds up to 3 hotels with web-estimated nightly prices labelled `web` or `estimate`, and the stay cost per person (priceNight × nights ÷ 2) sits on the first hotel stop

#### Scenario: Auto stay with live rates
- **WHEN** stay mode is auto and `LITEAPI_KEY` is set
- **THEN** up to 3 examples come from live rates (best budget fit, best rated, nearest), no hotel web search is made, and the stay cost per person uses the first example's live rate

#### Scenario: Provider fails
- **WHEN** the rate search errors, times out after 8 s or finds nothing
- **THEN** examples come from the web search as without a provider

#### Scenario: Booked hotel found
- **WHEN** stay is booked as "Novotel Danang Premier Han River" and OSM only knows "Novotel Danang"
- **THEN** the shorter name geocodes, the step reads "ที่พักที่จองไว้: … · พบบนแผนที่", and no hotel search is made

#### Scenario: Booked hotel not found
- **WHEN** no form of the name geocodes
- **THEN** the step ends "ใช้พิกัดประมาณ" and the model's coordinates are used
