## Context

`createApi()` (`server/api.mjs`) picks `api` when `ANTHROPIC_API_KEY` is set, else the CLI (`subscription`), unless `BOP_PROVIDER` forces one. `server/claude.mjs` already implements the API path: streaming, adaptive thinking, effort, structured outputs, `cache_control` on the system prompt, the `server-side-fallback-2026-07-01` beta with a retry without it on 400, web search `web_search_20260209` with `max_uses` and `user_location`, pause_turn handling, SDK `maxRetries: 2`, 120 s timeout, and the fast-model chain. The CLI path replays the repair conversation as text, spawns one process per call and reports rate limits as `rate_limit` "Bop ใช้โควตาของวันนี้หมดแล้ว".

## Goals / Non-Goals

**Goals:**
- Serve other users only through the API under commercial terms.
- Predictable behaviour under rate limits and overload.
- Lower cost and latency through prompt caching.

**Non-Goals:**
- Changing prompts, schemas or model policy (Opus for design/replan, Sonnet fast model).
- Batch API (interactive app; latency matters).
- Multi-provider LLM abstraction.

## Decisions

### Provider rule
- `BOP_ENV=production` → provider must be `api`; if the key is missing the server starts with provider null (health `claude:false`, endpoints `no_key`) and logs an error. `BOP_PROVIDER=subscription` is ignored in production with a warning.
- Development keeps today's order (key → api, else CLI → subscription, `BOP_FAKE_LLM=1` → fake).
- Why: the Claude subscription (via Claude Code) is licensed for the subscriber's own use; a hosted app for other users needs the API.

### Auth and keys
- `ANTHROPIC_API_KEY` from `.env.local` in development; in production from the host's secret manager injected as an environment variable. Read only in `server/`; never logged (the existing `env.mjs` already never logs values); never sent to the browser.
- One key per environment (dev/prod) in separate Console workspaces with spend limits.

### Rate limits and concurrency
- The SDK already retries 429/529 with backoff (`maxRetries: 2`) and honours `retry-after`.
- Add a process-wide limiter: `BOP_MAX_CONCURRENT_OPUS` (default 4) and `BOP_MAX_CONCURRENT_FAST` (default 8). Requests beyond the limit wait in a FIFO queue; while waiting the stream emits "Bop กำลังรอคิว (N)" every 10 s.
- After retries are exhausted on 429 the run ends with `rate_limit` (unchanged contract).
- Read `anthropic-ratelimit-*` response headers into logs to tune limits.

### Fallbacks
- Kept: fast-model chain (skip unavailable models), server-side refusal fallbacks with the 400 retry, search-off retry when search + structured output is rejected.
- New: if an Opus call (design, skeleton, day, replan) fails with overload (529) or rate limit after retries, retry once with `BOP_DESIGN_FALLBACK_MODEL` (default unset = no fallback; recommended `claude-sonnet-5-5`), emit no model name to the user, log `fallback=model`. Repair keeps Opus only.

### Prompt caching
- Today: `SYSTEM` is byte-stable and marked `cache_control: { type: 'ephemeral' }`.
- Add a second breakpoint on the user turn's shared prefix: `TripSetup` JSON + skeleton for split trips, so the per-day calls and the repair reuse it. Order the user content as stable prefix first, day-specific text last.
- Parallel day calls may all miss the cache if sent at once: send day 1 first and start the others once its first streamed event arrives (adds ~1-2 s, saves input tokens on the remaining days).
- Track `cache_creation_input_tokens` / `cache_read_input_tokens` (already summed in `usage`) per endpoint in logs.

### Cost guard
- Per request: existing web search caps (`BOP_SEARCH_PLAN`, `BOP_SEARCH_REPLAN`, per-call caps) stay.
- Daily: `BOP_DAILY_TOKEN_BUDGET` and `BOP_DAILY_SEARCH_BUDGET`; when reached, new agent requests end with `rate_limit` and a Thai message, and the UI offers the offline sample. Console workspace spend limits as the hard stop.
- Cost model: tokens by model (Opus > Sonnet > Haiku) plus web search requests. A 3-day split plan is skeleton + 3 day calls + optional repair on Opus, plus transport/candidates/place-info on Sonnet; measure from `usage` logs in the first week.

### Fallback to today's no-key path
- Development without a key: the subscription CLI exactly as today.
- No provider at all: `no_key`, offline sample and scenarios as today.
- Production without a key: provider null (never the CLI).

### ToS constraints
- Anthropic commercial terms and usage policy apply to the API; the subscription is not used to serve users.
- User-facing branding stays "Bop"; the model is not named to users. Keep the UI's /Claude|Anthropic/ → "Bop" filter.

## Risks / Trade-offs

- [Cost per plan higher than expected] → daily budgets, caching, `usage` logs; adjust search caps.
- [Queueing makes long plans slower under load] → visible queue step; scale limits with the account's tier.
- [Fallback model gives weaker plans] → off by default; repair and checks still run on its output.

## Migration Plan

1. Create Console workspaces and keys; set spend limits.
2. Run the dev server with the key (provider `api`) and compare 10 plans with the CLI path (time, checks passed, cost).
3. Add the limiter, caching breakpoint and budgets; deploy with `BOP_ENV=production`.
Rollback: unset `BOP_ENV` in development to use the CLI again; production has no CLI rollback by design.

## Open Questions

- Default for `BOP_DESIGN_FALLBACK_MODEL`: off, or Sonnet 5.5 for availability?
- Should the per-day calls stay fully parallel when the cache gain is small for 3-day trips?
