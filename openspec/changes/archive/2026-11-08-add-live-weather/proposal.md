## Why

Rain is the most common reason a Thai group trip needs a replan, but today Bop only has a simulated rain scenario (`SCEN.rain`) on the sample plan. Open-Meteo gives hourly precipitation forecasts with no API key, so a real rain trigger can ship before any keyed service.

## What Changes

- New server lookup of Open-Meteo hourly `precipitation` and `precipitation_probability` for the coordinates and dates of a plan's weather-exposed stops (`outdoor: 1`, plus `nature` and `view` kinds).
- New endpoint `POST /api/weather-check` (NDJSON, same envelope as other agent endpoints but no model call) that returns rain alerts per stop.
- The planner shows a Thai rain alert ("ฝนอาจตกหนัก 14:00–16:00 ที่น้ำตกบัวตอง") with a one-tap "ให้ Bop ปรับแผน" that sends `/api/replan` with a generated command. Nothing changes without the organizer's tap.
- Plans built more than 16 days ahead (beyond the forecast horizon) get no alert; the UI says the forecast is not available yet.
- The simulated rain scenario stays for the offline sample.

## Capabilities

### New Capabilities
- `weather-trigger`: hourly rain forecast for a plan's exposed stops, alert thresholds, caching and the no-forecast cases.

### Modified Capabilities
- `replanning`: a rain alert can start a replan with a generated command (added requirement; existing behaviour unchanged).

## Impact

- Code: new `server/weather.mjs`, a route in `server/api.mjs`, an alert strip in `src/main.js`, API.md changelog entry.
- Network: `api.open-meteo.com` (no key). Optional `OPEN_METEO_API_KEY` in `.env.local` only for the paid commercial endpoint.
- No-key fallback: this feature has no required key. If Open-Meteo is unreachable or rate-limited, Bop shows no alert and the offline rain scenario remains, exactly as today.
