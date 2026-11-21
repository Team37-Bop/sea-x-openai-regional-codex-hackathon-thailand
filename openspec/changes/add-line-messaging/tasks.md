## 1. Setup

- [x] 1.1 Create the "Bop" LINE Official Account, Messaging API channel and LINE Login channel
- [x] 1.2 Store `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` and `LINE_LOGIN_CHANNEL_ID` in ignored `.env.local` for development and the AWS runtime Secrets Manager document for deployment
- [x] 1.3 Deploy and configure the CloudFront webhook URL; LINE's built-in test returns `200 OK`, and a forged signature returns `401 invalid_signature`
- [ ] 1.4 Enable **Use webhook** in LINE Developers Console (`active` was false at the last channel API check)
- [ ] 1.5 Create/configure the LIFF app at `/liff.html`, add public `LIFF_ID`, and resync the runtime secret (`/api/config` currently returns `liffId: null`)

## 2. Server state

- [x] 2.1 Add `server/trips.mjs` with DynamoDB in AWS, a local JSON fallback and 30-day post-trip retention
- [x] 2.2 Trip endpoints: create/link code, store plan summary and vote, read vote state, delete personal data

## 3. LINE integration

- [x] 3.1 `server/line.mjs`: raw-body signature check, reply/push, Flex vote card builder, profile lookup
- [x] 3.2 Webhook `POST /api/line/webhook`: join, leave, message (link code), postback (vote), memberJoined
- [x] 3.3 Monthly push cap, webhook deduplication and reply-first strategy

## 4. LIFF and UI

- [x] 4.1 LIFF entry page: ID token verification, "ฉันคือ…" member pick, plan summary and vote view
- [x] 4.2 Planner: "เชื่อมกลุ่ม LINE", real ballots in the vote card, manual-copy fallback
- [x] 4.3 `/api/config` serves `LIFF_ID` only

## 5. Contract and verification

- [x] 5.1 API.md changelog and KEYS.md update
- [x] 5.2 Tests: signature verification, ballot mapping, last-vote-wins, tie, deadline, retention and no-key path
- [x] 5.3 AWS smoke checks: LINE is enabled, secrets remain server-side, and the production webhook rejects an invalid signature
