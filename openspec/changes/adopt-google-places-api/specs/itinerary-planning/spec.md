## ADDED Requirements

### Requirement: Places enrichment before checks
With the Places provider available, `/api/plan` and `/api/replan` SHALL enrich new food, sight, market, nature and view stops (at most `BOP_PLACES_MAX_PER_PLAN`, default 25) with Places weekly hours (`open`, `days.hours`, `days.closed`), special-day closures inside the trip, `businessStatus`, `servesVegetarianFood`, `reservable` and phone before `checks()` and the repair round, and SHALL mark them `src: { url: googleMapsUri, title: 'Google Maps', checked: 'web' }`.

#### Scenario: Monday closure found
- **WHEN** Places shows a museum has no Monday period and the plan visits it on a Monday
- **THEN** the stop gets `days.closed: ['mon']`, "เปิดวันที่ไป" fails, and the repair round moves or replaces it

#### Scenario: Permanently closed
- **WHEN** Places reports `CLOSED_PERMANENTLY` for a planned restaurant
- **THEN** the repair report contains a problem line saying the place is permanently closed

#### Scenario: Vegetarian flag absent
- **WHEN** Places has no `servesVegetarianFood` value for a stop
- **THEN** the model's `veg` value is kept

#### Scenario: No key
- **WHEN** the Places provider is unavailable
- **THEN** stops keep the hours and days the model gave and its web checks, as today
