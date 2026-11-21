# Bop

Bop วางแผนทริปกลุ่มจากวันเดินทาง ที่พัก งบ และข้อจำกัดของเพื่อนแต่ละคน ทั้งแผนที่ การเดินทางระหว่างกิจกรรม และคำสั่งปรับแผนใช้หน้าเดียวกัน

## Run locally

Use Node.js 22 or later.

```sh
npm run dev
npm run build
npm test
```

Open http://localhost:8787. The default Chiang Mai demo works without credentials. Set `BOP_FAKE_LLM=1` in `.env.local` to exercise the trip form and candidate flow with fixture data. Configure a model provider using `.env.example` for live planning. Run `NODE_ENV=production npm start` after the build to serve `dist/`.

## OpenSpec

The requirements in [openspec/specs](openspec/specs) were the reference for this implementation. Codex OpenSpec skills are in `.codex/skills`. In Codex, invoke them with names such as `$openspec-propose` and `$openspec-apply-change`.

The browser uses Leaflet and OpenStreetMap tiles. Routing tries OSRM, then Valhalla, then a labelled straight-line estimate. Forecasts come from Open-Meteo.

## Implementation status

The local app covers trip setup, planning, route display, textual place research, constraint checks, candidate selection, replanning, simulated voting, undo, and rain checks. The tests exercise fixture and mock flows. The full photo discovery pipeline and the additional provider integrations in the prep repository’s change proposals are outside this implementation. Live provider behavior requires verification with the relevant credentials.

## AWS deployment

GitHub Actions validates pull requests and deploys `main` to CloudFront, private S3, API Gateway, and Lambda using GitHub OIDC. See the [Terraform runbook](terraform/README.md) for setup, runtime credentials, and verification.
