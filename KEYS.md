# Features that would use an API key (parked for now)

Owner update 2026-11-20: OpenAI, Duffel, LINE and selected provider credentials are available locally and are synchronized to AWS Secrets Manager for deployment. Unfinished keyed integrations remain parked. The Spec column links each row to its OpenSpec change proposal in `openspec/changes/`.

| Feature | Keyed service (later) | What Bop does now (no key) | Gap | Spec |
|---|---|---|---|---|
| AI model | OpenAI service-account key (`OPENAI_APIKEY` or `OPENAI_API_KEY`) with Anthropic fallback | AWS uses OpenAI Responses API; local fake/subscription modes remain | Tier mapping: Opus→Astra, Sonnet→Sol, Haiku→Luna | [switch-llm-to-api-key](openspec/changes/switch-llm-to-api-key/) |
| Public transport times & fares (train/subway/bus in a city) | Google Routes API `TRANSIT`, or a city GTFS feed (Navitime, Jorudan for Japan) | Web search for the line, ride time and fare; otherwise estimate from distance | No live timetable; a minute-level transfer could be wrong | [adopt-google-routes-api](openspec/changes/adopt-google-routes-api/) |
| Intercity bus / train / ferry schedules & booking | 12Go API (affiliate) | Web search for schedules and prices | No live seats and no booking | — (no change yet; 12Go) |
| Flight search & booking | Duffel (`DUFFEL_ACCESS_TOKEN`; built, test mode) | With token: live Duffel offers + booking/cancel in test mode. Without: web search for typical routes and prices | Live booking needs Duffel verification, payments and `BOP_FLIGHT_BOOKING=1`; Thai LCC coverage unknown | [add-flight-booking-duffel](openspec/changes/add-flight-booking-duffel/) |
| Flight status / delays | AeroDataBox / AviationStack / FlightAware | Simulated delay scenario | No real delay detection | [add-live-flight-status](openspec/changes/add-live-flight-status/) |
| Traffic-aware driving times | Google Routes API (`TRAFFIC_AWARE`) | OSRM (free, OpenStreetMap) free-flow time × mode factor + waiting time | No live traffic | [adopt-google-routes-api](openspec/changes/adopt-google-routes-api/) |
| Place search, opening hours, phone, veg menu flag | Google Places API (New) | Claude web search + OSM geocoding (Photon/Nominatim) | Hours and phone numbers are best-effort; shown with a source link | [adopt-google-places-api](openspec/changes/adopt-google-places-api/) |
| Place photos | Google Places Photos (New) / Foursquare Places photos | Wikimedia/Wikipedia images (free, credited) + og:image of the web pages Bop found, with a link back | Coverage of small restaurants is patchy; images belong to their sites | [adopt-google-places-api](openspec/changes/adopt-google-places-api/) |
| Restaurant menus & prices | (no good API; Wongnai has none public) | Claude web search on demand (`/api/place-info`) | Prices are approximate, with sources | — (stays web search; Places has no menus, see [adopt-google-places-api](openspec/changes/adopt-google-places-api/)) |
| Weather / rain radar | Open-Meteo is free, no key; OpenWeather / Tomorrow.io need keys | Live: Open-Meteo hourly rain for outdoor stops (`/api/weather-check`, keyless); optional `OPEN_METEO_API_KEY` for the commercial host | Free endpoint is non-commercial only; no radar nowcast | [weather-trigger](openspec/specs/weather-trigger/) (done) |
| Hotels | LiteAPI (sandbox) / Agoda / Booking.com partner | Hotel is a fixed area in setup | No search or booking | [add-hotel-booking](openspec/changes/add-hotel-booking/) |
| Group chat / voting | LINE Messaging API channel token + LIFF | Group linking, signed webhook, Flex votes, LIFF identity and capped push messages are implemented | `LIFF_ID` must be configured to activate the LIFF page | [add-line-messaging](openspec/changes/add-line-messaging/) |
| Activities & tours | Viator Partner API / Klook / KKday affiliate | Entry prices are web estimates on the stop | No live prices, availability or booking | [add-activity-booking](openspec/changes/add-activity-booking/) |
| Payments | Opn (Omise) / Stripe test keys | None (cart removed) | — | [add-payments](openspec/changes/add-payments/) |
| Map tiles | — | OpenFreeMap (free, no key) | Public server, fine for demo | — |
| Routing geometry | — | OSRM public server (free, no key) | Public server, rate limits; self-host for production | — |
