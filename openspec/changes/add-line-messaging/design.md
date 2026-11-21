## Context

`/api/replan` returns `needs_vote`, `vote_reason` and options with `line` text. Before this change, the UI could only simulate votes or let the organizer pick for the group, and plans lived only in the browser. The deployed implementation now keeps compact trip, link, group, vote, deduplication and quota state in the shared DynamoDB table while full plan alternatives remain in the browser.

## Goals / Non-Goals

**Goals:**
- Real messages in the group's LINE chat and real votes from members.
- Identity mapping LINE user → trip member.
- Minimal server state, PDPA-conscious.

**Non-Goals:**
- One-to-one chat with Bop as a full chatbot (commands in LINE beyond voting) — later.
- LINE Pay (see `add-payments`).
- Rich menus beyond one "เปิดแผน" entry.

## Decisions

### Provider: LINE Messaging API + LIFF
- Messaging API channel under a LINE Official Account "Bop". Bot joins group chats (`join` event gives `groupId`).
- Outbound: reply API (`/v2/bot/message/reply`, free, needs a fresh `replyToken`) whenever an inbound event exists; push API (`/v2/bot/message/push` to `groupId`) otherwise.
- Vote card: Flex Message bubble per option (title, head, ฿ change per person, photo from `places` when present) with postback buttons `data: "v=<voteId>&o=A"`, `displayText: "โหวต A"`.
- Inbound: webhook `POST /api/line/webhook`, verified with `x-line-signature` (HMAC-SHA256 of the raw body with `LINE_CHANNEL_SECRET`), handling `join`, `leave`, `message` (link code), `postback` (vote), `memberJoined`.
- LIFF: an endpoint page in Bop registered in a LINE Login channel; `liff.init({ liffId })`, `liff.getIDToken()` sent to the server and verified via `https://api.line.me/oauth2/v2.1/verify` with `LINE_LOGIN_CHANNEL_ID`; the member picks "ฉันคือ…" once per trip.
- Alternatives: Messenger/WhatsApp (not where Thai groups plan), LINE Notify (discontinued 31 Mar 2025).

### Auth and keys
- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` and `LINE_LOGIN_CHANNEL_ID` stay server-side. Local development reads them from ignored `.env.local`; Lambda loads allowlisted values from the KMS-encrypted runtime Secrets Manager document named by `BOP_RUNTIME_SECRET_ID`. Existing process values win for controlled overrides, and values are never logged or stored in Terraform state.
- `LIFF_ID` is an app identifier that LINE requires in the browser; it is served by `/api/config` and is not a secret. No access token or secret reaches the browser. The deployed endpoint currently returns `liffId: null` until the LIFF app is configured.

### Request flow
1. Link: organizer taps "เชื่อมกลุ่ม LINE" → server creates a trip record and a 6-character code → organizer adds Bop to the group and types the code → webhook maps `groupId` ↔ trip and replies "เชื่อมทริป … แล้ว".
2. Plan posted: after `/api/plan` the UI calls `POST /api/line/post { tripId, kind: 'plan' }`; the server builds the message from the stored plan summary.
3. Vote: when a replan returns `needs_vote`, the UI stores options in the trip (`POST /api/trips/:id/vote`) and the server pushes the Flex vote card with a deadline (default 2 h).
4. Votes: postback → member mapping (LIFF identity, else the LINE display name matched to member names, else "ไม่ระบุ") → tally; one vote per LINE user (last wins) → UI polls `/api/trips/:id/vote` (or the LIFF page) and shows real votes instead of simulated ones.
5. Close: all members voted, deadline, or the organizer picks → winner applied in the UI (undo kept) → result message posted via reply when possible.
6. Tasks and alerts: reservation tasks and alerts are posted with the member's name (mention when the LINE user id is linked).

### Server state
The shared on-demand DynamoDB POC table stores one item per trip plus short-lived lookup, webhook-deduplication and quota items. Trip items contain members, compact vote options and ballots; they do not contain passenger details or all candidate plan copies. `record_key` forms are `TRIP#<id>`, `LINK#<code>`, `GROUP#<groupId>`, `LINE_EVENT#<eventId>` and `LINE_QUOTA#<YYYY-MM>`. TTL removes link codes after 30 minutes, dedupe records after 24 hours, quota records after about 40 days, and trip/group identity data 30 days after the trip ends. Local development uses a gitignored JSON fallback.

### Caching
Not applicable beyond the trip store; profile names fetched once per user per trip.

### Cost and quotas
- LINE OA pricing in Thailand: the free plan includes a small monthly message quota and paid plans add more; push messages count per recipient in the group, reply messages are free. Prefer reply tokens; post one combined message per event.
- Guards: `BOP_LINE_MONTHLY_CAP`; no pushes for minor updates.

### Fallback to today's no-key path
No LINE keys, webhook unreachable or quota reached → the vote card works in-app exactly as today, the `line` text has "คัดลอกข้อความ" for manual posting, and the organizer can choose for the group.

### ToS constraints
- LINE Official Account and Messaging API terms: no spam, users can leave/block, follow LINE's Flex Message and branding guidelines; the bot's display name is "Bop" (never another brand).
- PDPA: tell members what is stored (LINE id, display name, votes) in the LIFF page; delete on request.

## Risks / Trade-offs

- [Bop originally had no server-side trip store] → use the existing serverless DynamoDB state table with TTL, PITR and deletion protection; keep full plan alternatives in the browser to stay below the DynamoDB item limit.
- [Members not identified] → LIFF "ฉันคือ…" once; fallback to display name match.
- [Quota cost for big groups] → reply-first strategy and caps.
- [Webhook needs public HTTPS] → production host; tunnel in development.

## Migration Plan

Completed: local signed-webhook tests, DynamoDB-backed state, CloudFront/API Gateway/Lambda deployment, LINE webhook URL configuration, LINE's built-in `200 OK` test and production forged-signature rejection. Remaining gates: enable **Use webhook** in LINE Developers Console, configure `/liff.html` and `LIFF_ID`, then run an owner's-group test. Rollback: remove the LINE fields from the Secrets Manager document; the in-app vote remains.

## Open Questions

- Should non-organizers be able to send replan commands from LINE ("@Bop ฝนตก")?
- Vote deadline default: 2 h, or tied to the event time?
