## ADDED Requirements

### Requirement: Request queueing under rate limits
The API provider SHALL limit concurrent model calls per model class (`BOP_MAX_CONCURRENT_OPUS`, default 4; `BOP_MAX_CONCURRENT_FAST`, default 8), queue the rest in arrival order, emit "Bop กำลังรอคิว (N)" every 10 s while queued, and end with `rate_limit` only after the SDK retries honouring `retry-after` are exhausted.

#### Scenario: Busy server
- **WHEN** a fifth Opus call arrives while four are running
- **THEN** it waits, the stream shows "Bop กำลังรอคิว (1)", and it starts when a slot frees

### Requirement: Design fallback model
When `BOP_DESIGN_FALLBACK_MODEL` is set, an Opus design, skeleton, day or replan call that fails with overload or rate limit after retries SHALL be retried once on that model, without naming any model to the user; repair SHALL stay on Opus.

#### Scenario: Opus overloaded
- **WHEN** the skeleton call returns 529 after retries and the fallback is `claude-sonnet-5-5`
- **THEN** the skeleton is retried once on Sonnet 5.5 and the log records the fallback

#### Scenario: No fallback configured
- **WHEN** the variable is unset
- **THEN** the run ends with `upstream` or `rate_limit` as today

### Requirement: Shared-context prompt caching
Besides the cached system prompt, the API provider SHALL place a cache breakpoint after the stable trip context (TripSetup and, in split mode, the skeleton) so the per-day calls and the repair reuse it, and SHALL send the first day call before the others so later calls can read the cache.

#### Scenario: Four-day trip
- **WHEN** a 4-day split plan runs
- **THEN** day calls 2-4 report `cache_read_input_tokens` greater than 0 in `usage`

### Requirement: Daily cost guard
The server SHALL stop starting new agent runs for the rest of the day when `BOP_DAILY_TOKEN_BUDGET` or `BOP_DAILY_SEARCH_BUDGET` is reached, ending them with `rate_limit` and a Thai message, while the offline sample stays available.

#### Scenario: Budget reached
- **WHEN** the daily token budget is used up
- **THEN** `/api/plan` ends with `rate_limit` and the UI offers the sample plan

## MODIFIED Requirements

### Requirement: Provider selection
The server SHALL pick one provider at start: with `BOP_ENV=production` only `api` with `ANTHROPIC_API_KEY` is allowed (no key means provider null, and `BOP_PROVIDER=subscription` is ignored with a warning); otherwise `BOP_PROVIDER` forces `api` or `subscription`, else `ANTHROPIC_API_KEY` selects `api` and, without a key, a found `claude` CLI selects `subscription`; `BOP_FAKE_LLM=1` selects the deterministic fake model; with none of these the provider is null.

#### Scenario: Key present
- **WHEN** `.env.local` sets `ANTHROPIC_API_KEY` and `BOP_PROVIDER` is unset
- **THEN** every model call goes through the SDK

#### Scenario: Forced subscription without CLI
- **WHEN** `BOP_PROVIDER=subscription` and no `claude` binary is found
- **THEN** the provider is null

#### Scenario: Production without a key
- **WHEN** `BOP_ENV=production`, no API key is set and the CLI is installed
- **THEN** the provider is null, health reports `claude: false`, and agent endpoints answer `no_key`

#### Scenario: Development without a key
- **WHEN** `BOP_ENV` is unset, no API key is set and the CLI is logged in
- **THEN** the subscription provider is used as today
