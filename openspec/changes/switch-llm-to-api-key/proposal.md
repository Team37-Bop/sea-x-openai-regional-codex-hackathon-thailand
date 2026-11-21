## Why

Bop runs on the owner's Claude subscription through the headless CLI (`claude -p`) because no API key is set (KEYS.md: "fine for personal demos, not for serving other users"). The subscription is for the owner's personal use; serving other people requires the Anthropic API under commercial terms. The API path also starts faster (no process spawn per call), supports true multi-turn repair with replayed thinking, and exposes rate-limit headers and usage for cost control.

## What Changes

- Production (`BOP_ENV=production`) SHALL use the `api` provider with `ANTHROPIC_API_KEY`; the subscription provider is refused in production and stays available only for local development.
- Health and errors stay as today; the UI keeps hiding the provider and model names.
- Rate-limit handling: respect `retry-after`, a server-wide concurrency limiter per model, and a queue step "Bop กำลังรอคิว" instead of failing fast.
- Fallbacks: today's fast-model chain and server-side refusal fallbacks stay; an overloaded or rate-limited Opus design call can retry once on a configured fallback model (`BOP_DESIGN_FALLBACK_MODEL`), labelled in logs.
- Prompt caching: keep the byte-stable system prompt as the cached prefix and add a second cache breakpoint after the shared trip context so the skeleton, per-day calls and repair reuse it.
- Cost guard: per-request and daily token/web-search budgets with logging (`usage` already summed per request).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `agent-runtime`: provider selection gains a production rule; adds rate-limit, fallback-model, prompt-caching and cost-guard requirements.

## Impact

- Code: `server/api.mjs` (provider rule), `server/claude.mjs` (limiter, retry, cache breakpoints, fallback model, budgets), `server/cli-llm.mjs` (dev only), `server/index.mjs`/`vite.config.js` (read `BOP_ENV`), API.md changelog.
- Keys: `ANTHROPIC_API_KEY` in `.env.local` (dev) or the host's secret store (production), server only. New settings `BOP_ENV`, `BOP_DESIGN_FALLBACK_MODEL`, `BOP_MAX_CONCURRENT_OPUS`, `BOP_MAX_CONCURRENT_FAST`, `BOP_DAILY_TOKEN_BUDGET`, `BOP_DAILY_SEARCH_BUDGET`.
- Cost: pay-as-you-go tokens + web search requests; see design.
- No-key fallback: in development, without a key, the subscription CLI keeps working exactly as today; with neither, endpoints answer `no_key` and the UI shows the offline sample.
