# agent-runtime Specification

## Purpose

This capability determines which model serves a Bop request, how the app reports readiness and progress, and what reaches the browser when a provider fails. The reference implementation is the prep repository at `292ba5f`. The entry points are `server/api.mjs`, `server/index.mjs`, `server/lambda-handler.mjs` and `vite.config.js`. The adapters are `server/openai.mjs`, `server/claude.mjs`, `server/cli-llm.mjs` and `server/fake-llm.mjs`. The HTTP client is `src/ui/api.js`. Regression evidence includes `scripts/test-openai.mjs`, `scripts/test-runtime.mjs` and `scripts/test-lambda.mjs`.

## Requirements

### Requirement: Provider selection

The server SHALL select one provider when constructing the API handler and lazily reuse its model adapter. `BOP_FAKE_LLM=1` takes first priority. A recognized `BOP_PROVIDER` SHALL force `openai`, `anthropic` (also accepted as `api`) or `subscription`. A missing prerequisite for a forced provider leaves the handler without a provider. Automatic selection, including an unrecognized provider value, SHALL try a nonblank OpenAI service key, then an Anthropic key, then the local Claude executable.

#### Scenario: Both API credentials present
- **WHEN** both service keys are configured with automatic selection
- **THEN** the API uses OpenAI for design, candidates, research and replanning

#### Scenario: Explicit provider lacks credentials
- **WHEN** OpenAI is forced and its key is absent, even if the Anthropic key exists
- **THEN** health reports a null provider and a model-dependent request ends with `no_key`

#### Scenario: Fake overrides a forced provider
- **WHEN** fake mode and a valid OpenAI key are both set
- **THEN** health identifies the provider as `fake` and model-dependent calls use the fixture adapter

### Requirement: Server-side configuration

The production HTTP server SHALL merge `.env` followed by `.env.local`, preserve existing process variables, load runtime secrets when configured, and import the API after initialization. Vite dev and preview SHALL load the mode environment with process variables taking precedence. The Lambda adapter SHALL load runtime secrets before importing and constructing its reusable handler. The canonical OpenAI key name is `OPENAI_API_KEY`, with `OPENAI_APIKEY` used when the canonical value is falsy. Secrets SHALL stay on the server.

#### Scenario: A runtime secret has multiple fields
- **WHEN** a JSON secret contains allowlisted nonempty string values, an unknown field and a value already set in the environment
- **THEN** the loader fills missing or empty allowlisted values, ignores the unknown field and preserves the existing nonempty process value

#### Scenario: Both OpenAI key names are configured
- **WHEN** the canonical and legacy environment names both contain keys
- **THEN** the adapter uses the canonical key and the health response contains neither value

### Requirement: Health and request readiness

`GET /api/health` SHALL return an uncached JSON response with `ai`, legacy alias `claude`, `provider`, `model`, `fastModel`, `search` and `flights`. The three booleans reflect handler readiness, including fake mode. With an API key, readiness means a configured provider. With a subscription, readiness requires a logged-in CLI. The model names report configured tiers, including the Anthropic defaults when no provider or a fake provider is selected. `flights` is null when Duffel is unavailable, or an object with mode and booking availability.

#### Scenario: Present but invalid service key
- **WHEN** a nonblank OpenAI key is present
- **THEN** health identifies the configured OpenAI provider before any upstream model call, and a subsequent upstream authentication failure is reported on the stream

#### Scenario: Logged-out CLI
- **WHEN** the binary exists but its login status is false
- **THEN** health reports `ai: false`, `claude: false`, `search: false`, and `provider: null`, and model-dependent routes produce `auth`

#### Scenario: Independent endpoint
- **WHEN** no model is configured
- **THEN** weather checks and the flight offer, order and cancellation handlers still run their own validation and service checks

### Requirement: Model policy

Design, skeleton, daily design, repair and replan SHALL use the deep tier. Research, transport options, candidates and candidate page discovery SHALL use the provider's fast tier. OpenAI defaults to `gpt-6.2-astra` for deep work and tries `BOP_OPENAI_FAST_MODEL`, `gpt-6.2-sol`, `gpt-6-luna`, then the deep model. `BOP_OPENAI_MODEL` overrides the OpenAI deep model. Anthropic defaults to `claude-opus-5-5` and tries `BOP_FAST_MODEL`, `claude-sonnet-5-5`, `claude-haiku-5-5`, then Opus. The ordered fast lists omit empty and duplicate names.

#### Scenario: OpenAI rejects a fast model
- **WHEN** a fast call returns an eligible model-unavailability error such as a model-not-found response
- **THEN** the adapter tries the next tier and reuses the updated index for subsequent fast calls in the same process

#### Scenario: OpenAI authentication or quota error
- **WHEN** a fast call returns HTTP 401, 403 or 429
- **THEN** that request ends with `auth` or `rate_limit` without a fallback to another model

### Requirement: OpenAI Responses API

