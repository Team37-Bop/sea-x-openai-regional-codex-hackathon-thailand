# Planner interface specification

## Purpose

Describe the Thai organizer's journey across setup, plan generation, itinerary and bookings. These behaviors are traced to the reference frontend in `index.html`, `src/main.js` (show, startPlanning, loadPlan, renderPanel and the planner event handlers), `src/ui/api.js` (stream and health), and the production asset boundary in `server/index.mjs` and `server/security.mjs`.

## Requirements

### Requirement: Trip entry and readiness

The web app SHALL open the organizer's trip setup and check model readiness and public LINE configuration independently. The header and setup SHALL offer no sample trip launcher.

#### Scenario: Opening a trip link

- **WHEN** the organizer opens the planner with a saved local trip identifier
- **THEN** the app opens that trip. A bare URL or a legacy demo query with no saved trip opens setup.

#### Scenario: Service unavailable

- **WHEN** the health request fails or the configured server has no usable model
- **THEN** the readiness indicator describes the connection or configuration problem, and the draft remains available for retry.

### Requirement: Planning progress and recovery

On valid setup submission the interactive map SHALL appear immediately, centered on the destination's known coordinates or updated when its lookup completes. The desktop layout SHALL put compact progress in the left itinerary rail with the map on the right. A narrow screen SHALL keep the map above the scrollable progress. The planning rail and the replan response SHALL show chronological, connected progress steps as they arrive with no disclosure action. The active operation has a spinner and completed operations have checkmarks. Waiting for a decision, completing, failing or canceling stops the animation. An interrupted operation SHALL be distinguished from a completed one. Reduced-motion settings SHALL use a static active indicator. A complete terminal itinerary commits the trip. A superseded request SHALL have no effect on the current view.

#### Scenario: Group chooses places before planning

- **WHEN** the organizer asks to review candidate places
- **THEN** the interactive map and its planning status remain in the workspace during discovery. When answers are needed, a native dialog opens centered over the map on desktop and as a bottom sheet on narrow screens. The map remains underneath with known candidate coordinates. Answering or skipping returns to planning over that map, and retrying the final planning phase reuses the group's completed answers.

#### Scenario: Days arrive out of order

- **WHEN** day two arrives before day one and day two is later updated
- **THEN** the progress view shows day one before day two with two distinct days ready. Intermediate map snapshots update pins without counting a completed day. Preview routes require resolved geometry, and synthetic fallback locations are excluded. An existing trip keeps its map until new geographic results arrive. Canceling restores the committed map and draft form.

#### Scenario: Organizer edits during generation

- **WHEN** the organizer cancels or returns to edit setup
- **THEN** the client aborts the active request, retains its setup for editing and ignores late events from that request.

#### Scenario: Stream ends unexpectedly

- **WHEN** a response ends after steps or partial days and has no terminal event
- **THEN** the client returns a connection-cut error. The planning screen offers recovery instead of accepting the partial itinerary as complete.

#### Scenario: JSON events span network chunks

- **WHEN** one NDJSON line is split across response chunks, or a final complete line lacks a newline
- **THEN** the client assembles UTF-8 text, processes complete objects and retains the first terminal event. It skips blank or unparsable lines. A user cancellation is distinguishable from transport failure.

### Requirement: Itinerary and bookings views

The planner SHALL present itinerary and bookings tabs. The itinerary view SHALL show the current plan's check counts, per-day walking distance and per-person THB cost, travel legs, stops, and available closure or rain indications. The bookings tab SHALL expose applicable reservation tasks and cancellations.

#### Scenario: Day and stop selection

- **WHEN** the organizer selects a different day
- **THEN** the timeline changes, the previous stop selection clears and the map focuses on that day. Opening a stop displays its place details.

#### Scenario: Show the dates of the displayed itinerary

- **WHEN** the organizer views a trip, previews a revised duration, applies it or undoes it
- **THEN** the day selector displays one button per itinerary day, with its Thai weekday, calendar date, walking distance and per-person cost. The dates follow the itinerary across month and year boundaries. If the selected day is removed, selection moves to the last available day. Arrow-key navigation uses the displayed buttons.

#### Scenario: Reservation follow-up

