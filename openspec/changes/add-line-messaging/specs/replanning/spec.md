## ADDED Requirements

### Requirement: Real votes in the vote card
For a trip linked to a LINE group, the replan vote card SHALL show the ballots received from LINE instead of simulated votes, list who has not voted, and apply the winning option with undo when the vote closes; for unlinked trips the vote card SHALL behave as today.

#### Scenario: Linked trip
- **WHEN** a replan needs a vote on a linked trip
- **THEN** the card shows "ส่งให้กลุ่มโหวตใน LINE แล้ว" and updates as members vote

#### Scenario: Unlinked trip
- **WHEN** the trip is not linked
- **THEN** the organizer can still choose for the group in the app
