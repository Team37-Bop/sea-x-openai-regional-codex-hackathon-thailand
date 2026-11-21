# Planner interface specification

## Purpose

Describe the Thai organizer's journey across setup, plan generation, itinerary and bookings. These behaviors are traced to the reference frontend in `index.html`, `src/main.js` (show, startPlanning, loadPlan, renderPanel and the planner event handlers), `src/ui/api.js` (stream and health), and the production asset boundary in `server/index.mjs` and `server/security.mjs`.

## Requirements

### Requirement: Entry, readiness and sample selection

The normal entry point SHALL show trip setup, check model readiness and fetch public LINE configuration independently. The agent indicator SHALL distinguish checking, ready and sample mode. An explicit demo query SHALL load the built-in Chiang Mai trip.

#### Scenario: Offline organizer

- **WHEN** the health request times out after ten seconds, fails, or returns HTML
- **THEN** the client treats the agent as unreachable and offers the sample from setup. A reachable server reporting no usable model shows the configuration-specific explanation.

#### Scenario: Direct demo entry

- **WHEN** the organizer opens the planner with the `demo` query parameter
- **THEN** the sample opens with the first day selected and offline free-text replanning available. A regular successful generated plan opens with the whole-trip map selected.

### Requirement: Planning progress and recovery

The frontend SHALL show elapsed time and Thai progress, render completed days by their supplied indices, and commit a trip only after a terminal result supplies a nonempty days array. A superseded request SHALL have no effect on the current view.

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

The desktop workspace SHALL keep the timeline or booking list at the left and the map in the main area. Selecting a stop SHALL open a third adjacent column for place details and leave the map and itinerary interactive. On a narrow screen the map, expanded place card and selected tab content SHALL stack without a modal overlay.

#### Scenario: Exploring a place while keeping trip context

- **WHEN** the organizer selects an itinerary row or map marker
- **THEN** the same stop is selected on the map and timeline. The place card opens beside the map or below it at narrow widths. Escape or the close control restores focus to the stop.

#### Scenario: Open a timeline stop

- **WHEN** a traveler taps the place name, time or body of a stop, or activates its name with Enter or Space
- **THEN** the place panel opens. The card has one primary action named for the stop. Reservation actions remain independent. Meals on the committed itinerary also offer an inline menu toggle, which can expand or collapse without opening the place panel.
- **AND** the plan tab displays the trip summary and stop notes directly when available.