The OpenAI adapter SHALL stream the Responses API with `store: false`, normalized user/assistant input, a stable system instruction, reasoning effort, an output-token ceiling and low verbosity. Structured tasks use a named JSON Schema format with `strict: false`. The SDK is configured for two retries and a 120-second request timeout. Default plan, repair and place effort is low, and replan effort is medium, with `BOP_EFFORT_PLAN`, `BOP_EFFORT_REPAIR`, `BOP_EFFORT_PLACE` and `BOP_EFFORT_REPLAN` overrides.

#### Scenario: Bounded web search
- **WHEN** a positive search cap is supplied
- **THEN** the request uses the built-in web search tool with medium context, sets `max_tool_calls` and requests returned source URLs. It uses approximate destination country and city when available, or Chiang Mai as the default. Completed search queries can generate Thai progress events

#### Scenario: Repair and output limits
- **WHEN** the server asks OpenAI to repair an itinerary
- **THEN** the request passes prior messages and the repair report with no web-search tool. The adapter allows 16,000 output tokens for repair and 32,000 for full-trip design

#### Scenario: Evidence and usage
- **WHEN** OpenAI returns a completed response with web tool results, annotations and usage
- **THEN** the adapter collects returned URLs, distinguishes citations, sums input, output and reported cache-token counts, counts web search calls and sets `usage.provider` to `openai`. A URL appearing only in generated JSON does not qualify as a search result

#### Scenario: Refusal or incomplete result
- **WHEN** completed response metadata indicates a content filter or an output part contains a refusal
- **THEN** the adapter raises `refusal`. An output-token cutoff, missing completion, failed result or unreadable required plan shape produces `upstream`

### Requirement: Anthropic API and subscription

Anthropic API calls SHALL stream with adaptive thinking, a stable ephemeral-cache system block, effort and appropriate schemas. The adapter SHALL retry an initial bad request with refusal fallbacks disabled, and remember a successful retry. A searching structured turn rejected with the search tool can be retried without search. The subscription adapter SHALL use a headless CLI with a temporary working directory, stdin prompt, stream JSON, empty settings sources, strict MCP configuration, disabled session persistence and an explicit tool list. Only WebSearch is allowed for search-enabled calls. The child environment removes Anthropic API credentials and `CLAUDECODE`.

#### Scenario: Paused Anthropic search
- **WHEN** a search turn returns `pause_turn`
- **THEN** the adapter continues with the full assistant turn, up to four iterations, then reports `upstream` if it still cannot finish

#### Scenario: Subscription authentication and timeout
- **WHEN** subscription readiness is checked
- **THEN** the CLI checks login status, caches the boolean for 60 seconds and handles its own credentials. A full-plan call exceeding 180 seconds terminates and reports a timeout

### Requirement: HTTP and event framing

Model POST routes SHALL accept JSON objects and stream newline-delimited JSON. For an accepted content type the transport SHALL return HTTP 200, `application/x-ndjson`, `Cache-Control: no-store` and `X-Accel-Buffering: no`. Clients receive Thai `step` events, any endpoint-specific events and one terminal `done` or `error` on a completed connection. Closing a connection before completion signals cancellation. The request body limit is 2 MiB.

#### Scenario: Incorrect media type
- **WHEN** a registered streaming endpoint receives a POST without `application/json`
- **THEN** it returns HTTP 415 and one NDJSON `bad_request` error. An unknown method/path returns HTTP 404 with a JSON `not_found` response

#### Scenario: Invalid JSON and oversized input
- **WHEN** the server reads invalid JSON, an array or a scalar
- **THEN** the stream ends with `bad_request`. A body that exceeds the byte limit is rejected and the server destroys the request, so a disconnected client may receive a transport failure

#### Scenario: Client loses the connection
- **WHEN** a UTF-8 JSON line crosses network chunk boundaries
- **THEN** the browser buffers and decodes the entire line before delivery. It ignores malformed lines and reports `cut` if a successful stream ends without a terminal event

### Requirement: Error messages and product name

The model-independent public error vocabulary for agent requests SHALL include `no_key`, `auth`, `rate_limit`, `bad_request`, `refusal` and `upstream`. The browser SHALL scrub Claude and Anthropic product references in user-visible event text and preserve strings under `url`, `page`, `href`, `model` and `id`. Browser transport errors are localized separately.

#### Scenario: Provider reference in a summary
- **WHEN** a streamed summary and its source URL both contain a provider name
- **THEN** the summary uses Bop branding and the link target is preserved

### Requirement: Deterministic test provider

The fake adapter SHALL support the same planner operations and produce deterministic Da Nang fixtures or the Chiang Mai sample with a repair exercise. The agent pipeline still performs downstream enrichment and checks.

#### Scenario: Reproducible plan without paid model calls
- **WHEN** fake mode is enabled and the setup selects Da Nang
- **THEN** the model stage uses the fixture for the requested trip length and the server can continue with geocoding and scheduling
