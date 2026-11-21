# ask-mode-candidates Specification

## Purpose

Ask mode collects group preferences before itinerary design. The candidate service discovers places, enriches them with coordinates and images, and retains enough metadata to interpret the next request. Reference evidence in prep commit `292ba5f` includes `server/agent.mjs` (`runCandidates`, `normalizeSetup`, `matchesPick`, `pickIssues`), `server/photos.mjs`, `server/openai.mjs`, `src/main.js` (`startAsk`, `normQuestions`, `askAct`), `src/ui/place.js`, and `scripts/test-images.mjs`.

## Requirements

### Requirement: Candidates request
`POST /api/plan/candidates` SHALL accept `{ setup }`, run one fast-model call with up to 5 web searches, and end with `done.questions` of at most 3 questions `{ id, kind: 'food'|'sight'|'stay', title, multi: true, options }` with at most 6 options each.

#### Scenario: Member with food restrictions
- **WHEN** a member has `avoid` (allergies or foods they do not eat)
- **THEN** the prompt lists each such member with their `avoid` text and asks the model to state for every restaurant whether it has dishes they can eat

### Requirement: Option shape and ids
Each option SHALL be `{ id, name, why, tags (max 4), price?, ll?, photo?, src? }` with an id unique per server run (`c<run>_<slug>`); the server SHALL remember each id with its name, query, coordinates and kind so later `picks` can be resolved, and `src` SHALL be present only for a URL the search returned.

#### Scenario: Avoid by id
- **WHEN** `/api/plan` receives `picks.avoid: ['c3_wat_umong']`
- **THEN** the server resolves it to the remembered name and query

### Requirement: Candidate coordinates
Option coordinates SHALL be geocoded with the same rules as plan stops, in parallel with the photo search, and `ll` SHALL be returned only when valid.

#### Scenario: Geocoded option
- **WHEN** an option's name matches an OSM POI near the model's coordinates
- **THEN** its `ll` is the OSM point

### Requirement: Candidate photos
Each option SHALL get at most one https photo `{ url, credit, page, match }` in confidence order: Wikimedia exact match; og:image of the place's own `photoPage`; og:image of its source page (pass 1, capped at 15 s); Commons files within 300 m (capped at 10 s); then one cheap fast-model page search per option still missing a photo (6 at a time, capped at 60 s), where stay areas search the area itself.

#### Scenario: Small restaurant without Wikimedia
- **WHEN** no Wikimedia or Commons image matches
- **THEN** a page search finds the restaurant's own pages and the first og:image that names the place is used with `match: 'likely'`

#### Scenario: Summary step
- **WHEN** the search ends
- **THEN** the step "ได้ N คำถาม · M ตัวเลือก · มีรูป K" is emitted

### Requirement: Answering in the UI
Once candidates are ready, the UI SHALL present one question at a time in a native modal over the planning map, centered on desktop and attached to the viewport bottom on narrow screens. Focus SHALL move to the question heading on opening and on advancing. Each option can be answered สนใจ, ไม่เอา or ไม่แน่ใจ. The next planning request SHALL send `picks = { must: [full option objects answered สนใจ], avoid: [ids answered ไม่เอา] }`. Skipped questions and uncertain options contribute no picks.

#### Scenario: Skip to auto
- **WHEN** the organizer presses Escape in the ask dialog
- **THEN** planning starts directly with the original setup and the answers collected so far

#### Scenario: Return to the trip draft
- **WHEN** the organizer chooses กลับไปแก้ข้อมูลทริป in the survey
- **THEN** the survey closes, planning is canceled, and the existing setup draft regains focus

#### Scenario: Photo badge
- **WHEN** an option photo has `match: 'likely'`
- **THEN** the card shows the badge "รูปจากเว็บ"

### Requirement: Question and option normalization

The candidate handler SHALL validate the setup as for normal planning, omit previous picks from the discovery prompt and localize search using the destination city and country when resolved. It SHALL inspect the first three model questions, drop questions with no named options, and limit the surviving named options to six per question. Unrecognized kinds default to `sight`. The response carries `questions`, elapsed milliseconds and aggregated `usage`.

#### Scenario: Blank question title or repeated option IDs
- **WHEN** the model supplies a blank title, unnamed options or multiple options with the same slug
- **THEN** the server uses a Thai fallback title, drops unnamed options and adds trailing underscores until each generated option ID is unique across that response

#### Scenario: Descriptive metadata
- **WHEN** the model supplies a long name, explanation, price hint and tags
- **THEN** the name is limited to 120 characters, the explanation to 200, the optional price hint to 60, and at most four nonempty tags of 24 characters each survive. A displayed source requires both a web check and a URL recorded by the search

#### Scenario: Photo metadata and failures
- **WHEN** an option lacks its own confirmed source but the model supplied a public page as a photo hint
- **THEN** the collector can inspect the page for a matched image independently of source verification. The option returns a successful photo or omits it. Research-only queries, aliases, page hints and temporary geocoding inputs are removed from the response

### Requirement: Pick continuity and limits

The server SHALL remember each option’s name, query, resolved coordinates and kind in process memory. When normalizing the planning request it SHALL accept up to 15 named must-pick objects and the first 30 avoided entries. Valid coordinates on a submitted must-pick take precedence over remembered coordinates. Must-picks can match by name, query or distance of at most 250 m. Avoided places match by name or remembered query.

#### Scenario: Process restarted between steps
- **WHEN** the organizer supplies a complete must-pick object but the server no longer has its ID in memory
- **THEN** the submitted name and valid coordinates can still be used. A bare unknown avoid ID supplies only its string as the fallback name, so durable ID resolution across instances is unavailable

#### Scenario: One option selected twice
- **WHEN** a user repeats the same answer on a candidate card
- **THEN** the UI clears that answer. Skipping a question clears all answers on the current question and preserves earlier answers

#### Scenario: Candidate discovery returns no choices
- **WHEN** the response has no usable questions after normalization
- **THEN** the browser starts itinerary design directly. For older responses containing a flat `candidates` array it first groups options into questions

#### Scenario: Cancelled or replaced request
- **WHEN** another planning operation supersedes candidate discovery
- **THEN** the UI aborts the earlier request and ignores subsequent results from the old request
