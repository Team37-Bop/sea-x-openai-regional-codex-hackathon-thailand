## ADDED Requirements

### Requirement: Flight-status triggered replan
A flight-status event SHALL show an alert with "ให้ Bop ปรับแผน", and only that tap SHALL send `/api/replan` with a generated Thai command naming the flight, the route and the new times (or the cancellation), with `day` set to the first day for the outbound flight and the last day for the return flight.

#### Scenario: Outbound delay accepted
- **WHEN** the organizer taps "ให้ Bop ปรับแผน" on a 90-minute outbound delay
- **THEN** the UI sends "สายการบินแจ้ง: FD3433 DMK → CNX เลื่อนเป็น 09:30 ถึง 10:45" with `day: 0`, and the replan re-times day 1 with minimal edits

#### Scenario: Alert dismissed
- **WHEN** the organizer dismisses the alert
- **THEN** the plan is unchanged
