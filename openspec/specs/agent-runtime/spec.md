# agent-runtime Specification

## Purpose
The runtime around every agent endpoint: choosing an LLM provider, health reporting, model selection, NDJSON streaming, error codes, branding, secrets and caching. Code: `server/api.mjs`, `server/claude.mjs`, `server/cli-llm.mjs`, `server/fake-llm.mjs`, `server/env.mjs`, `server/index.mjs`, `vite.config.js`, `src/ui/api.js`.

## Requirements

### Requirement: Provider selection
The server SHALL pick one provider at start: `BOP_PROVIDER` forces `api` or `subscription`; otherwise `ANTHROPIC_API_KEY` selects `api` (Anthropic SDK) and, without a key, a found `claude` CLI selects `subscription`; `BOP_FAKE_LLM=1` selects the deterministic fake model; with none of these the provider is null.

#### Scenario: Key present
- **WHEN** `.env.local` sets `ANTHROPIC_API_KEY` and `BOP_PROVIDER` is unset
- **THEN** every model call goes through the SDK

#### Scenario: Forced subscription without CLI
- **WHEN** `BOP_PROVIDER=subscription` and no `claude` binary is found
- **THEN** the provider is null

### Requirement: Subscription CLI isolation
The subscription provider SHALL run `claude -p` headless with stream-json output, the prompt on stdin, a fresh temp cwd removed afterwards, no session persistence, no setting sources, strict empty MCP config, only the `WebSearch` tool when search is allowed, and a child environment without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDECODE`; it SHALL never read Claude Code's stored credentials.

#### Scenario: Login check
- **WHEN** `/api/health` is called with the subscription provider
- **THEN** `claude auth status --json` is run (cached 60 s) and only its `loggedIn` boolean is read

#### Scenario: Per-call timeout
- **WHEN** a plan design call runs longer than 180 s
- **THEN** the child is terminated and the error "Bop ใช้เวลานานเกิน 180 วินาที" is returned

### Requirement: Health endpoint
`GET /api/health` SHALL return `{ claude, provider, model, fastModel, search }` with `claude` and `search` true only when the provider is usable and `provider` null otherwise.

#### Scenario: Logged-out CLI
- **WHEN** the CLI exists but is logged out
- **THEN** health returns `claude: false, provider: null`

### Requirement: Model policy
Plan design, the skeleton, per-day calls, repair and replan SHALL use `claude-opus-5-5`; place info, transport options, photo-page searches and candidates SHALL use the fast model order (`BOP_FAST_MODEL`, `claude-sonnet-5-5`, `claude-haiku-5-5`) at low effort, skipping for the rest of the process a model that is rejected and falling back to Opus last.

#### Scenario: Sonnet rejected
- **WHEN** the account returns 404 for Sonnet 5.5
- **THEN** Haiku 5.5 is tried and used for later fast calls

### Requirement: API provider call behaviour
The `api` provider SHALL stream every request with adaptive thinking, effort from config, JSON schema structured output, the system prompt as a cached block, `maxRetries: 2` and a 120 s timeout; it SHALL opt into server-side refusal fallbacks and retry once without them on a 400, and SHALL retry once without web search when search plus structured output is rejected.

#### Scenario: pause_turn
- **WHEN** a searching call stops with `pause_turn`
- **THEN** the turn is re-sent unchanged, up to 4 turns, then "Bop ค้นเว็บนานเกินไป"

### Requirement: NDJSON streaming
Agent endpoints SHALL answer `200` with `application/x-ndjson`, no caching and no proxy buffering, one JSON object per line, Thai `step` events, and exactly one terminal `done` or `error`; a closed client connection SHALL abort the work.

#### Scenario: Client navigates away
- **WHEN** the browser closes the stream mid-plan
- **THEN** the abort signal stops model calls and network lookups

#### Scenario: Unknown route
- **WHEN** `/api/unknown` is requested
- **THEN** the server answers 404 `{ error: 'not_found' }`

### Requirement: Error codes
Errors SHALL map to `no_key` (no provider), `auth` (bad key, no model access, CLI logged out), `rate_limit` (HTTP 429 or the subscription usage limit), `refusal`, `bad_request` (invalid input) or `upstream` (everything else), each with a Thai message that names Bop; `auth` and `rate_limit` SHALL abort a run instead of being absorbed by fallbacks.

#### Scenario: Subscription quota used up
- **WHEN** the CLI reports a usage limit
- **THEN** the stream ends with `rate_limit` "Bop ใช้โควตาของวันนี้หมดแล้ว ลองใหม่ภายหลัง"

### Requirement: Bop branding
All user-facing text SHALL say "Bop" and never Claude, Anthropic or an AI model: the system prompts tell the model it is Bop, server messages name Bop, and the UI rewrites /Claude|Anthropic/ to "Bop" in every event string except the keys `url`, `page`, `href`, `model` and `id`.

#### Scenario: Model slips
- **WHEN** a summary contains "Claude"
- **THEN** the UI shows "Bop"

### Requirement: Secrets stay server-side
Keys SHALL be read from `.env.local` / `.env` / the process environment on the server only, never logged and never sent to the browser; the browser SHALL see only `/api/*` responses.

#### Scenario: Vite build
- **WHEN** `npm run build` runs
- **THEN** no non-`VITE_` variable is embedded in `dist/`

### Requirement: Prompt caching
The system prompt SHALL be byte-stable between requests and sent as the cached prefix, and token usage (including cache reads/writes and web search requests) SHALL be summed into `done.usage`.

#### Scenario: Usage report
- **WHEN** a plan finishes on the API provider
- **THEN** `usage` contains input, output, cache creation and cache read tokens and `web_search_requests`

### Requirement: Fake model for tests
With `BOP_FAKE_LLM=1` the server SHALL use a deterministic model with the same interface and schemas: Da Nang setups get a fixed N-day plan and fixed candidates, other setups get the Chiang Mai sample with a deliberate miss so the repair round runs, while geocoding, routing, photos and checks stay real.

#### Scenario: UI development without a model
- **WHEN** `BOP_FAKE_LLM=1 npm run dev` is used with city ดานัง
- **THEN** `/api/plan` returns the fixed Da Nang plan
