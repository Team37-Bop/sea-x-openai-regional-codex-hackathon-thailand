## ADDED Requirements

### Requirement: Live flight offers from Duffel
When `DUFFEL_ACCESS_TOKEN` is set and a direction is `flight`, transport search SHALL create one Duffel offer request for that direction with the group's passenger count and SHALL return its best offers (cheapest, fastest and best fit to the plan window) instead of searching the web for flights.

#### Scenario: Duffel answers
- **WHEN** the organizer asks Bop to find the outbound flight DMK → CNX
- **THEN** the options are live Duffel offers with `checked: 'live'` and `bookable: true`, and no web search is made for flights

#### Scenario: Duffel unavailable
- **WHEN** there is no token, Duffel errors or times out after 8 s, or it returns no offers
- **THEN** the web search runs as today and options carry `checked: 'web'|'estimate'`

### Requirement: Price-only flight data
When `SERPAPI_KEY` is set, transport search MAY add display-only flight options from SerpApi Google Flights for carriers Duffel does not sell, and they SHALL carry `bookable: false` and a link to the airline instead of a booking action.

#### Scenario: Carrier not on Duffel
- **WHEN** SerpApi shows a Nok Air fare that Duffel does not offer
- **THEN** the option is listed with `bookable: false` and "จองที่เว็บสายการบิน"

## MODIFIED Requirements

### Requirement: Option shape
The `done` event SHALL carry 0-5 options `{ id: 'go-1'…, by, carrier, code?, from, to, dep, arr, price, bag?, src: { url, title }, checked, recommended?, why?, offerId?, expiresAt?, bookable? }`, where `price` is THB per person (live from Duffel when `checked` is `live`, otherwise a web estimate or `null`), `checked` is `live` for Duffel offers, `web` only if `src.url` was really returned by the search and `estimate` otherwise, and options without a carrier or valid times are dropped.

#### Scenario: Unverified option
- **WHEN** the model cites a URL that no search returned
- **THEN** the option keeps its data with `checked: 'estimate'` and `src.url: ''`

#### Scenario: Prices are estimates without Duffel
- **WHEN** the UI shows a price from a web-searched option
- **THEN** it is a web estimate with no live fare or seat availability, and booking is not possible

#### Scenario: Live offer
- **WHEN** the option comes from Duffel
- **THEN** it carries `offerId`, `expiresAt` and `bookable: true`, and its price is the offer's total per passenger in THB
