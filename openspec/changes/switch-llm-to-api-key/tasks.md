## 1. Accounts and keys

- [ ] 1.1 Create dev and prod Console workspaces with spend limits; issue one key each
- [ ] 1.2 Dev key in `.env.local`; prod key in the host's secret store as `ANTHROPIC_API_KEY`

## 2. Provider rule

- [ ] 2.1 Read `BOP_ENV` in `server/index.mjs` and `vite.config.js`; pass it to `createApi`
- [ ] 2.2 Production: api only, ignore `BOP_PROVIDER=subscription` with a warning, provider null without a key

## 3. Runtime hardening

- [ ] 3.1 Concurrency limiter and FIFO queue per model class with "Bop กำลังรอคิว" steps
- [ ] 3.2 Log `anthropic-ratelimit-*` headers
- [ ] 3.3 Optional design fallback model on 529/429 after retries (`BOP_DESIGN_FALLBACK_MODEL`)
- [ ] 3.4 Second cache breakpoint after the shared trip context; send day 1 first in split mode
- [ ] 3.5 Daily token and search budgets with `rate_limit` responses

## 4. Verification

- [ ] 4.1 Compare 10 plans CLI vs API: time to first day, total time, checks passed, cost from `usage`
- [ ] 4.2 Load test with concurrent plans; confirm queue steps and no 429 leaks
- [ ] 4.3 API.md changelog (no contract change except queue steps); KEYS.md row update
