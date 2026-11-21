## Context

`src/plan.js` already marks weather-exposed stops with `outdoor: 1`, and `SCEN.rain` shows the intended UX on the sample plan (swap the waterfall for an indoor stop, re-route, vote if needed). The server already has the patterns this needs: `fetchJson` with timeouts, a circuit breaker per provider and a JSON disk cache in `server/.cache/` (`server/geo.mjs`). KEYS.md lists weather as "Open-Meteo could be added keyless".

## Goals / Non-Goals

**Goals:**
- Real hourly rain risk for each exposed stop of a planned trip, within the forecast horizon.
- A rain alert that hands a concrete command to the existing `/api/replan`.
- Ship with no key.

**Non-Goals:**
- Radar nowcasting, typhoon or air-quality alerts.
- Automatic replans without the organizer's tap.
- Push notifications (that belongs to `add-line-messaging`).

## Decisions

### Provider: Open-Meteo forecast API
`GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&hourly=precipitation,precipitation_probability,weather_code&timezone=auto&start_date=..&end_date=..`.
- Why: no key, global coverage incl. Thailand, Japan, Vietnam; hourly data up to 16 days; uses national weather models where available.
- Alternatives: OpenWeather One Call and Tomorrow.io need keys and paid tiers for hourly minutely data; TMD (Thai Meteorological Department) covers Thailand only and its API needs registration.

### Auth and keys
- Free endpoint: no key. Nothing is stored.
- Commercial endpoint (`customer-api.open-meteo.com`) needs `OPEN_METEO_API_KEY`. If set in `.env.local`, the server sends it as `apikey=`; it is read server-side only and never reaches the browser.

### Request flow
1. UI posts `{ setup, plan }` to `POST /api/weather-check` after a plan is shown and again when the planner opens on a later day.
2. Server collects exposed stops (`outdoor`, or `k` in nature/view), groups them by rounded coordinates (2 decimals, about 1 km) and trip date, and drops dates outside today..today+15.
3. One Open-Meteo call per coordinate group with all needed dates (pool of 3, same politeness as the routers).
4. For each stop, take the hours overlapping `t0..t1`. Alert levels:
   - `heavy`: any hour with precipitation >= 2.5 mm, or probability >= 70 % and precipitation >= 1 mm.
   - `likely`: probability >= 50 % and precipitation >= 0.5 mm.
   - otherwise no alert.
5. `done` carries `alerts: [{ stopId, day, from, to, level, mm, prob, source: 'open-meteo', fetchedAt }]` and `horizon: { from, to }`.
6. UI shows the strongest alert per day with "ให้ Bop ปรับแผน". The tap sends `/api/replan` with a command such as "พยากรณ์ฝนตกหนัก 14:00–16:00 วันที่ 2 ที่น้ำตกบัวตอง (โอกาส 80% ~4 มม./ชม.) ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม".
Thresholds live in one constant so they can be tuned from real trips.

### Caching
- In memory and `server/.cache/weather.json`, keyed `lat,lng|date`, TTL 1 h for dates within 48 h and 3 h further out (forecasts update hourly at most).
- Breaker as in `geo.mjs`: two failures or one HTTP 429 skip Open-Meteo for 10 min.

### Cost and quotas
- Free API: non-commercial use only, fair use under 10,000 calls/day (also per-minute/hour limits). A 7-day trip with 3 coordinate groups per day is at most 21 calls per check before caching.
- Commercial launch needs a paid Open-Meteo API plan (`OPEN_METEO_API_KEY`). Budget it before a public launch.

### Fallback to today's no-key path
There is no keyed path to fall back from. When the API fails, is rate-limited, or the trip is beyond the horizon, the endpoint returns `alerts: []` with a reason (`unavailable` or `beyond_horizon`) and the UI shows nothing more than a muted "ยังไม่มีพยากรณ์อากาศ". The offline `SCEN.rain` stays for the sample plan.

### ToS constraints
- Attribution: show "ข้อมูลอากาศ: Open-Meteo.com" (CC BY 4.0) next to any alert.
- Non-commercial terms on the free endpoint: a paid plan is required once Bop serves paying users.

## Risks / Trade-offs

- [Forecast skill drops after 3-5 days] -> label alerts more than 3 days out as "แนวโน้ม" and do not suggest a replan before 72 h unless the level is heavy.
- [Tropical showers are short and local] -> thresholds require overlap with the stop window, not the whole day.
- [Free-tier terms] -> `OPEN_METEO_API_KEY` switch is built in from the start.

## Migration Plan

Additive. Ship the endpoint and UI strip behind no flag. Rollback is removing the UI call; plans are unaffected.

## Open Questions

- Should the agent also receive the forecast during `/api/plan` design so it avoids exposed stops on rainy afternoons in the first place?
