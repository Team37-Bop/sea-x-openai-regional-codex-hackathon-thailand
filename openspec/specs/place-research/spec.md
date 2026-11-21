# place-research Specification

## Purpose

The place sheet researches one itinerary stop on demand. It presents the description, facts, menus in baht, source links and credited images. Reference evidence in prep commit `292ba5f` includes `server/agent.mjs` (`runPlaceInfo`, `normalizeInfo`), `server/openai.mjs`, `server/claude.mjs`, `server/cli-llm.mjs`, `server/photos.mjs`, `src/main.js` (`openSheet`, `loadInfo`), `src/ui/place.js` and `scripts/test-images.mjs`.

## Requirements

### Requirement: Place info request and response
`POST /api/place-info` SHALL accept `{ city, stop: { id, n, k, ll, note?, query?, aliases? | place.aliases } }` for any stop kind and SHALL end with `done.info = { summary, details, dishes, priceRange?, hours?, phone?, tips?, sources, photos, confidence }`.

#### Scenario: Missing id or name
- **WHEN** `stop.id` or `stop.n` is missing
- **THEN** the stream ends with `bad_request` "ไม่มีข้อมูลสถานที่ (stop.id, stop.n)"

#### Scenario: Non-food stop
- **WHEN** a temple is researched
- **THEN** the sheet renders the place details and suppresses the recommended-menu section even if the provider returned dish records

### Requirement: Web research on the fast model
Research SHALL use the selected provider’s fast tier and request at most three searches. The city defaults to Chiang Mai. The OpenAI adapter requests the place schema directly and treats an unparseable research payload as empty input to normalization. Anthropic API research can make a second, tool-free structured-format call. Wikimedia exact-match lookup starts before the research result is awaited.

#### Scenario: Fast model unavailable
- **WHEN** Sonnet 5.5 is rejected by the account
- **THEN** the call retries on the next fast model and, last, on Opus

### Requirement: Details
`details` SHALL hold `what` and up to 5 `highlights`, and MAY hold `price`, `hours`, `rating`, `booking` and `address` strings taken from the research; hours and phone are optional best-effort text fields. The normalizer trims them to 80 and 40 characters respectively and records confidence at the overall response level.

#### Scenario: Phone not found
- **WHEN** the research response supplies no phone number
- **THEN** the normalized response omits `phone` and the sheet omits that fact row

### Requirement: Dishes with THB prices
Up to 6 recommended dishes SHALL carry `price` in THB per item, converted from a local price with the model's stated `rate` (THB per unit) and keeping `priceLocal: { amount, currency }`; a price that cannot be interpreted SHALL be `null`.

#### Scenario: Vietnamese price
- **WHEN** the model reports a dish at 80,000 VND with rate 0.0014
- **THEN** `price` is 112 and `priceLocal` is `{ amount: 80000, currency: 'VND' }`

#### Scenario: Local amount mislabelled as THB
- **WHEN** `price` equals the local amount and the rate is below 0.5
- **THEN** the server converts it instead of showing it as baht

### Requirement: Sources and confidence
`sources` SHALL list at most 6 pages, cited pages first, and only URLs from the returned results or citations. The normalizer SHALL set `confidence` to `web` only when the model explicitly returns `web` and at least one normalized source survives. All other combinations yield `estimate`.

#### Scenario: Nothing reliable found
- **WHEN** the search returns nothing usable
- **THEN** `confidence` is `estimate`, the step reads "ไม่พบข้อมูลที่เชื่อถือได้ ใช้ข้อมูลประมาณ", and the sheet displays estimated confidence unless the itinerary stop already has a web-checked source

### Requirement: Photos with match levels
`photos` SHALL hold 0-4 https images, each `{ url, thumb?, credit, source: 'wikimedia'|'web', page, match: 'exact'|'likely' }`, sorted exact first, from: Wikimedia exact matches, then og:image of the place's own page and of the source pages, then (only if none) Commons files within 300 m whose title names the place.

