# Bop — frontend ↔ backend contract

This is the single source of truth between the UI work (`index.html`, `src/main.js`, `src/style.css`) and the backend/agent work (`server/`, `vite.config.js`, `src/plan.js`, `scripts/`). Change it only by agreement; if you must extend it, add fields (never rename or remove) and note it at the bottom under "Changelog".

## Ownership
| Area | Owner | Files |
|---|---|---|
| UI, onboarding, rendering, map display | UI agent | `index.html`, `src/main.js`, `src/style.css`, any new `src/ui/*` |
| Agent endpoints, Claude calls, geocoding, routing, pure plan logic | Backend agent | `server/**`, `vite.config.js`, `src/plan.js`, `scripts/**`, `package.json` deps for server |

`src/plan.js` stays DOM-free and is imported by both the browser and the server.

## Data model (unchanged shape from today's `src/plan.js`)

```ts
type LatLng = [number, number];            // [lat, lng]
type Mode = 'walk' | 'red' | 'car' | 'van'; // red = songthaew รถแดง, car = ride-hail, van = chartered van
type Leg = { m: Mode; min: number; km: number; cost: number /* THB per person */; why?: string; real?: 1 };
type Stop = {
  id: string; n: string /* Thai display name */;
  k: 'stay'|'temple'|'food'|'nature'|'market'|'sight'|'transit'|'view';
  t0: string; t1: string;                   // "HH:MM"
  ll: LatLng; cost: number; walk: number;   // walk = km walked inside the place
  open?: string;                            // "HH:MM-HH:MM"
  meal?: 'breakfast'|'lunch'|'dinner'; veg?: 1 /* has vegetarian dishes */; diet?: 1 /* every member's avoid list can eat here */; walkin?: 1;
  res?: { phone: string; by: string; ask: string };   // needs a phone reservation
  dress?: 1; outdoor?: 1; star?: string /* member id who asked for it */;
  note?: string; leg?: Leg /* travel FROM previous stop */;
  place?: { query?: string; source?: 'catalog'|'geocoded'|'model' }; // provenance (new, optional)
  src?: { url: string; title: string; checked: 'web' | 'estimate' };   // v2: what backs this stop. 'web' only if url came from a real search result; 'estimate' has url ''
};
type Day = { label: string /* "ศ. 20 พ.ย." */; short: string /* "วันศุกร์" */; date?: string /* ISO */; stops: Stop[] };
type Plan = { flags: Record<string, any>; days: Day[] };
```

### Trip setup (new — produced by the onboarding screen)
```ts
type Member = {
  id: string;                 // slug, unique, e.g. "m1"
  name: string;               // Thai or any
  role?: 'organizer';
  note?: string;              // free text: "เข่าไม่ดี", "อยากดูพระอาทิตย์ขึ้น"
  // structured constraints (UI collects, all optional):
  avoid?: string;             // allergies / foods not eaten, free text ≤120: "กุ้ง, ถั่วลิสง", "เนื้อสัตว์ (กินมังสวิรัติ)"; every meal stop must fit (diet, or veg when avoid is vegetarian)
  veg?: boolean;              // legacy: read as avoid "เนื้อสัตว์ (กินมังสวิรัติ)"
  maxWalkKm?: number;         // per day
  budget?: number;            // THB per person for the trip, excluding flights
  wants?: string[];           // must-do wishes in free text, e.g. ["พระอาทิตย์ขึ้นบนดอย"]
};
type TripSetup = {
  title: string;              // "เชียงใหม่กับแก๊งมหา'ลัย"
  city: string;               // demo: "เชียงใหม่"
  startDate: string;          // "2026-11-20"
  days: number;               // 1..5
  arrive?: { from: string; time: string };   // { from: "DMK", time: "09:15" }
  depart?: { to: string; time: string };     // { to: "DMK", time: "21:15" }
  pace?: 'chill' | 'normal' | 'packed';
  hotelArea?: string;         // "เมืองเก่า"
  stay?: { mode: 'auto' } | { mode: 'booked'; stays: { name: string; nights: number }[] }; // v16: booked stays in trip order, nights add up to days-1
  members: Member[];
  extra?: string;             // free text for the agent
};
```

### Constraint checks (generalised — backend implements in `src/plan.js`)
`checks(plan, setup)` replaces today's hard-coded `checks(plan)`. It must still return:
```ts
{
  mem: Record<memberId, { ok: boolean; txt: string }>, // one line per member, Thai
  list: { l: string; who?: string; ok: boolean }[],   // all rules, member rules first
  pass: number, total: number /* THB per person */, maxWalk: number,
  ds: { walk: number; cost: number }[]                // per day
}
```
Member rules come from the structured fields (`avoid` (legacy `veg`), `maxWalkKm`, `budget`, `wants` → a stop with `star === member.id`). System rules: opening hours, lunch + dinner every day, airport buffer ≥ 75 min before `depart.time` on the last day (skip if no depart).
`checks(plan)` with no setup must keep working for the built-in sample (use `SAMPLE_SETUP`, exported).

`src/plan.js` also exports: `SAMPLE_SETUP` (the 4 friends: มิ้น organizer + sunrise, ปาล์ม avoid เนื้อสัตว์ (กินมังสวิรัติ), โอ๊ต maxWalkKm 3, ฝน budget 5000), `BASE`, `SCEN` (offline demo scenarios, valid only on the sample plan), `schedule(plan, routes)`, `diff`, `clone`, etc. — everything exported today keeps its name.

## Endpoints

All agent endpoints stream **NDJSON** (`Content-Type: application/x-ndjson`): one JSON object per line. The UI reads lines as they arrive and shows `step` events live (the agent trace). Exactly one terminal event: `done` or `error`.

Common events:
```ts
{ type: 'step', text: string }                         // Thai, short, shown in the agent trace
{ type: 'error', code: 'no_key'|'auth'|'rate_limit'|'upstream'|'bad_request'|'refusal', message: string /* Thai */ }
```

