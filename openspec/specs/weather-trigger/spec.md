# weather-trigger Specification

## Purpose
TBD - created by archiving change add-live-weather. Update Purpose after archive.
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
- **WHEN** 14:00 shows 80 % and 4 mm
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
Forecasts SHALL be cached per `lat,lng|date` for 1 h within 48 h of the date and 3 h otherwise, and Open-Meteo SHALL be skipped for 10 min after two consecutive failures or an HTTP 429, returning no alerts with reason `unavailable`.

#### Scenario: Open-Meteo down
- **WHEN** Open-Meteo times out twice
- **THEN** the endpoint answers `alerts: []` with reason `unavailable` and the plan is unchanged

### Requirement: Attribution
Any rain alert shown SHALL credit "ข้อมูลอากาศ: Open-Meteo.com".

#### Scenario: Alert strip
- **WHEN** an alert is shown
- **THEN** the attribution is visible next to it
