## ADDED Requirements

### Requirement: Activity offers in the details sheet
For sight, nature, view and market stops the details sheet SHALL show matched activity offers below the details when any partner is configured, and picking an offer SHALL update the stop's `cost` to the offer's THB price per person only after the organizer confirms.

#### Scenario: Offer picked
- **WHEN** the organizer picks a ฿1,450 Doi Inthanon tour for a stop estimated at ฿300
- **THEN** after confirming, the stop's `cost` is 1450 and the budget check reruns

#### Scenario: No partner configured
- **WHEN** no activity key is set
- **THEN** the sheet shows only the research details as today
