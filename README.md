# Bop · ไปด้วยกัน

**Better trips together.** Bop turns “Where should we go?” and “What if the plan changes?” into a shared itinerary, with the trade-offs visible before the group decides.

**Team 37 · Sea × OpenAI Regional Codex Hackathon Thailand · 21 November 2026**

Build direction: **AI-Native Products & Operations** · [Event](https://luma.com/39zve8ph)

[Open Bop](https://d2nlguqr61q2jd.cloudfront.net/) · [Release runs](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/actions/workflows/ci-cd.yml) · [Architecture runbook](terraform/README.md) · [OpenSpec](openspec/README.md)

## Judge walkthrough

1. **Plan together.** Start a Chiang Mai trip, add friends with different budgets, walking limits, dietary needs and must-visit places. Let Bop plan immediately or ask the group to choose places first. In the choice flow for an overnight trip without a booked stay, pick a named hotel before restaurants and sights; this is a preference, not a room reservation.
2. **Inspect the plan.** Follow the streamed planning stages. Start on the day map for that day’s route; switch to the whole-trip map for places. Open a stop and compare sourced details with estimates. If the map is unavailable, the itinerary remains usable.
3. **Change one thing.** Ask in Thai to remove a stop that is actually in the itinerary while keeping flights and meals unchanged. Compare changed stops, time and cost; use Undo to restore the previous plan. For a change involving trade-offs, inspect alternatives and the vote flow. A configured LINE group can receive Flex cards. Open **ดูสรุปทริป** from a card, choose your name and review the day-by-day summary; if a vote is open, vote from LINE or LIFF. Use an authorized test group only.

Bop keeps the edit, the evidence and the group decision in one workflow. It does not treat a chat answer as consensus or a booking.

## How the product works

- **OpenAI at runtime:** interprets Thai requests, researches places, proposes the itinerary and drafts targeted edits. The planner streams progress and partial results into the interface. In the transport comparison flow, independent Duffel and AI-assisted research can run in parallel; an explicit flight search starts with Duffel and uses AI research as a fallback.
- **Deterministic code:** normalizes inputs, schedules and routes stops, checks constraints, calculates before/after differences, and applies vote and undo rules. Unverified prices and route estimates are not guarantees.
- **People:** set preferences, compare options and make decisions. Flight checkout is a separate, explicitly confirmed flow in supported configurations.

```mermaid
flowchart LR
  U["Browser / Thai planner"] --> CF["CloudFront + edge AWS WAF"]
  CF -->|"Static files via OAC"| S3["Private S3"]
  CF -->|"/api/*"| AP["Regional REST API Gateway + WAF"]
  LINE["LINE group / LIFF"] -->|"Signed webhook / verified identity"| CF
  AP -->|"Streamed NDJSON response"| L["Node.js Lambda"]
  L -->|"Plan / research / replan"| O["OpenAI"]
  L -->|"Operational records"| D["DynamoDB"]
  L -->|"Provider configuration"| S["KMS-encrypted Secrets Manager"]
  G["GitHub Actions + Terraform"] -->|"OIDC deployment"| CF
  G -->|"Versioned release"| L
```

**Data flow:** CloudFront serves the frontend from private S3. Planning requests go through API Gateway to Lambda; progress streams back to the browser. The editable plan lives in the browser, while DynamoDB stores operational records such as LINE links, trip summaries, votes, delivery deduplication, and booking idempotency. The frontend defers map assets until needed and bundles planner assets for delivery. GitHub Actions tests and packages releases; Terraform manages AWS infrastructure. See the [runbook](terraform/README.md) for environment controls and rollback.

## What is live, configurable, or not built

| Surface | What to expect |
| --- | --- |
| OpenAI planning | Live in the deployed planner when configured. Local fixture mode is available without a model key. |
| Maps, routes and weather | MapLibre GL, OpenFreeMap, and OpenStreetMap-based geocoding/routing (OSRM and Valhalla). Daily routes connect consecutive stops with known locations; the whole-trip view is for places. Estimated legs are labeled. Open-Meteo supplies forecast context; demo disruption scenarios are not automatic flight or weather alerts. |
| LINE | Group linking, Thai Flex messages, day-by-day summaries and voting are implemented. Requires Messaging API setup plus LINE Login and LIFF for member identity. The six-character code only links the bot to a group; friends view the summary from the trip-specific link in the bot card. Set the registered LIFF Endpoint URL to the deployed `/liff.html` (not the LINE default placeholder), then verify a trip link on a real LINE device. |
| Lodging and flight bookings | Duffel test-mode offer, review, order and cancellation paths. No real ticket purchase or customer payment is being demonstrated. Named hotel choices are incorporated into the plan but do not reserve a room. Bop does not make hotel or activity reservations. Missing hotel rates are excluded from the total; that total does not establish that the trip is within budget. |

## Hackathon work and evidence

The prep repository provided a behavior reference, not the submitted application. During the event, Team 37 built the competition implementation: Thai map-first setup and planning, streamed research, targeted replan with comparison and undo, configurable LINE voting, and the AWS deployment path. The [OpenSpec guide](openspec/README.md) identifies the pinned prep baseline and 15 behavior specifications. The [Codex skills](.codex/skills/) document the spec workflow. See [PR #9](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/pull/9) for a Codex-assisted visual change with workflow regression checks and [PR #12](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/pull/12) for the LINE Flex release with mocked message checks. Later work added [source links and condition display (#16)](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/pull/16), [LIFF day summaries (#17)](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/pull/17), [startup and transport improvements (#18)](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/pull/18), and [lodging choices and daily routing (#19)](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/pull/19). Inspect [the implementation history](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/commits/main/) and tests for what was built and verified.

| Judging criterion | Evidence to inspect |
| --- | --- |
| Problem & Solution Fit | Multiple travelers, one plan: budget, walking, meals, preferences and timing are visible in setup and checks. |
| Build Quality | Streamed UI, explicit estimates, edit and undo, integration tests and a reproducible AWS release. |
| Insight & Originality | A disruption is a reviewable change to a shared plan, not a regenerated itinerary that hides changes. |
| Real-World Value | Friends can evaluate trade-offs, vote in LINE when configured, and keep track of booking follow-ups. |
| Alignment with Build Direction | AI drives research and replanning; code and people retain control over decisions. |
| Use of Codex | Checked-in OpenSpec workflow, behavior requirements and regression tests make implementation and verification reviewable. |

**Verification and limits:** the verified all-Flex release at [`8013681`](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/commit/8013681aed6588cd248ab997fe162147ba9210b8) passed **116 tests** and the production build. A separate live one-day Chiang Mai smoke test verified generation, a Thai request to remove Three Kings Monument while keeping flights and both meals, and Undo restoring the stop. Map initialization failed in that cloud browser; the itinerary still worked. Automated LINE and Duffel checks use mocks or fixtures, not a live group send or real purchase. A separate public endpoint check verified the LINE redirect was corrected to Bop’s LIFF page; it did not authenticate or access a real trip.

**Current source snapshot:** [`6cfaada`](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/commit/6cfaada0e0344f818f7724ff9dc29870cf35092c) includes PR #19. [CI and AWS run #63](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/actions/runs/44891209160) completed successfully for that commit. [PR #19](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand/pull/19) records browser checks for lodging choices and route display. The earlier live Chiang Mai smoke does not cover those new paths. Release CI checks API health and private-origin protection; it does not substitute for a judge-device map or LINE sign-in check.

## เปิดบนเครื่อง

ใช้ Node.js 24 และ npm จากโฟลเดอร์โครงการ

```sh
npm ci
npm run build
npm start
```

เปิด [หน้าตั้งค่าทริป](http://localhost:8787/) เพื่อเริ่มวางแผน แผนที่พื้นหลังใช้ไทล์จาก OpenFreeMap ผ่านอินเทอร์เน็ต

หากต้องการสร้างทริปด้วย OpenAI ให้คัดลอก `.env.example` เป็น `.env.local` ตั้ง `BOP_PROVIDER=openai` กับ `OPENAI_API_KEY` แล้วเริ่มเซิร์ฟเวอร์ใหม่ โหมด `BOP_FAKE_LLM=1` ใช้ข้อมูลทดสอบเพื่อเดินผ่านหน้าสร้างทริปและเลือกสถานที่ ส่วน Anthropic API และ Claude CLI เลือกได้ด้วย `BOP_PROVIDER` ตรวจโหมดที่เลือกได้ที่ [สถานะบริการ](http://localhost:8787/api/health)

สำหรับเครื่องที่ใช้เดโม ตั้ง `HOST=127.0.0.1` และ `BOP_LOCAL_DEMO=1` เพื่อเปิดทริปที่สร้างเสร็จจากลิงก์เดิม แม้รีสตาร์ตแอป ข้อมูลแผน 8 ทริปล่าสุดอยู่ใน `server/.cache/showcase/` บนเครื่องนั้น

## งานที่ลองได้

- ตั้งปลายทาง วันเดินทาง โรงแรมหลายแห่ง อาหารที่เลี่ยง งบ และระยะเดินของสมาชิกแต่ละคน
- ให้ Bop จัดแผนทันที หรือให้กลุ่มเลือกสถานที่ก่อน ดูความคืบหน้ารายวัน ค่าใช้จ่าย ระยะเดิน เงื่อนไข และแหล่งข้อมูลสถานที่
- ในโหมดให้กลุ่มเลือกก่อน สำหรับทริปค้างคืนที่ยังไม่ได้จองที่พัก เลือกชื่อโรงแรมก่อนร้านอาหารและสถานที่เที่ยว ระบบใช้ตัวเลือกนี้จัดแผน แต่ไม่ได้จองห้อง
- เปิดแผนที่รายวันเพื่อดูเส้นทาง หรือสลับเป็นภาพรวมเพื่อดูจุดแวะ เส้นประแสดงช่วงที่ประเมินจากพิกัด ดูการพยากรณ์ฝนจาก Open-Meteo แล้วเลือกว่าจะปรับแผนหรือไม่
- ดูตัวอย่างทางเลือก โหวต ย้อนการแก้ไข และติดตามการจองในแท็บการจอง
- เมื่อกำหนดค่า LINE แล้ว ผู้จัดใช้รหัส 6 ตัวเชื่อมบอตกับกลุ่ม เพื่อนเปิด **ดูสรุปทริป** จากการ์ดของบอตเพื่อดูแผนแยกวันและโหวตเมื่อเปิดให้โหวต รหัสนี้ไม่ใช้ค้นหาทริปบนเว็บ
- เมื่อใช้ Duffel test token ให้ลองค้นข้อเสนอ ตรวจราคาสุทธิและสัมภาระ ยืนยันจอง หรือขอราคาและยืนยันการยกเลิกแยกกัน
- ปลายทาง LINE webhook คือ `/api/line/webhook` และ LIFF คือ `/liff.html` การเปิดจองตั๋วจริงนอกเครื่องต้องมีการยืนยันตัวตนจาก API Gateway authorizer

## ตรวจ build

```sh
npm test
openspec validate --all --strict --no-interactive
npm run package:lambda
```

คำสั่งแพ็กติดตั้ง dependencies จาก lockfile ทดสอบแอป ตรวจช่องโหว่ระดับ high ของ dependencies ที่ใช้จริง และสร้างเว็บใน `dist/` จากรายการไฟล์สาธารณะที่กำหนดไว้ใน `scripts/build.mjs` เมื่อเพิ่มไฟล์หน้าเว็บให้เพิ่มชื่อในรายการนั้นด้วย ตัวแพ็กตรวจ MapLibre worker และทดสอบ health กับการสตรีมแผนสามวันจาก Lambda ที่บันเดิลใน `.build/lambda/`

GitHub Actions ตรวจ pull request และใช้ OIDC เพื่อ deploy จาก main ไปยัง CloudFront, private S3, API Gateway และ Lambda ทำตาม [คู่มือ Terraform](terraform/README.md) สำหรับ bootstrap, repository variables, การเลือก runtime secret, การตรวจผล และ rollback

[OpenSpec ทั้ง 15 ส่วน](openspec/README.md) ระบุพฤติกรรมและเกณฑ์ทดสอบของการเขียนแอปใหม่ ทักษะ OpenSpec สำหรับ Codex อยู่ใน `.codex/skills/`

เส้นทางตัวอย่างเชียงใหม่ใช้ข้อมูล © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) และคำนวณผ่าน [OSRM บน routing.openstreetmap.de](https://routing.openstreetmap.de/)
