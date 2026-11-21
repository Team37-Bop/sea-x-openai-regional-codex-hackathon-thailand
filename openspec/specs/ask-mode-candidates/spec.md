# ask-mode-candidates Specification

## Purpose
In ask mode (`autonomy: 'ask'`) Bop first proposes candidate restaurants, sights and stay areas with photos, the group answers each one, and `/api/plan` then plans around the answers. Code: `runCandidates` in `server/agent.mjs`, `candidates`/`findPages` in `server/claude.mjs` and `server/cli-llm.mjs`, the ask dialog in `src/main.js`.

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
The UI SHALL show questions one at a time with each option answered สนใจ, ไม่เอา or ไม่แน่ใจ, and SHALL send `picks = { must: [full option objects answered สนใจ], avoid: [ids answered ไม่เอา] }`; ไม่แน่ใจ, skipped questions and "ให้ Bop เลือกที่เหลือเอง" SHALL add nothing.

#### Scenario: Skip to auto
- **WHEN** the organizer presses Escape in the ask dialog
- **THEN** planning starts in auto mode with the answers given so far

#### Scenario: Photo badge
- **WHEN** an option photo has `match: 'likely'`
- **THEN** the card shows the badge "รูปจากเว็บ"
