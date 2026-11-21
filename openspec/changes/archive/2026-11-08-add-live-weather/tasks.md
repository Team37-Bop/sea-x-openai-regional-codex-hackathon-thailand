## 1. Server

- [x] 1.1 Add `server/weather.mjs`: Open-Meteo client (free host, or commercial host with `OPEN_METEO_API_KEY`), timeouts, breaker, `server/.cache/weather.json`
- [x] 1.2 Collect exposed stops per day, group by rounded coordinates and date, drop dates outside the 16-day horizon
- [x] 1.3 Compute alert levels per stop window with the thresholds in one constant
- [x] 1.4 Add `POST /api/weather-check` to `server/api.mjs` (no model required, works when health reports `claude:false`)

## 2. UI

- [x] 2.1 Call the endpoint after a plan is shown and when a new trip day starts
- [x] 2.2 Show the strongest alert per day with Open-Meteo attribution and the "แนวโน้ม" label beyond 3 days
- [x] 2.3 "ให้ Bop ปรับแผน" builds the Thai command and calls `/api/replan`; keep `SCEN.rain` for the offline sample

## 3. Contract and checks

- [x] 3.1 Add the endpoint and `alerts` shape to API.md changelog
- [x] 3.2 Add `OPEN_METEO_API_KEY` (optional) to KEYS.md and `openspec/config.yaml`
- [x] 3.3 Script test with a recorded Open-Meteo response: heavy, likely, none, beyond horizon, API down