#### Scenario: Wikimedia exact match
- **WHEN** a Wikipedia article's title or Wikidata label/alias matches the stop name, query or alias and its coordinates are within 1.5 km (3 km for sight, nature, market, area)
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

### Requirement: Canonical image and source URLs
Server and browser normalization SHALL unwrap direct HTTPS URLs, Markdown images, Markdown links and angle-bracket URLs before storage or rendering. The server SHALL require HTTPS, reject credential-bearing URLs, and require normalized URLs under 2,000 characters, and user-facing place text SHALL not display raw Markdown wrappers.

#### Scenario: Model wraps an image in Markdown
- **WHEN** a model returns `![วัด](https://images.example/wat.jpg)` for a photo
- **THEN** the API and image element use `https://images.example/wat.jpg` rather than the Markdown string

#### Scenario: Unsafe media URL
- **WHEN** a photo uses a credential-bearing URL or a non-web scheme
- **THEN** it is rejected and no image element is created for it

### Requirement: Safe page fetching
Before requesting a page, the collector SHALL require a dotted HTTPS host name and reject credentials, non-443 ports, IP literals and the blocked local suffixes. The HTTP client follows redirects and the collector checks the final response URL before parsing it. This URL check is applied to host-name text. The HTML reader SHALL stop after the head closes or its accumulated decoded text reaches the 300,000-character threshold, with a five-second request timeout.

#### Scenario: Model returns an internal URL
- **WHEN** a source URL is `https://localhost/...` or `https://10.0.0.1/...`
- **THEN** it is not fetched

### Requirement: Wikimedia rate limits
The server SHALL send at most 2 Wikimedia requests at a time at least 250 ms apart, and after a 429 that persists through the single retry SHALL skip new Wikimedia requests for 60 s so that photos come from og:image only.

#### Scenario: Busy period
- **WHEN** Wikimedia answers 429 on the initial request and its retry
- **THEN** photos during the next 60 s are web-only or empty

### Requirement: Place info cache
Results SHALL be cached in memory per `stop.id|n` for the server process (concurrent requests share one lookup), a hit SHALL answer with `cached: true`, and a failed lookup SHALL be evicted.

#### Scenario: Second open of the sheet
- **WHEN** the same stop is requested again
- **THEN** the step "ใช้ข้อมูลที่ค้นไว้แล้ว" is emitted and `done.cached` is true

### Requirement: Bounded output and cache identity

The server SHALL trim incoming names to 120 characters, kinds to 20, notes to 300 and queries to 120. Explicit stop query takes precedence over the nested place query. Explicit and nested aliases together supply at most eight strings of 80 characters. The response SHALL include a summary of up to 300 characters (default `ยังไม่มีข้อมูล`), a details description of up to 400, up to five highlights and up to five tips. A new successful lookup includes elapsed milliseconds and model usage. A cache hit includes elapsed milliseconds and `cached: true`.

#### Scenario: Same stop reopened while the first lookup is running
- **WHEN** two requests have the same stop ID and name
- **THEN** the second awaits the first lookup, even if it supplies another city or note. A renamed stop creates a new cache key

#### Scenario: Model supplies both a valid fact URL and a photo page
- **WHEN** a cited result, an unverified model source and a separate `photoPage` appear in research
- **THEN** normalized citations lead the source list, unverified model sources are dropped and the photo hint is used internally. The returned info object omits the internal photo-page property

#### Scenario: Credits and thumbnails
- **WHEN** a Commons file qualifies
- **THEN** image metadata supplies the thumbnail or original URL, file page, artist and available licence. The credit uses a Thai unknown-photographer label if Commons omits the artist

#### Scenario: Photo lookup has limited evidence
- **WHEN** no exact image or matching page preview survives
- **THEN** the collector checks nearby Commons files for a distinctive name token and an eligible raster extension. With no match it returns an empty photo list and the remaining place details
