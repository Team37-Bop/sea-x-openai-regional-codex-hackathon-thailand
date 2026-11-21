## Why

Thai friend groups decide in LINE. Bop already writes a LINE-ready message for every replan option (`options[].line`, starting "Bop: ") and shows a LINE-style vote, but nothing is sent: votes are simulated or the organizer picks for the group. The LINE Messaging API and LIFF let Bop post plans and vote cards to the real group chat and collect each member's vote.

## What Changes

- A Bop LINE Official Account (Messaging API channel). The organizer adds it to the group chat; Bop links the group to the trip with a one-time code.
- Bop posts: the plan summary after planning, replan options as a Flex Message vote card (A/B/C postback buttons), the result, reservation tasks ("มิ้น: โทรจองร้าน…") and alerts from `add-live-weather` / `add-live-flight-status` when enabled.
- Votes arrive as postback webhooks, are mapped to members, tallied, and the winning option is applied in Bop (organizer breaks ties, as today).
- A LIFF app opens Bop inside LINE so members can see the plan, identify themselves ("ฉันคือ…") and vote with details.
- Without LINE keys, the in-app vote and LINE-style message preview stay as they are.

## Capabilities

### New Capabilities
- `line-messaging`: group linking, outbound messages, vote cards, webhook handling, LIFF identity, quotas.

### Modified Capabilities
- `replanning`: votes can be collected from the LINE group (added requirement); the in-app vote remains.

## Impact

- Code: new `server/line.mjs` (webhook, push/reply, Flex builders), `server/trips.mjs` (small persistent trip/vote store, which Bop does not have today), LIFF entry page, vote state in `src/main.js`, API.md changelog.
- Keys: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` and `LINE_LOGIN_CHANNEL_ID` (ID-token verification) stay server-side in ignored `.env.local` for development and the AWS runtime Secrets Manager document for deployment. `LIFF_ID` is a public app id returned by `/api/config`; it is not configured yet.
- Infra: CloudFront routes the public HTTPS webhook to a Regional streaming REST API Gateway and the Lambda `live` alias; the existing on-demand DynamoDB state table stores bounded LINE state.
- Privacy: LINE user ids and display names are personal data (PDPA); stored per trip only.
- No-key fallback: today's in-app vote, LINE-style preview with "คัดลอกข้อความ", organizer chooses for the group.
