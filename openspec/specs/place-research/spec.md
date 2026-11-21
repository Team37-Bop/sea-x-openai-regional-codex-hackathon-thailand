# place-research Specification

## Purpose
`POST /api/place-info` researches one stop on demand (the place details sheet): a short summary, details, recommended dishes with THB prices, hours, phone, tips, sources and photos. It runs on the fast model with web search and needs no API key besides the model's. Code: `runPlaceInfo`/`normalizeInfo` in `server/agent.mjs`, `research` in `server/claude.mjs` and `server/cli-llm.mjs`, `server/photos.mjs`, `src/ui/place.js`.

## Requirements

### Requirement: Place info request and response
The endpoint SHALL accept `{ city, stop: { id, n, k, ll, note?, query?, aliases? | place.aliases } }` for any stop kind and SHALL end with `done.info = { summary, details, dishes, priceRange?, hours?, phone?, tips?, sources, photos, confidence }`.

#### Scenario: Missing id or name
- **WHEN** `stop.id` or `stop.n` is missing
- **THEN** the stream ends with `bad_request` "ไม่มีข้อมูลสถานที่ (stop.id, stop.n)"

#### Scenario: Non-food stop
- **WHEN** a temple is researched
- **THEN** `dishes` is `[]` and `details` describes the place

### Requirement: Web research on the fast model
Research SHALL run on the fast model at low effort with at most 3 web searches, streaming "ค้นเว็บ: “…”" and "อ่านผลค้น N หน้า"; when the API answer is not JSON it SHALL be converted with one structured-output call without tools.

#### Scenario: Fast model unavailable
- **WHEN** Sonnet 5.5 is rejected by the account
- **THEN** the call retries on the next fast model and, last, on Opus

### Requirement: Details
`details` SHALL hold `what` and up to 5 `highlights`, and MAY hold `price`, `hours`, `rating`, `booking` and `address` strings taken from the research; hours and phone are best-effort and come with the sources they were read from.

#### Scenario: Phone not found
- **WHEN** no page gives a phone number
- **THEN** `phone` is absent; the agent never invents one

### Requirement: Dishes with THB prices
Up to 6 recommended dishes SHALL carry `price` in THB per item, converted from a local price with the model's stated `rate` (THB per unit) and keeping `priceLocal: { amount, currency }`; a price that cannot be interpreted SHALL be `null`.

#### Scenario: Vietnamese price
- **WHEN** the model reports a dish at 80,000 VND with rate 0.0014
- **THEN** `price` is 112 and `priceLocal` is `{ amount: 80000, currency: 'VND' }`

#### Scenario: Local amount mislabelled as THB
- **WHEN** `price` equals the local amount and the rate is below 0.5
- **THEN** the server converts it instead of showing it as baht

### Requirement: Sources and confidence
`sources` SHALL list at most 6 pages, cited pages first, and only URLs the search actually returned; `confidence` SHALL be `web` only when at least one such source exists, else `estimate`.

#### Scenario: Nothing reliable found
- **WHEN** the search returns nothing usable
- **THEN** `confidence` is `estimate`, the step reads "ไม่พบข้อมูลที่เชื่อถือได้ ใช้ข้อมูลประมาณ", and the UI shows no "ตรวจจากเว็บ" badge

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
Server and browser normalization SHALL unwrap direct HTTPS URLs, Markdown images, Markdown links and angle-bracket URLs before storage or rendering. It SHALL reject non-HTTP(S) schemes and URLs containing credentials, and user-facing place text SHALL not display raw Markdown wrappers.

#### Scenario: Model wraps an image in Markdown
- **WHEN** a model returns `![วัด](https://images.example/wat.jpg)` for a photo
- **THEN** the API and image element use `https://images.example/wat.jpg` rather than the Markdown string

#### Scenario: Unsafe media URL
- **WHEN** a photo uses a credential-bearing URL or a non-web scheme
- **THEN** it is rejected and no image element is created for it

### Requirement: Safe page fetching
og:image pages SHALL be fetched only from public https hosts (no credentials, non-443 ports, IP literals, localhost or internal names), including after redirects, reading at most 300 KB; pages behind bot challenges SHALL yield nothing and SHALL not be worked around.

#### Scenario: Model returns an internal URL
- **WHEN** a source URL is `https://localhost/...` or `https://10.0.0.1/...`
- **THEN** it is not fetched

### Requirement: Wikimedia rate limits
The server SHALL send at most 2 Wikimedia requests at a time at least 250 ms apart, and after an HTTP 429 SHALL skip Wikimedia for 60 s so that photos come from og:image only.

#### Scenario: Busy period
- **WHEN** Wikimedia answers 429
- **THEN** photos during the next 60 s are web-only or empty

### Requirement: Place info cache
Results SHALL be cached in memory per `stop.id|n` for the server process (concurrent requests share one lookup), a hit SHALL answer with `cached: true`, and a failed lookup SHALL be evicted.

#### Scenario: Second open of the sheet
- **WHEN** the same stop is requested again
- **THEN** the step "ใช้ข้อมูลที่ค้นไว้แล้ว" is emitted and `done.cached` is true
