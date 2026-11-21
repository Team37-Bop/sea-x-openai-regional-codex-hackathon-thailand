## ADDED Requirements

### Requirement: Google Places provider
When `GOOGLE_MAPS_API_KEY` is set and the Places breaker is closed, place research SHALL match the stop with Places Text Search (New) biased to the stop's coordinates and accept a result only if its name matches the stop name, query or aliases and it lies within 1.5 km (3 km for areas); it SHALL then read Place Details (New) with an explicit field mask.

#### Scenario: Confident match
- **WHEN** a Chiang Mai restaurant is researched and Text Search returns it 200 m from the stop
- **THEN** `info.provider` is `google`, and hours, phone, price level, rating, `reservable` and `servesVegetarianFood` come from Place Details

#### Scenario: Ambiguous name
- **WHEN** the best result is 4 km away or its name does not match
- **THEN** no Places data is used for that stop

### Requirement: Fallback to web research
When there is no key, the key is rejected, the quota or daily cap is reached, a Places call fails or times out after 4 s, or no confident match exists, place research SHALL run exactly as without Places (model web search, Wikimedia and og:image photos, `confidence: 'web'|'estimate'`).

#### Scenario: No key
- **WHEN** `GOOGLE_MAPS_API_KEY` is absent
- **THEN** `/api/place-info` behaves as today and makes no Google call

#### Scenario: Quota exhausted
- **WHEN** Places answers 429
- **THEN** Places is skipped for 10 min and the step reads "ค้นเว็บ"

### Requirement: Google key handling
The Places key SHALL be read from `.env.local` on the server only, sent as the `X-Goog-Api-Key` header, never logged, and never appear in any URL or payload sent to the browser; photo media SHALL be resolved server-side with `skipHttpRedirect=true` and only the returned `photoUri` SHALL reach the browser.

#### Scenario: Photo URL
- **WHEN** a Places photo is shown
- **THEN** its `url` is a `photoUri` without the API key

### Requirement: Google attribution and caching limits
Places content SHALL be shown with Google Maps attribution and each photo's author attribution and link; place IDs MAY be stored indefinitely, coordinates for at most 30 days, and all other Places content SHALL be kept in memory only (TTL 6 h) and never written to disk.

#### Scenario: Details sheet with Places data
- **WHEN** the sheet shows hours read from Places
- **THEN** "Google Maps" attribution is visible in the sheet

#### Scenario: Server restart
- **WHEN** the server restarts
- **THEN** only place IDs and coordinates younger than 30 days remain cached

## MODIFIED Requirements

### Requirement: Details
`details` SHALL hold `what` and up to 5 `highlights`, and MAY hold `price`, `hours`, `rating`, `booking` and `address` strings; with a Places match, hours SHALL come from `regularOpeningHours` (and `specialDays` within 7 days), phone from `nationalPhoneNumber`, price from `priceLevel`/`priceRange` in THB, rating from `rating`/`userRatingCount`, booking from `reservable` and the address from `formattedAddress`; without a match they are best-effort from the research and come with the sources they were read from.

#### Scenario: Phone not found
- **WHEN** neither Places nor any page gives a phone number
- **THEN** `phone` is absent; the agent never invents one

#### Scenario: Phone from Places
- **WHEN** Places returns `nationalPhoneNumber`
- **THEN** `info.phone` is that number and the source is Google Maps

#### Scenario: Special hours
- **WHEN** Places lists a special-day closure within the next 7 days
- **THEN** `details.hours` mentions it

### Requirement: Photos with match levels
`photos` SHALL hold 0-4 https images, each `{ url, thumb?, credit, source: 'google'|'wikimedia'|'web', page, match: 'exact'|'likely' }`, sorted exact first, from: Places photos of the matched place (`match: 'exact'`, credit = author attributions), then Wikimedia exact matches, then og:image of the place's own page and of the source pages, then (only if none) Commons files within 300 m whose title names the place; the non-Google sources fill slots only when Places gives fewer than 2 photos.

#### Scenario: Places photos available
- **WHEN** the matched place has 5 Places photos
- **THEN** up to 4 Places photos are returned with their author credits and no Wikimedia or og:image lookup is needed

#### Scenario: Wikimedia exact match
- **WHEN** Places has no photo and a Wikipedia article's title or Wikidata label/alias matches the stop name, query or alias and its coordinates are within 1.5 km (3 km for sight, nature, market, area)
- **THEN** its Wikidata P18 image is used with credit "author · licence · Wikimedia Commons" and `match: 'exact'`

#### Scenario: Related article
- **WHEN** the first matching search result is a broader or related article
- **THEN** its lead image is not used

#### Scenario: og:image rules
- **WHEN** a page's title, og:title and URL path do not name the place, or the image is a logo, icon, placeholder, SVG or declared under 300 px
- **THEN** no photo is taken from it

#### Scenario: Stop without coordinates
- **WHEN** `ll` is missing
- **THEN** no Wikimedia photo is attempted