### `GET /api/health`
`{ ai: boolean, claude: boolean /* legacy alias of ai */, provider: 'openai' | 'api' | 'subscription' | null, model: string, fastModel: string, search: boolean }`
Provider order: `BOP_PROVIDER` when set; otherwise OpenAI service-account key → OpenAI Responses API, then `ANTHROPIC_API_KEY` → Anthropic (`api`), then the logged-in local Claude CLI → `subscription`.

### `POST /api/plan` — build a full itinerary from the onboarding setup
Request: `{ setup: TripSetup }`
Terminal event:
```ts
{ type: 'done', plan: Plan /* scheduled with real routes */, routes: Record<string, { geom: [number,number][] }>,
  summary: string /* 1–2 Thai sentences */, ms: number, usage?: {...} }
```
`routes` keys use `legKey(a, b, mode)` from `src/plan.js`; the UI merges them into its route table for drawing.

### `POST /api/replan` — natural-language change or disruption
Request: `{ setup: TripSetup, plan: Plan, command: string, day?: number /* the day the UI is showing */ }`
Terminal event:
```ts
{ type: 'done', summary: string, day: number /* day most affected, 0-based */,
  needs_vote: boolean, vote_reason?: string,
  options: { key: 'A'|'B'|'C'; title: string; head: string; line: string /* LINE group message */; plan: Plan }[],
  routes: Record<string, { geom: [number,number][] }>, ms: number, repaired?: boolean }
```
If `needs_vote` is false there is exactly one option and the UI applies it immediately (with undo). If true, the UI shows the options for the group to vote.
Rules the agent follows: change only the affected part (minimal change); keep stops whose reservation is marked done unless impossible; ask for a vote only for a real trade-off (breaks someone's constraint, adds > ฿300 per person, or drops a starred wish).

### `POST /api/place-info` — research a restaurant (or any stop) for the demo
Request: `{ city: string, stop: { id: string, n: string, k: string, ll: LatLng, note?: string } }`
Terminal event:
```ts
{ type: 'done', info: {
    summary: string,                                   // Thai, one line
    dishes: { name: string; price: number | null /* THB */; veg?: boolean; why?: string }[], // 3–6 recommended
    priceRange?: string,                               // "฿80–150 ต่อคน"
    hours?: string, phone?: string,
    tips?: string[],
    sources: { title: string; url: string }[],
    confidence: 'web' | 'estimate'                     // 'estimate' when nothing reliable found
  }, ms: number }
```
Cached server-side per `stop.id + n` for the session.

### `POST /api/weather-check` — live rain alerts for exposed stops (no model, no key)
Request: `{ setup: TripSetup, plan: Plan }`. Works even when `/api/health` reports `claude:false`.
Checks stops with `outdoor` or kind `nature`/`view`, grouped by coordinates rounded to 2 decimals and date, against Open-Meteo's hourly forecast (`api.open-meteo.com`; `customer-api.open-meteo.com` with `apikey` when `OPEN_METEO_API_KEY` is set server-side). Open-Meteo hourly values describe the preceding hour, so the value at 15:00 covers 14:00–15:00.
Terminal event:
```ts
{ type: 'done', source: 'open-meteo', horizon: { from: ISODate, to: ISODate },   // today .. today+15
  reason?: 'no_exposed' | 'beyond_horizon' | 'unavailable' | 'partial_horizon',
  checked?: number,
  alerts: { stopId: string; n: string; day: number /* 0-based */; date: ISODate;
            level: 'heavy' | 'likely'; from: 'HH:MM'; to: 'HH:MM'; mm: number /* max mm/h */; prob: number /* % */;
            trend: boolean /* > 3 days out */; source: 'open-meteo'; fetchedAt: string }[] }
```
Levels (constant `RAIN` in `server/weather.mjs`): `heavy` = any hour ≥ 2.5 mm, or ≥ 70 % with ≥ 1 mm; `likely` = ≥ 50 % with ≥ 0.5 mm.
Cache `server/.cache/weather.json` per `lat,lng|date`: 1 h within 48 h, else 3 h. Two failures or one HTTP 429 skip Open-Meteo for 10 min (`reason:'unavailable'`).
UI: strongest alert of the selected day, "ให้ Bop ปรับแผน" (hidden for a `likely` trend), "ไม่เป็นไร", and the credit "ข้อมูลอากาศ: Open-Meteo.com" (CC BY 4.0). The tap sends `/api/replan` with e.g. "พยากรณ์ฝนตกหนัก 14:00–16:00 วันที่ 2 ที่น้ำตกบัวตอง (โอกาส 80% ~4 มม./ชม.) ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม". The offline sample keeps the simulated rain scenario.

### Flights: `POST /api/flights/offer` · `/api/flights/order` · `/api/flights/cancel` (Duffel, no model)
Enabled when `DUFFEL_ACCESS_TOKEN` is set server-side (`duffel_test_…` = test mode, no money; `duffel_live_…` searches, booking needs `BOP_FLIGHT_BOOKING=1`). `/api/health` adds `flights: { mode: 'test'|'live', booking: boolean } | null`.
- Search: `/api/transport-options` and `/api/plan` try Duffel first for `by: 'flight'` (one-way offer request per direction, one adult per member, economy, max 1 connection). Options gain `checked: 'live'`, `bookable: true`, `offerId`, `expiresAt`, `priceLocal`, `cond`, `stops`, `durMin`, `test`. `price` is THB per person (Frankfurter ECB rate, fixed table fallback). No token, an error or no offers falls back to web search; for `by: 'undecided'` live flights replace the web flights and buses/trains stay.
- `offer` `{ offerId }` → `done { mode, bookable, offer: { id, expiresAt, total:{amount,currency,thb}, carrier, code, from, to, departingAt, arrivingAt, passengers:[{id,type}], idDocsRequired, instantOnly, payBy, conditions, bag }, services: [{ id, kind:'bag', label, price:{amount,currency,thb}, maxQty, passengerIds }] }`.
- `order` `{ offerId, passengers:[{ id, title, given_name, family_name, born_on, gender, email, phone_number }], services:[{id,quantity}], hold, approved:{amount,currency} }` → re-fetches the offer; if the total with services differs from `approved` → `error { code:'price_changed', total }`. Otherwise ONE Duffel order (instant: `payments:[{type:'balance'}]`; hold when allowed). Never retried. → `done { order: { orderId, bookingReference, mode, type, total, currency, totalTHB, payBy } }`; the UI stores it in `plan.flags.transport.<go|back>.order`.
- `cancel` `{ orderId }` → `done { quote: { cancellationId, refund, refundTo, expiresAt } }`; `{ orderId, confirm: cancellationId }` → `done { cancelled }`.
- Errors: `not_enabled`, `offer_expired`, `price_changed`, `bad_request` (passenger validation, passport-required fares), `auth`, `upstream`, `rate_limit` (`BOP_DUFFEL_DAILY_SEARCHES`, default 200).
- Passenger data is sent once to Duffel and not stored. AWS stores only non-PII order audit and idempotency records in DynamoDB with TTL. Not yet: seat maps, passport fields, webhooks, SerpApi price-only options, live payment capture.

### LINE group messaging and votes
- `GET /api/config` → `{ enabled, liffId }`; only the public LIFF identifier is returned.
- `POST /api/trips` with `{ setup, summary }` creates a 30-minute link code and returns `{ tripId, organizerToken, linkCode, codeExpiresAt }`. The organizer token is returned once and sent later in `X-Bop-Trip-Token`.
- `GET|DELETE /api/trips/:tripId` reads or deletes the organizer's trip/LINE state.
- `POST /api/trips/:tripId/plan` with `{ summary }` stores and, when linked, posts the plan summary.
- `POST /api/trips/:tripId/post` with `{ text }` posts a signed Bop task, alert or applied replan message.
- `POST /api/trips/:tripId/vote` starts a vote and pushes a Flex Message; `GET .../vote` polls ballots; `POST .../vote/close` lets the organizer resolve or close it.
- `POST /api/line/webhook` verifies `x-line-signature` over the exact raw body before processing link codes, group lifecycle events and postback ballots. Invalid signatures return 401.
- `POST /api/trips/:tripId/identity` verifies a LINE ID token and maps the LINE user to one trip member. `POST .../vote/ballot` records a LIFF ballot.
- DynamoDB stores only hashed organizer tokens, LINE identity mappings and ballots. Link codes expire after 30 minutes; webhook dedupe and idempotency records after 24 hours; LINE trip data 30 days after the trip ends.

## Credentials & model
- Deep tier: Anthropic `claude-opus-5-5` or OpenAI `gpt-6.2-astra`.
- Fast tier: Anthropic Sonnet → Haiku; OpenAI `gpt-6.2-sol` → `gpt-6-luna`.
- Keys: `OPENAI_API_KEY`/`OPENAI_APIKEY` and `ANTHROPIC_API_KEY` are read server-side only. Local development uses ignored `.env.local`; AWS Lambda resolves the KMS-encrypted Secrets Manager document at runtime.
- No key → `/api/health` reports `ai:false` and `claude:false`; agent endpoints return `{type:'error', code:'no_key'}`; the UI falls back to the built-in sample plan + offline scenarios.

## Run
- Dev: `npm run dev` (Vite + API middleware on the same port).
- Prod: `npm run build && npm start` (`server/index.mjs` serves `dist/` + `/api/*`).

## Changelog
- v1 (2026-11-08): initial contract.
- v2 (2026-11-08, backend):
  - `/api/health` adds `provider`.
  - `Stop.src` added (web verification + source link). `/api/plan` and `/api/replan` may web-search (≤5 / ≤3 searches) and stream each search as a `step` ("ค้นเว็บ: “…”").
  - `done` events of all three endpoints may also carry `timing` (ms per phase); `/api/plan` adds `repaired: boolean`; `/api/place-info` adds `cached: true` on cache hits. `usage` may contain `provider: 'subscription'`.
  - `Stop.res.phone` may be `""`: the agent never invents phone numbers.
  - With `provider: 'subscription'` and the CLI logged out, agent endpoints return `error` code `auth` (not `no_key`).
  - `SAMPLE_SETUP.members[0].wants = ['ดูพระอาทิตย์ขึ้น']`, so that check's label is "ดูพระอาทิตย์ขึ้น". Member `note` holds only extra context, never a repeat of a structured field.
  - `src/plan.js` new exports: `SAMPLE_SETUP`, `explain`, `CATALOG`, `applyEdits`, `buildPlan`, `stopFromSpec`, `fixLegs`, `priceLegs`, `planBrief`, `dayLabel`, `haversine`, `legCostEstimate`, `findStop`, `uniqueId`, `KINDS`, `MODE_KEYS`, `legMinEstimate`. All earlier exports are unchanged.
- v3 (2026-11-08, UI): trip setup additions requested by the owner. All fields are additive.
  - `TripSetup.endDate?: string` (ISO). The UI collects start and return dates. `days` is still sent and equals the inclusive day count between them (1–7). Clamp `days` to 7, not 5.
  - `TripSetup.country?: string` (ISO 3166 alpha-2, e.g. `"JP"`) and `currency?: string` (ISO 4217, e.g. `"JPY"`). The UI fills these from its city suggestions (เชียงใหม่ ภูเก็ต กระบี่ โตเกียว โอซาก้า โซล ไทเป ฮ่องกง สิงคโปร์ ดานัง); `city` stays free text. All prices the UI shows are THB (`cost`, `leg.cost`, `budget`). Optional `priceLocal` is passed through but not displayed yet.
  - Travel to and from the destination no longer assumes a flight:
    `arrive: { by: 'flight'|'drive'|'bus'|'train'|'undecided', from: string, time?: string }`. `time` is the arrival time at the destination, except for `'drive'`, where it is the departure time from home. It is omitted for `'undecided'`.
    `depart: { by: same, to: string, time?: string }`. `time` is the departure time from the destination.
    For flights, `from`/`to` hold airport codes (e.g. `"DMK"`). For other modes they hold a place name (default `"กรุงเทพฯ"`). With `'undecided'`, the agent proposes how to get there.
    A missing `by` means `'flight'` (old setups).
  - `TripSetup.hasCar?: boolean`. The group has its own car for the whole trip. Defaults to true when either direction is `'drive'`.
  - New leg modes the UI renders: `transit` (Thai label "รถไฟ/รถไฟฟ้า", dashed line, `--m-transit`) and `own` (own car, "รถส่วนตัว", `--m-own`). Map geometry for these comes from the `routes` you return. The UI has no OSRM profile for `transit`, so without geometry it draws a straight line.
  - Long legs (≥ 100 km, e.g. the drive from the origin as the first leg): the UI widens the map to fit the whole route geometry. If present, it shows rest stops from `leg.rest?: string | string[]` (also accepts `leg.breaks`) as "แวะพัก: …".
  - The map legend lists only the modes the plan uses.
- v4 (2026-11-08, UI): setup fields for "Bop finds the flight/bus/train". The `POST /api/transport-options` endpoint itself is specified by the backend.
  - `arrive.auto?: boolean`, `depart.auto?: boolean`. Only for `by` in `flight|bus|train`; true means "ให้ Bop หาให้". The UI turns it on by default when no time is entered; the sample keeps fixed times and has `auto` off. When `auto` is true, `time` is optional.
  - `arrive.choice?`, `depart.choice?`: the option object the user picked from `/api/transport-options`, passed back unchanged (`{id,by,carrier,code?,from,to,dep,arr,price,bag?,src,checked,recommended?,why?}`). Picking one also sets `arrive.time = choice.arr` plus `arrive.from = choice.from`, or `depart.time = choice.dep` plus `depart.to = choice.to`.
  - `auto` true with no `choice` means the user skipped the picker: `/api/plan` searches itself and returns `plan.flags.transport = { go?: { chosen, options }, back?: { chosen, options } }`.
  - Request the UI sends: `{ setup: TripSetup, dir: 'go'|'back' }`. It reads `step` events and then `done.options` (it shows every option it gets; please return 3–5).
  - Planner: the bookings tab shows `flags.transport[go|back].chosen` (or `setup.*.choice` when there is no `flags.transport`). "เปลี่ยนเที่ยวบิน" lists the other options. Picking one updates `setup.arrive|depart.choice/time` and sends `/api/replan` with a command like `"เปลี่ยนเที่ยวบินขาไปเป็น Nok Air DD8302 ออก 08:00 ถึง 09:15"`. The replan should keep `flags.transport` updated (`chosen` = the new option).
- v4 (2026-11-08, backend):
  - Implements v3. `days` is clamped to 1–7 (from `endDate` when given). `hasCar` defaults to true when either direction is `drive`. A missing `by` with a `time` means `flight`; without a time it means `undecided`.
  - Rest stops on long drives are real `Stop` entries (kind `transit` or `food`, mode `own`), so they appear on the map. The backend does not emit `leg.rest`.
  - Legs: `leg.src?: { url, title, checked: 'web'|'estimate' }` backs the leg's time or fare. `leg.minSrc?: 'web'` means `leg.min` came from the web (transit line ride time). `schedule()` keeps those minutes for `transit` legs and otherwise estimates transit at 25 km/h plus 8 min. Road legs (`walk/red/car/van/own`) are always timed by OSRM. Editing a leg's origin drops `minSrc` and downgrades `src` to `estimate`.
  - `leg.extra` (internal, number): parking and tolls per person for `own` legs. `leg.cost` = fuel (฿4/km for the car, split per person) + `extra`. `leg.auto` (internal): the server priced this leg.
  - `Stop.priceLocal?: { amount: number, currency: string }`. `cost` stays THB, and the plan `summary` states the exchange rate used.
  - `plan.flags.arrivalSuggested?: { by: 'flight'|'bus'|'train'|'drive', why: string }` when a direction was `undecided`.
  - `plan.flags.transport?: { go?: { chosen: string /* option id */, options: TransportOption[] }, back?: {...} }` when `/api/plan` searched flights, trains or buses itself (`by` set but `time` empty). The first and last stops use the chosen option's arrival and departure times.
  - `checks()` departure rules depend on `by`: flight ≥ 75 min before (label "ถึงสนามบินก่อนไฟลต์ N นาที"); bus/train ≥ 30 min ("ถึงสถานีก่อนรถออก/รถไฟออก N นาที"); drive: "ถึงบ้านไม่ดึกเกิน 22:00" (only if the drive home is modelled as an `own` leg ≥ 50 km) and "ขับรถไม่เกิน 8 ชม./วัน".
  - New endpoint `POST /api/transport-options`. Request `{ setup: TripSetup, dir: 'go'|'back' }`. It uses web search only and streams steps such as "ค้นเที่ยวบิน DMK → เชียงใหม่ ศ. 20 พ.ย." and "ค้นเว็บ: “…”". Terminal event:
    `{ type:'done', options: TransportOption[], ms, usage? }` with
    `TransportOption = { id: 'go-1', by: 'flight'|'bus'|'train', carrier, code?, from, to, dep: 'HH:MM', arr: 'HH:MM', price: number|null /* THB per person, web estimate */, bag?, src: { url, title }, checked: 'web'|'estimate', recommended?: true, why? }`.
    Exactly one option is `recommended`. `checked:'web'` only if `src.url` was really returned by the search; otherwise `src.url` is `""`. A `drive` direction returns `bad_request`.
  - Web search caps per `/api/plan`: 5, plus 3 outside Thailand, plus 2 when a direction is undecided (max 8). Each transport search makes up to 4 more. Search `user_location` follows the geocoded destination country.
- v5 (2026-11-08, backend), following "v4 (UI)":
  - `arrive.auto` / `depart.auto` = true makes `/api/plan` search that direction even when `time` is set. `arrive.choice` / `depart.choice` (a `TransportOption`) is used as given, without a search, and becomes `flags.transport.<dir> = { chosen: choice.id, options: [choice] }`.
  - In `/api/plan`, the transport search runs in parallel with the itinerary design. The design uses placeholder times (arrive 10:00, depart 20:30). Afterwards the first stop is set to the chosen arrival time and the last stop to departure − 90 min (flight) or − 40 min (bus/train). If that breaks a rule, the repair round fixes it.
  - `/api/replan` handles a changed flight, train or bus (e.g. "เปลี่ยนเที่ยวบินขาไปเป็น Nok Air DD8302 ออก 08:00 ถึง 09:15"). Every option plan gets `flags.transport.<dir>.chosen` pointing at the matching option (matched by code, else by carrier + dep). An unknown option is appended with `checked:'estimate'`. The first or last stop is re-timed. The `done` event then also carries `setup` (the TripSetup with updated `arrive`/`depart` times), which the UI should store so that `checks()` uses the new times.
- v6 (2026-11-08, backend), owner feedback round 2:
  - All user-facing text (steps, summaries, errors, LINE messages) says "Bop", never "Claude". The prompts tell the model to call itself Bop. `/api/health` still returns `provider`/`model` for the UI to hide.
  - `walkin` and `res` exist only on `k:'food'` stops, or on `k:'market'` stops that have a `meal`. The server strips them from every other stop. A wish about timing or the journey (e.g. "ถึงเวียดนามตอนเช้า") is satisfied by starring the stop that fulfils it, e.g. the arrival stop.
  - `/api/place-info` works for every stop kind. The request `stop` may also carry `query` or `place.query` (English/OSM name, improves photos). New fields in `info`:
    `details: { what: string, highlights: string[], price?, hours?, rating?, booking?, address? }` and
    `photos: { url, thumb?, credit, source: 'wikimedia'|'web', page }[]` (0–4 items).
    Photos come from Wikipedia/Commons first, matched by name and nearby coordinates (credit "author · licence · Wikimedia Commons"), then from the `og:image` of the source pages (credit = site host). Every URL is https; there are no data: URLs. `dishes` is `[]` for non-food stops. Results are cached per `stop.id|n`.
  - `TripSetup.autonomy?: 'auto'|'ask'` (default 'auto'). New endpoint `POST /api/plan/candidates` with request `{ setup }`. It makes up to 5 web searches and streams steps. Terminal event:
    `{ type:'done', questions: { id, kind:'food'|'sight'|'stay', title, multi:true, options: { id, name, why, tags: string[], price?, ll?: [lat,lng], photo?: { url, credit, page }, src?: { url, title } }[] }[], ms }`.
    Option ids are unique per server run (`c<run>_<slug>`), and the server remembers them.
  - `TripSetup.picks?: { must: Option[], avoid: string[] /* option ids (names also accepted) */ }`. `/api/plan` pins must-picks to their `ll` (`place.source: 'pick'`, a new value), streams "ใส่ที่ที่กลุ่มเลือก N/M แห่ง", treats a missing must-pick or a present avoided place as a problem for the repair round, and repairs it.
  - Coordinates: every stop's `ll` is two finite numbers and never `[0,0]`. A stop the server cannot place gets the previous stop's or the city centre's coordinates. `routes` keys always equal `legKey(prev.ll, stop.ll, leg.m)` for every leg in `allLegs(plan)`. When OSRM is unreachable, the route is a straight line `{ geom: [[lng,lat],[lng,lat]], approx: true }`, so the map can still draw it (`schedule()` keeps the estimate for those legs).
  - Fake model for UI work: `BOP_FAKE_LLM=1 npm run dev` (or `BOP_FAKE_LLM=1 PORT=8787 npm start`). A setup whose `city` matches ดานัง/Da Nang returns a fixed N-day Da Nang plan with real places, and `/api/plan/candidates` returns fixed Da Nang options. Geocoding, routing, photos and checks are real.
  - Photo note: Wikimedia rate-limits anonymous API clients. The server sends at most 2 Wikimedia requests at a time, ≥ 250 ms apart. After a 429 it skips Wikimedia for 60 s and uses `og:image` only, so `photos` may be empty or web-only during busy periods. `og:image` pages are fetched only from public https hosts (no localhost, IP literals or internal names), including after redirects.
- v6 (2026-11-08, UI): what the UI sends and reads for owner feedback round 2.
  - The UI never shows the model's name. As a defensive measure, every string in every NDJSON event is passed through `/Claude|Anthropic/gi → "Bop"`, except the keys `url`, `page`, `href`, `model` and `id`. Please keep "Bop" in step texts anyway.
  - `TripSetup.autonomy?: 'auto'|'ask'` (default `'auto'`). In `'ask'` mode the UI first calls `POST /api/plan/candidates` with `{ setup }` and reads `done.questions: [{ id, kind, title, options:[{ id, name, why?, tags?, price? (string or THB number), photo?:{url,credit?,page?}, src?:{url,title} }] }]`. It falls back to `done.candidates[]` grouped by `group|cat|k`. Questions are shown one at a time, and each option is answered สนใจ / ไม่เอา / ไม่แน่ใจ. The UI then calls `/api/plan` with `setup.picks = { must: Option[] /* สนใจ, the full option objects */, avoid: string[] /* ids answered ไม่เอา */ }`. "ไม่แน่ใจ", skipped questions and "ให้ Bop เลือกที่เหลือเอง" put nothing in `picks`.
  - Place details sheet: a click on any stop or map marker opens it and calls `/api/place-info` once per `stop.id + n` (cached for the page). The UI reads `info.photos[] {url, credit?, page?, alt?}` (http(s) only, lazy-loaded) and `info.details {what, highlights[], price, hours, rating, booking, address}`, plus `summary`, `dishes` (food stops only), `tips`, `sources`, `confidence`, and the stop's own `src`. "ตรวจจากเว็บ" is shown when `confidence === 'web'` or `stop.src.checked === 'web'`.
  - Walk-in / call-to-reserve is rendered only for `k === 'food'` or a `market` with `meal`. `res` on any other kind is ignored.
  - Replan vote: an option may carry `places?: Option[]` (same shape as a candidate). If it does, the UI shows them as photo cards under that option.
  - Map robustness: `Stop.ll` may arrive as `[lat,lng]`, `{lat,lng}` or `"lat,lng"`, and swapped pairs are fixed. Stops without valid coordinates stay in the list but are left off the map. Route `geom` given as `[lat,lng]` is detected and flipped. Please still send `[lng,lat]`.
- v7 (2026-11-08, backend), stricter photo matching:
  - Every photo now carries `match: 'exact'|'likely'`, and photos are sorted exact first. `/api/plan/candidates` `photo` also carries `match`.
  - `exact` (Wikimedia): the Wikipedia article's title or its Wikidata label/alias (any language) matches the stop name, `query` or `aliases` after normalising case, diacritics and đ. The item's coordinates must also be within 1.5 km of `stop.ll` (3 km for sight/nature/market/area). The image is the item's Wikidata P18. The article lead image is used only if its file name also names the place. Lead images of broader or related articles are never used. A stop without `ll` gets no Wikimedia photo.
  - `likely` (og:image): only from pages whose `<title>`, `og:title` or URL path names the place. Logos, icons, avatars, placeholders, banners, SVGs and images declared smaller than 300 px are skipped.
  - Optional `aliases: string[]` (other names: local language, Thai, English). The model now returns it on stop specs, where it is stored as `stop.place.aliases`, and on candidate options. `/api/place-info` accepts `stop.aliases` or `stop.place.aliases`.
- v8 (2026-11-08, backend), resilient routing:
  - Each leg tries OSRM (routing.openstreetmap.de), then Valhalla (valhalla1.openstreetmap.de, `auto`/`pedestrian`), then a straight line with `approx:true`. A provider that fails twice, or returns HTTP 429, is skipped for 10 min. Legs are fetched 3 at a time, with a 120 ms gap per worker. Geocoding goes Photon → Nominatim (max 1 req/s, at most 8 lookups per request) with the same breaker.
  - Routes, geocodes (including "searched, no match" answers) and city lookups persist in `server/.cache/*.json` (git-ignored). `src/routes.json` seeds the route cache, so the Chiang Mai sample needs no network. A repeated plan for the same places makes no routing calls.
  - **The server always returns geometry for every leg.** `routes` holds an entry for every `legKey` in `allLegs(plan)` of each returned plan, from `/api/plan` and from every `/api/replan` option. A straight-line entry carries `approx: true`. The browser does not need to call OSRM itself.
  - The step line names the source, e.g. "คำนวณเส้นทางจริง 28 ช่วง · Valhalla 4 · แคช 24".
- v9 (2026-11-08, backend), faster long trips:
  - Trips of 3 or more days (`BOP_SPLIT_MIN_DAYS`, default 3) are designed in two stages. First a skeleton call (no search, low effort) sets day themes, the area per day, the hotel, which day covers each wish, the meals and the main places. Then one design call per day runs in parallel (`BOP_DAY_CONCURRENCY`, default 3), with up to 2 searches each. Each call gets the skeleton, the setup, that day's budget share and walking cap, and the places already used on other days. Stop ids are prefixed `d<N>_`. A place that still repeats across days goes to the repair round, which then gets only the failing days' stops and is told not to touch the others (budget failures still send the whole trip).
  - New streamed event while `/api/plan` runs (split mode only): `{ type:'day', index: number /* 0-based */, day: Day, routes: Record<legKey,{geom, approx?}> }`. It is sent as soon as that day is designed, geocoded, routed and scheduled. Days can arrive out of order. The day's first and last stops still use placeholder times when Bop is also searching flights, so the final `done` event (unchanged shape, full plan) is authoritative and replaces everything. `done.timing` adds `skeleton`, `firstDay` (ms from request start to the first `day` event) and `days`.
  - Trips of 1–2 days keep the single design call. Measured on 3 days: the split took 62 s with the first day at 45 s, against 76–89 s for the single call.
- v10 (2026-11-08, UI): round 3 and the stay choice.
  - `TripSetup.stay = { mode:'auto' } | { mode:'booked', name: string }`. The UI always sends `stay` and no longer sends `hotelArea`; keep reading `hotelArea` from older setups. With `'auto'`, Bop picks the area (least travel, fits budget). With `'booked'`, `name` is a hotel name or address to geocode, and every day starts and ends there.
  - The UI reads `plan.flags.stay?: { area?: string, name?: string, why?: string, options?: [{ name, area?, price?: number /* THB per night */ | string, src?: {url,title} }] }`. The bookings tab shows area + why + up to 3 `options` (or "จองไว้แล้ว: name"), the header shows "พักย่าน{area}" / "พักที่ {name}", and the details sheet of `k:'stay'` stops shows `why` under "ทำไมพักที่นี่". The stay stop itself should be a normal `k:'stay'` stop with `ll` so `/api/place-info` can add photos and a price range.
  - Routing: the browser no longer calls OSRM. It draws `routes[legKey]` (or `src/routes.json`) and a straight line when there is nothing. Entries with `approx: true` (and missing legs) are drawn dashed and faded with the tooltip "เส้นทางโดยประมาณ", and the leg row says "เส้นทางโดยประมาณ" instead of "ตามถนนจริง".
  - Progressive planning: during `/api/plan` the UI handles `{ type:'day', index, day, routes }`. It normalises the day, merges `routes`, draws all days received so far on the map, and lists "วันที่ N พร้อมแล้ว" under the step trace. On `done` it switches to the planner with the full plan.
  - Photos: ordered exact first; `match:'likely'` shows a "รูปจากเว็บ" badge (sheet strip and candidate cards).
  - Setup title: until the user edits it, the title follows the destination (`"เชียงใหม่กับแก๊ง…"` → `"ดานังกับแก๊ง…"`, else `"ทริป{city}"`).
- v10 (2026-11-08, backend), stay:
  - `setup.stay = { mode:'auto' } | { mode:'booked', name }`. The default is auto; `hotelArea` is still accepted and passed through.
  - booked: the server geocodes `name` before design, also trying shorter forms of the name (step "ที่พักที่จองไว้: … · พบบนแผนที่ / ใช้พิกัดประมาณ"). Every hotel stop in the destination is pinned to that name and those coordinates (`place.source:'pick'`). The home stop of a drive is left alone. No hotel search is made.
  - auto: the model (the skeleton for split trips, the single call otherwise) picks the stay area that minimises travel and fits the budgets, with at most 1 search for example hotels. The first example becomes the hotel stop.
  - `plan.flags.stay = { area, why, booked?: true, examples: { name, priceNight: number|null /* THB per room per night */, src: { url, title }, checked: 'web'|'estimate', ll?: [lat,lng] }[] }`. `checked:'web'` only if `src.url` came from a real search result.
  - The stay's cost per person (priceNight × nights ÷ people per room, 2 by default) sits on the first hotel stop's `cost`, so the budget check includes it.
- v11 (2026-11-08, backend), photos for every card, plus a fast model:
  - Candidate options and place-info get photos in confidence order:
    1. Wikimedia exact match (v7 rule).
    2. og:image of the place's own page. The model returns `photoPage`, a page about that place alone, kept separate from `src`, which may be a list page.
    3. og:image of the `src` page.
    4. Commons files taken within 300 m whose title contains a distinctive word of the name (`likely`).
    5. For options still without a photo: one cheap search per option for the place's own pages, at most 6 per request, run in parallel.
  - og:image rules: no logos, icons, placeholders or generic share images (`og-generic`). Images on a different host (CDNs) are allowed. Pages behind bot challenges (e.g. Michelin's AWS WAF) give nothing and are not worked around.
  - `photoPage` itself is not returned; a photo's `page` is the page its image came from.
  - Fast model: `/api/place-info`, `/api/transport-options` and the photo-page searches use `fastModel` (env `BOP_FAST_MODEL`, default order `claude-sonnet-5-5`, then `claude-haiku-5-5`) at low effort. A model that errors is skipped, with Opus as the last resort. Plan, replan, skeleton, the per-day calls and the candidates call stay on `claude-opus-5-5`. `/api/health` adds `fastModel`.
  - Dish `price` must be THB. Values above 3,000 (almost certainly local currency) become `null`.
- v12 (2026-11-08, backend):
  - Candidates photos: every option still missing a photo gets one cheap page search (fast model, 4 at a time, no fixed cap). Stay areas search for the area itself, e.g. the beach.
  - The main `/api/plan/candidates` call now runs on `fastModel` (Sonnet 5.5) at low effort. Opus stays for plan design, the skeleton, the day calls, repair and replan.
  - Place-info dishes: `price` is THB, converted from the local price with the model's stated `rate` (THB per unit). Each dish may carry `priceLocal: { amount, currency }`. A price is `null` only when it cannot be interpreted. This replaces the v11 "> ฿3,000 → null" rule.
- v13 (2026-11-08, backend), open days:
  - `Stop.days?: { closed?: Weekday[], only?: Weekday[], hours?: Record<Weekday,'HH:MM-HH:MM'> }` and `Stop.closures?: { date:'YYYY-MM-DD', why?: string }[]`, with `Weekday = 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'`. `open` stays the default hours, and `days.hours[weekday]` overrides it on that weekday.
  - New system rule in `checks()`: **"เปิดวันที่ไป"**. Each stop's trip day (`setup.startDate` + day index) must not be in `closed`, must be in `only` when `only` is set, and its date must not be in `closures`. Failure reasons look like "Shamballa ปิดวันจันทร์ (วันที่ 2, …)". The rule list therefore has one more entry: the sample is now 8/8. The rule triggers the repair round in `/api/plan` and `/api/replan`.
  - The model returns `closedDays`, `onlyDays` and `closures` for every sight, food, market, nature and view stop. When these come from a web page, `stop.src` points to that page.
  - Chiang Mai sample: Wua Lai `only:['sat']`, Jing Jai `only:['sat','sun']`, Sunday walking street `only:['sun']`.
  - Exports added to `src/plan.js`: `WD`, `tripDay`, `closedWhy`, `openOn`. `npm test` runs `scripts/test-closed.mjs`.
- v13 (2026-11-08, UI): opening days.
  - The UI reads `stop.days = { closed?: string[], only?: string[], hours?: Record<'mon'..'sun', 'HH:MM-HH:MM'|null> | string }` and `stop.closures = [{ date: ISO, why? }]`. A plain string instead of an array is also accepted. A day's date is `day.date`, else `startDate + index`.
  - Stop row: a muted label ("เปิดเฉพาะวันอาทิตย์", "ปิดวันจันทร์", "ปิด 25 ธ.ค. (คริสต์มาส)"; closures only when they fall inside the trip). When the planned date breaks a rule, the row shows it in red ("วันจันทร์ปิด"). The day picker gets a red dot on days with such a stop. The details sheet facts add "วันเปิด" and "รายวัน" (hours grouped by consecutive weekdays, `null` = ปิด).
- v14 (2026-11-08, reconciliation after the OpenSpec review):
  - `GET /api/city?q=` → `{ name, cc, ll }` or 404 `{error:'not_found'}`. Plain JSON, not NDJSON. The UI uses it to label destinations that are not in its suggestion list (country, currency).
  - Replan reservations: the UI now marks booked restaurants as `stop.res.done = true` in the plan it sends to `/api/replan`. `planBrief` shows them to the model as "จองแล้ว(done)", and the model keeps them unless impossible.
  - Candidate photo-page searches run 6 at a time (not 4).
  - City lookup order is Nominatim → Photon (Nominatim handles Thai names of foreign cities). Place lookups stay Photon → Nominatim.
  - Models: plan design, skeleton, day calls, repair and replan use `claude-opus-5-5`. Place info, photo pages, transport options and candidates use `FAST_MODEL` (`BOP_FAST_MODEL`, default `claude-sonnet-5-5`, then `claude-haiku-5-5`). Without any credential, agent endpoints return `{type:'error', code:'no_key'}`.
  - `BOP_*` tuning variables in `.env.local` now take effect: both `vite.config.js` and `server/index.mjs` copy them into `process.env`.
  - Airport buffer: the prompt asks the model for 90 min before a flight, and `checks()` fails below 75 min. The 15 min gap is a deliberate safety margin.
- v15 (2026-11-09, add-live-weather):
  - `POST /api/weather-check` (above): Open-Meteo rain alerts, no model and no key. The UI calls it after a plan loads and after each applied replan.
  - Optional `OPEN_METEO_API_KEY` in `.env.local` switches to the commercial host; copied into `process.env` like `BOP_*`.
  - `npm test` also runs `scripts/test-weather.mjs` (recorded-shape responses: heavy, likely, none, cache, beyond horizon, trend, API down, breaker, commercial key).
- v16 (2026-11-09, add-multi-stay): booked stays that differ by night.
  - `TripSetup.stay = { mode:'auto' } | { mode:'booked', stays: { name: string, nights: number }[] }`. Stays are in trip order; the first starts on night 1, and the nights add up to `days - 1` (a 1-day trip has 0 nights; one stay with `nights: 0` is a base for the day). The old `{ mode:'booked', name }` is still accepted and means one stay for every night. The server repairs sums that do not add up (the last stay takes the rest or gives nights back from the end), drops blank names and ignores client coordinates.
  - Server: every stay is geocoded (same name-shortening fallbacks as before, plus a 200 km radius around the city for stays in another town, e.g. เชียงใหม่ + ปาย). Day 1 starts at the arrival point and ends at the hotel of night 1; day i starts at the hotel of night i-1 and ends at the hotel of night i; the last day starts at its hotel and ends at departure. On a move day the start hotel stop carries a check-out note ("เช็กเอาต์ ขนกระเป๋าไป…"). Hotel stops the model returns are pinned to that day's hotels (by name, else first stop = start hotel, else nearest), and a missing start/end hotel stop is added. The model sees the per-day hotels as `TripSetup.stayPlan: string[]` (plan, skeleton, day calls, repair, replan) and in `planBrief` day headers ("ที่พัก: เริ่มวันจาก … → นอนที่ …"). Replans pin inserted/replaced hotel stops the same way. Auto mode is unchanged.
  - `plan.flags.stay` for booked stays: `{ booked:true, why, name /* first stay */, examples: { name, priceNight, src, checked, ll? }[] /* one per stay */, stays: { name, nights, checkIn: ISO, checkOut: ISO, priceNight, src, checked, ll? }[] }`.
  - UI: the setup screen lists booked stays (name + nights, "+ เพิ่มที่พัก", remove), shows each row's dates and the running total, and blocks planning with a Thai message when the nights do not add up. The bookings tab lists each stay with its nights and check-in → check-out dates; the header shows "พัก A → B".
  - `npm test` also runs `scripts/test-stays.mjs` (normalisation, per-day start/end hotel, pinning/anchoring, client validation).
- v17 (2026-11-09, add-flight-booking-duffel, test mode):
  - Duffel live flight offers in the transport search and the flight endpoints above. New setup field `cityAirport` (IATA from the destination list) used to resolve the destination airport; else Duffel place suggestions.
  - Fix: the bookings tab now resolves `flags.transport.<dir>.chosen` as an option id (it treated it as an object and showed an empty row).
  - `DUFFEL_*` in `.env.local` are copied into `process.env` like `BOP_*`. `npm test` runs `scripts/test-duffel.mjs` against a local mock of the Duffel API.

- v18 (2026-11-10, diet-avoid): member `veg` toggle replaced by free-text `avoid` (allergies / foods not eaten). Stop schema adds `diet` (all restricted members can eat here, safe dishes named in `note`). Rule "ไม่ทาน …" per member: a meal fits when `diet`, or `veg` and the avoid text is vegetarian. Legacy `veg:true` members are read as avoid "เนื้อสัตว์ (กินมังสวิรัติ)". Exports `avoidOf`, `vegAvoid`, `mealFits` from `src/plan.js`.
- v19 (AWS deployment hardening):
  - Every POST endpoint requires `Content-Type: application/json`; a different media type returns HTTP 415 with the normal NDJSON `bad_request` event. A JSON payload must be an object, and the existing 2 MiB body cap remains.
  - `/api/flights/cancel` now uses the same `bookingEnabled()` gate as `/api/flights/order`; cancellation is unavailable while AWS keeps `BOP_FLIGHT_BOOKING=0`.
  - `/api/flights/order` and confirmed `/api/flights/cancel` accept an additive `idempotencyKey` UUID. The AWS backend records 24-hour idempotency entries and 90-day non-PII booking audit entries in DynamoDB; repeated completed requests return the recorded response.
  - Production responses add CSP, HSTS, frame, MIME, referrer and browser-permission headers. AWS uses a private S3 frontend behind CloudFront OAC, then a streaming REST API Gateway and Lambda backend protected by regional and edge WAF controls.
  - OpenAI Responses API support adds the provider value `openai`. Tier mapping is Opus → `gpt-6.2-astra`, Sonnet → `gpt-6.2-sol`, and Haiku → `gpt-6-luna`; Anthropic and local subscription providers remain available.
  - LINE group linking, signed webhooks, reply-first messaging, capped pushes, Flex votes, LIFF member identity and 30-day post-trip retention are implemented on the DynamoDB POC state table. Without LINE keys, the existing in-app vote remains.
  - MapLibre 6's separate `maplibre-gl-worker.mjs` is copied into the production assets and served as JavaScript; deployment tests fail if it is absent.
  - Model-supplied image/source values accept direct URLs or Markdown image/link wrappers. The server stores canonical URLs and strips Markdown syntax from user-facing place text; the browser repeats URL normalization defensively.
