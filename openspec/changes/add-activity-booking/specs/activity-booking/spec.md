## ADDED Requirements

### Requirement: Activity offer search
The server SHALL provide `POST /api/activities` that accepts `{ city, country, date, stop }` and returns up to 3 offers `{ provider, title, priceTHB, priceLocal?, durationMin?, freeCancel?, rating?, reviews?, url, bookable, productCode }` from the configured partners, queried in parallel with a 5 s timeout each.

#### Scenario: Doi Inthanon
- **WHEN** a nature stop "ดอยอินทนนท์" is opened for 21 Nov
- **THEN** offers for Doi Inthanon day trips available that day are returned with THB prices

### Requirement: Offer matching
An offer SHALL be attached to a stop only when its title or destination matches the stop's name variants and it lies within 10 km of the stop (or is a tour to that place); other nearby offers SHALL be shown only under "ทัวร์ใกล้เคียง".

#### Scenario: Different camp
- **WHEN** the best search result is a different elephant camp 20 km away
- **THEN** it is not attached to the stop

### Requirement: Affiliate links and disclosure
In phase 1 every offer SHALL open the partner's page with Bop's affiliate parameters and SHALL show "Bop อาจได้รับค่าคอมมิชชันจากการจองผ่านลิงก์นี้"; prices SHALL be labelled "ราคาอาจเปลี่ยน" and converted prices "≈".

#### Scenario: Klook offer
- **WHEN** the organizer taps "จองล่วงหน้า" on a Klook offer
- **THEN** the Klook page opens with `KLOOK_AFFILIATE_ID` in the link

### Requirement: Booking through partners
Direct activity booking SHALL be available only with partner full access (e.g. Viator merchant access) and SHALL check availability, hold, show an approval screen with total and cancellation terms, take payment through `add-payments` and only then book; it SHALL never book automatically.

#### Scenario: No full access
- **WHEN** only affiliate access is configured
- **THEN** offers have `bookable: false` and open the partner site

### Requirement: Activity keys
`VIATOR_API_KEY`, `KKDAY_PARTNER_KEY` and other partner API keys SHALL be read from `.env.local` on the server only and never sent to the browser; affiliate ids MAY appear in outbound links.

#### Scenario: No keys
- **WHEN** no activity partner is configured
- **THEN** `/api/activities` returns no offers and the stop keeps its web-estimated cost
