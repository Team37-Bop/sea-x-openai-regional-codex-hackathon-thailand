# weather-trigger Specification

## Purpose

Check whether rain during a scheduled outdoor visit warrants notifying the group. This independent weather operation uses Open-Meteo and returns an NDJSON status even when no model is configured. The organizer chooses whether to start a replan.

Reference implementation in the prep repository at `292ba5f` includes `server/weather.mjs` (`exposedStops`, `rainAlert`, `runWeatherCheck`), `server/api.mjs` and `src/main.js` (`checkWeather`, `wxFor`, `wxStrip`). Time windows, caching, the forecast horizon and provider failure behavior have executable examples in `scripts/test-weather.mjs`.

## Requirements
### Requirement: Rain check endpoint
The server SHALL provide `POST /api/weather-check` that accepts `{ setup, plan }`, streams NDJSON like the other agent endpoints without calling a model, and ends with `done.alerts` and `done.horizon`.

#### Scenario: Plan with an outdoor stop
- **WHEN** day 2 has an `outdoor` waterfall stop 13:40-15:20 within the forecast horizon
- **THEN** the server fetches the Open-Meteo hourly forecast for its coordinates and date and returns any alert for that window

#### Scenario: No model needed
- **WHEN** no LLM provider is configured
- **THEN** the weather check still runs

### Requirement: Exposed stops only
The check SHALL consider only stops with `outdoor` set or kind `nature` or `view`, grouped by coordinates rounded to 2 decimals and trip date.

#### Scenario: Indoor museum
- **WHEN** a museum stop has no `outdoor` flag
- **THEN** no forecast is fetched for it

### Requirement: Alert levels
For the hours overlapping a stop's `t0..t1`, the check SHALL raise `heavy` when any hour has precipitation of at least 2.5 mm or probability of at least 70 % with at least 1 mm, `likely` when probability is at least 50 % with at least 0.5 mm, and no alert otherwise.

#### Scenario: Heavy afternoon shower
- **WHEN** the stop overlaps 14:00–15:00 and the provider sample stamped 15:00 shows 80 % and 4 mm
- **THEN** the alert is `{ level: 'heavy', from: '14:00', to: '15:00', prob: 80, mm: 4, source: 'open-meteo' }`

### Requirement: Forecast horizon
Dates outside today to today + 15 days SHALL get no alert, and the response SHALL say `beyond_horizon` so the UI can show "ยังไม่มีพยากรณ์อากาศ"; alerts more than 3 days out SHALL be labelled as a trend.

#### Scenario: Trip next month
- **WHEN** the trip starts in 30 days
- **THEN** `alerts` is empty and the reason is `beyond_horizon`

### Requirement: Keyless with optional commercial key
The free Open-Meteo endpoint SHALL be used without a key; when `OPEN_METEO_API_KEY` is set in the server environment the commercial endpoint SHALL be used with it, and the key SHALL never be sent to the browser.

#### Scenario: Paid plan configured
- **WHEN** `OPEN_METEO_API_KEY` is present in `.env.local`
- **THEN** requests go to the commercial host with the key and the browser sees only the alerts

### Requirement: Weather cache and breaker
Forecasts SHALL be cached per `lat,lng|date` for 1 h within 48 h of the date and 3 h otherwise, and Open-Meteo SHALL be skipped for 10 min after two consecutive failures or an HTTP 429, returning `unavailable` when all in-range stops lack a cache entry.

#### Scenario: Open-Meteo down
- **WHEN** Open-Meteo times out twice
- **THEN** the endpoint answers `alerts: []` with reason `unavailable` and the plan is unchanged

### Requirement: Attribution
Any rain alert shown SHALL credit "ข้อมูลอากาศ: Open-Meteo.com".

#### Scenario: Alert strip
- **WHEN** an alert is shown
- **THEN** the attribution is visible next to it

### Requirement: Stop windows and hourly timestamps

The forecast checker SHALL read `day.date` or derive the day from `setup.startDate` and the zero-based day index. It SHALL skip stops without a finite coordinate pair and usable `t0` and `t1` forming a positive interval. An hourly sample stamped T covers the preceding hour [T−60 min, T). A midnight sample belongs to the final hour of the preceding date.

#### Scenario: Forecast falls on the boundary
- **WHEN** a stop runs from 14:00 to 15:00, the 14:00 sample is wet and the 15:00 sample is dry
- **THEN** the earlier wet hour ends at the stop's start and produces no alert

#### Scenario: Several wet hours
- **WHEN** several qualifying hours overlap one stop
- **THEN** one alert spans the earliest qualifying start and latest qualifying end, including any intervening dry hour. It carries the strongest level and independent peak probability and precipitation, with millimetres rounded to one decimal.

#### Scenario: Midnight close and batched lookup
- **WHEN** two stops at the same rounded coordinates span several trip dates and the last visit ends late at night
- **THEN** one forecast request for those coordinates covers the earliest missing date through the day after the latest missing date, using local forecast time and at most three simultaneous coordinate-group requests

### Requirement: Coverage and partial failures

The terminal result SHALL include `alerts`, `horizon: { from, to }` and `source: 'open-meteo'`. Each alert SHALL identify the stop, name, zero-based day index, date, time window, level, peak probability, peak hourly amount, trend flag and retrieval timestamp. The server sorts by day, then heavy before likely, then start time.

#### Scenario: No outdoor stops
- **WHEN** the plan has no eligible outdoor or nature/view stop
- **THEN** the result has an empty alert list and `reason: 'no_exposed'` without an upstream request

#### Scenario: Mixed range
- **WHEN** some exposed stops are outside the horizon and covered stops have forecast data and no qualifying rain
- **THEN** the result reports `partial_horizon` and `checked` counts the covered stops with data

#### Scenario: Refresh fails for an expired entry
- **WHEN** a fetch fails but the cache already holds older hourly values
- **THEN** the result may still contain alerts using those values with their original `fetchedAt`, and `failed: true` signals the unsuccessful refresh. A wholly missing in-range forecast yields `unavailable`.

### Requirement: Alert selection and opt-in action

The planner SHALL refresh forecasts after loading an agent plan and after applying a replan, supersede an older in-flight check, and skip the live check on the offline sample. The selected day's strip SHALL prefer heavy alerts, then greater probability among equal levels. Dismissal is keyed by stop ID, date and level.

#### Scenario: Lower-confidence long-range rain
- **WHEN** a likely alert is more than three days away
- **THEN** the strip labels it as a trend and offers dismissal. A heavy alert at the same horizon can offer a replan when the planner is idle.

#### Scenario: Changed or removed stop
- **WHEN** the selected day's current plan no longer includes the stop named by an alert
- **THEN** the strip omits that alert. A linked LINE group can receive the first ranked weather notice once for its stop/date/level key.