- **WHEN** the current plan has calls to make or cancellations to handle
- **THEN** the itinerary presents a link to bookings and the bookings tab badge includes the call count. The organizer can mark a reservation done, reset it to pending, or respond to a full venue.

#### Scenario: Keyboard navigation

- **WHEN** a tab has focus and the organizer presses a horizontal arrow
- **THEN** focus and selection move between tabs, wrapping at either end. Enter or Space on a focused timeline stop opens it. Escape closes an open place sheet.

### Requirement: Preview, reset and separate trip state

An option preview SHALL use the candidate itinerary for display while retaining the committed plan. Loading a new trip SHALL establish an original-plan snapshot, clear local history, preview, reservation markers, cancellations and current stop selection, and begin at day one.

#### Scenario: Return to the initial plan

- **WHEN** the organizer resets a trip while a plan change is not running
- **THEN** the planner restores the initial live itinerary or regenerates the original sample, clears the edit history and reservation UI state, and selects day one. Single-step undo is specified in the replanning capability.

### Requirement: Production web boundary

The reference Node web server SHALL serve the built frontend with GET or HEAD and dispatch API paths to the shared handler. Browser-facing responses SHALL carry configured protection headers, including a self-only script policy, frame denial, MIME sniffing prevention and one-year HSTS.

#### Scenario: Missing frontend asset versus page navigation

- **WHEN** a missing file with an extension is requested without accepting HTML
- **THEN** the server returns 404. For a missing navigation path without an extension, or a request accepting HTML, it tries the SPA entry document. A HEAD request for an existing file returns the GET headers without a response body.

#### Scenario: Runtime bind configuration

- **WHEN** a valid `AWS_LAMBDA_HTTP_ENDPOINT` is present
- **THEN** the server listens on its advertised host and port. Otherwise it uses `HOST` and `PORT`, with defaults of `0.0.0.0` and `8787`. The API Gateway response-streaming Lambda entry point has a separate adapter.


### Requirement: Contextual plan changes

The organizer SHALL be able to describe a change in their own words. The itinerary SHALL check the weather automatically and offer a relevant action on the affected stop when a forecast warrants it.

#### Scenario: Opening a finished plan

- **WHEN** the organizer views a finished trip
- **THEN** the command area accepts a free-text request and omits hypothetical disruption shortcuts and a manual rain-check button.

### Requirement: Organizer booking workspace

Switching between the itinerary and bookings SHALL change the contents of the trip sidebar and retain the journey map. The booking view SHALL separate selected outbound and return transport, booked accommodation and nights, and time-sensitive calls from unconfirmed options.

#### Scenario: Following up a restaurant reservation

- **WHEN** a meal in the current plan needs a reservation
- **THEN** the booking card shows the date and time, the party size, any available phone number and a script using the group's requirements. A completed call can return to pending. A confirmed booking that moves to a new date or time requires rescheduling; removal creates a cancellation reminder.

#### Scenario: Returning to setup

- **WHEN** a saved trip is opened for editing
- **THEN** the form restores its members, dates, both travel legs, selected options and booked stays. Closing and reopening the form keeps the current draft for that trip.

### Requirement: Docked place cards and persistent map

The desktop workspace SHALL keep the timeline or booking list at the left and the map in the main area. Selecting a stop SHALL open a non-modal place panel anchored inside the left edge of the map. The timeline and map SHALL retain their width. On narrow screens the place panel SHALL attach to the bottom of the viewport, keep the map or itinerary partly visible, and offer a close action.

#### Scenario: Exploring a place while keeping trip context

- **WHEN** the organizer selects an itinerary row or map marker
- **THEN** the same stop is selected on the map and timeline. The place card opens along the left edge of the map or at the bottom of a narrow viewport. Escape or the close control restores focus to the stop.

#### Scenario: Open a timeline stop

- **WHEN** a traveler taps the place name, time or body of a stop, or activates its name with Enter or Space
- **THEN** the place panel opens. The card has one primary action named for the stop. Reservation actions remain independent. Meals on the committed itinerary also offer an inline menu toggle, which can expand or collapse without opening the place panel.
- **AND** the plan tab displays the trip summary and stop notes directly when available.
