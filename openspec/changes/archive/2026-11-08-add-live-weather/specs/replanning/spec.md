## ADDED Requirements

### Requirement: Rain-triggered replan
A rain alert SHALL offer "ให้ Bop ปรับแผน", and only that tap SHALL send `/api/replan` with a generated Thai command naming the day, the time window, the stop, the probability and the amount; the replan then follows the normal minimal-edit and vote rules.

#### Scenario: Organizer accepts
- **WHEN** the organizer taps "ให้ Bop ปรับแผน" on a heavy-rain alert for day 2 at น้ำตกบัวตอง
- **THEN** the UI sends a command like "พยากรณ์ฝนตกหนัก 14:00–16:00 วันที่ 2 ที่น้ำตกบัวตอง (โอกาส 80% ~4 มม./ชม.) ช่วยปรับแผนช่วงนั้นเป็นที่ในร่ม" with `day: 1`

#### Scenario: Organizer ignores the alert
- **WHEN** the alert is dismissed
- **THEN** the plan is not changed and no replan is sent
