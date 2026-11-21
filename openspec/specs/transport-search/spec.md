# transport-search Specification

## Purpose

Find one-way travel to or from a trip and carry the selected option into the itinerary. The reference implementation in prep `292ba5f` combines two sources with different price and booking semantics. The relevant paths are `server/api.mjs`, `server/agent.mjs` (`runTransport`, `searchTransport`, `normalizeTransport`, `runPlan`), `server/duffel.mjs`, `server/openai.mjs`, `server/claude.mjs`, `src/main.js` and `scripts/test-duffel.mjs`. See the [flight booking contract](../flight-booking/spec.md) for offer refresh, order and cancellation.

## Requirements

### Requirement: Direction and response envelope

`POST /api/transport-options` SHALL accept a JSON object containing `setup` and `dir` (`go` or `back`). It SHALL normalize the setup, select the corresponding `arrive` or `depart` leg and return Thai NDJSON progress followed by one terminal event. Success carries `options`, elapsed `ms` and model `usage`.

#### Scenario: Invalid direction

- **WHEN** a usable model is configured but the direction is invalid, its normalized leg is missing, or the organizer is driving that leg
- **THEN** the stream ends with `bad_request`.

#### Scenario: Readiness gate

- **WHEN** the transport-options request reaches a server without a usable model
- **THEN** the model-readiness error terminates the stream before transport lookup, including when a Duffel token is present.

### Requirement: Source selection by travel mode

An explicit flight or undecided leg SHALL try Duffel when configured. An explicit flight with supplier results SHALL return those results immediately. A bus or train SHALL use model-assisted web search. For an undecided leg with supplier results the endpoint SHALL put live flights first, append web bus/train rows, discard web flight duplicates and cap the combined list at six. The first live option remains recommended.

#### Scenario: Mixed sources

- **WHEN** an undecided traveler gets five Duffel offers and three web options comprising one flight and two trains
- **THEN** the result contains the five supplier flights and the first train, with one recommendation and supplier booking identifiers only on flight offers.

#### Scenario: Supplier unavailable

- **WHEN** an explicit flight search has no token, no usable airport pair, no offers, or a failed supplier request
- **THEN** Bop tries web research and can finish with an empty list if the model returns no usable row.

### Requirement: Web option price and evidence

The web path SHALL request the direction, destination country when resolved, travel date and preferred time window. OpenAI and Anthropic API calls use the fast model tier, low effort and at most four search tool uses. The normalizer SHALL return at most five rows with a carrier and parseable hour/minute strings. The shape includes `id`, `by`, `carrier`, `from`, `to`, `dep`, `arr`, `price`, `checked` and `src`. Optional fields include `code`, `bag`, `recommended` and `why`. IDs use the direction and one-based row number (e.g. `go-1`).

#### Scenario: Price with uncertain provenance

- **WHEN** the model supplies a positive price and a source URL absent from its search results
- **THEN** Bop rounds the per-person THB estimate and returns `checked: estimate` with empty source URL and title. A missing or nonpositive price becomes null.

#### Scenario: Web-verified citation

- **WHEN** the model marks an option as web-checked and its normalized HTTPS URL matches a recorded search result
- **THEN** Bop returns the source URL and title, marks it `web`, and provides no Duffel offer identifier.

#### Scenario: Recommendation normalization

- **WHEN** a web list contains several marked recommendations or none
- **THEN** Bop retains the first marked row or selects the first row, assigns a reason if missing, and emits a summary with count, carrier and times. An empty list emits a Thai no-results step.

### Requirement: Use selected options in planning and replanning

`/api/plan` SHALL reuse a valid supplied choice for each direction and otherwise search in parallel with plan design when `auto` is set or no time was supplied for a supported mode. Design uses 10:00 arrival and 20:30 departure while searching. `plan.flags.transport[dir]` stores the selected **ID** in `chosen` and the option objects in `options`.

#### Scenario: Substitute a better-fitting departure

- **WHEN** the recommendation falls outside the planner's arrival window of 07:00–12:00 or departure window of 19:30–23:00 and a candidate fits
- **THEN** the planner prefers a fitting live option, then web-checked, then estimated, with cheaper fares first within each rank. The selected arrival or departure time is applied to setup.

#### Scenario: Change flight from the bookings panel

- **WHEN** a replan identifies a different transport service
- **THEN** Bop matches its normalized service code or carrier and departure time, selects that option, or adds an estimated user-specified row. For a transit endpoint the inbound stop uses arrival time and the final stop uses departure minus 90 minutes for a flight or 40 minutes for bus/train.
