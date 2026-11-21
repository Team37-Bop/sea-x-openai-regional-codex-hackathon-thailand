# Bop — เชียงใหม่ demo

Group-travel agent prototype: plan → replan → book → shop for a 3-day Chiang Mai trip (4 friends).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

## Map stack (no API keys)
- **Map:** MapLibre GL JS 6.19 + OpenFreeMap vector tiles (`positron` light / `dark` dark, follows OS theme). Basemap labels prefer `name:th`.
- **Road geometry:** OSRM public servers at `routing.openstreetmap.de` (`routed-car` for car/รถแดง/van, `routed-foot` for walking). Fetched in the browser per leg, cached in memory + `localStorage` (`bop-routes-v1`). Falls back to a straight line if a request fails.
- Leg times/costs shown in the plan are still the plan's own numbers, not OSRM durations.

## What is real vs. sample
- Real: map tiles, road-following route lines, constraint checks (7 rules recomputed on every plan change), diff / minimal-change metric.
- Sample: places, prices, phone numbers, replan scenarios (pre-built, no LLM call yet), bookings and cart (sandbox).

## Production notes
- The public OSRM / OpenFreeMap servers are fine for demos; for real traffic self-host OSRM/Valhalla or use Google Routes API.
- Code: `src/main.js` (data, logic, rendering, map), `src/style.css`.
- AWS deployment uses a private S3 frontend through CloudFront OAC, with `/api/*` routed to a streaming REST API Gateway, Lambda, and DynamoDB. See [terraform/README.md](terraform/README.md).
- Local credentials stay in `.env.local`; deployed credentials come from AWS Secrets Manager and never enter Terraform state. AWS uses the OpenAI service-account key by default, with Anthropic still supported.

Specs: [openspec/](openspec/) (baseline specs in `openspec/specs/`, keyed-service proposals in `openspec/changes/`, project context in `openspec/config.yaml`).
