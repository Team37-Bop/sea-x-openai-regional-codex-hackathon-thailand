# AWS architecture and API readiness

> **Classification: CONFIDENTIAL** — This document names security gaps and controls. Keep it with the authorized repository.

This is an implementation-focused review against the AWS Well-Architected pillars. It is not a formal AWS Well-Architected Tool workload review.

## Workload decision

Use a Regional REST API Gateway with a Node.js Event Function because API Gateway is a required front door and Bop's NDJSON model responses need response streaming. HTTP API does not support response streaming, while REST API streaming can run for up to 15 minutes. The frontend is a private S3 bucket reached only through CloudFront OAC. CloudFront routes `/api/*` to API Gateway and attaches edge WAF controls; a second Regional WAF protects the directly addressable API endpoint.

AWS selects the OpenAI Responses API using a service-account key from Secrets Manager. The existing quality tiers map as follows: Claude Opus → `gpt-6.2-astra`, Sonnet → `gpt-6.2-sol`, and Haiku → `gpt-6-luna`. Anthropic remains a supported fallback provider.

DynamoDB stores only POC operational state: 24-hour idempotency records and 90-day non-PII booking audit records. It uses on-demand capacity, PITR, TTL, deletion protection, and no Streams. This table boundary follows the only current joint access pattern; itinerary state remains client-side.

## Feature and API findings

| Area | Finding | Implemented control | Remaining decision |
|---|---|---|---|
| Public API | Plan and research routes have no end-user identity or per-user quota. | Edge and Regional WAF, per-IP limits, API Gateway throttling, and account-level Lambda safeguards. | Add Cognito or LINE Login plus per-user quotas before public production. |
| Paid operations | Flight order and cancellation can cause external side effects. | Live booking stays disabled. Both confirmation paths use DynamoDB idempotency records; cancellation uses the same booking gate as ordering. | Add booking-owner authorization and a durable reconciliation process before live mode. |
| Secrets | Local credentials must not enter Git or Terraform state. | `env.local` was normalized to ignored `.env.local`; Terraform creates an empty KMS-encrypted secret; Lambda loads an explicit key allowlist at runtime. | Establish vendor-specific rotation procedures. |
| Input boundary | The server allowed JSON primitives and requests without JSON content type. | POST routes require `application/json`; parsed bodies must be objects; body size remains capped at 2 MiB. | Add endpoint-specific schemas before broad public use. |
| Browser security | The original server emitted no baseline security headers. | CSP, HSTS, frame denial, MIME protection, referrer and permissions policies, plus CloudFront's managed security headers. | Exercise all map/photo paths under CSP before narrowing host allowlists. |
| Map runtime | MapLibre 6 loads a separate module worker that Vite did not emit automatically. | Build copies `maplibre-gl-worker.mjs`, Terraform serves `.mjs` as JavaScript, and packaging fails if it is missing. | Keep this regression assertion when upgrading MapLibre. |
| Image parsing | Model output can wrap image and source URLs in Markdown, which the URL parser rejected and the UI displayed literally. | Server and browser unwrap Markdown image/link syntax, validate HTTP(S), store canonical URLs, and remove Markdown from display text. | Continue rejecting non-web and credential-bearing URLs. |
| Dependencies | MapLibre 4.7.1 had a critical sanitizer-bypass advisory. | MapLibre is pinned to 6.19.0; production dependencies audit clean. | Vite 5 has dev-server advisories; keep development local and plan a tested Vite 8 migration. |
| Runtime state | Route/geocode/weather caches used package-relative disk. | Lambda uses disposable `/tmp`; durable order/idempotency records use DynamoDB. | Move other caches only if measured external-call cost justifies it. |
| External services | Routing, weather, photos, models, and travel APIs can fail independently. | Existing timeouts, fallbacks and circuit breakers remain; API/Lambda alarms cover failures. | Define SLOs and synthetic plan/replan journeys. |
| Delivery identity | Interactive SSO cannot run unattended CI safely. | Humans use IAM Identity Center; GitHub OIDC trust is restricted to one repository, branch, and audience. | Regenerate the role policy whenever Terraform adds a service. |
| Origin exposure | Public S3 would bypass CloudFront and WAF. | S3 Block Public Access and OAC policy admit only the exact distribution. | API Gateway remains public for the POC; user auth is the production boundary. |
| LINE personal data | Group IDs, user IDs, display names and ballots are PDPA-relevant. | Raw-body HMAC verification, hashed organizer token, least-privilege table access, TTL, manual deletion and no IDs in public API responses. | Add the missing `LIFF_ID`, publish a privacy notice and test in an owner-controlled group. |

## DynamoDB access model

The table primary key is `record_key` (String). Lambda derives it server-side; clients cannot supply a table key directly.

| Entity | Attributes | Approximate bytes | Source |
|---|---|---:|---|
| Idempotency | key, request hash, status, timestamps, TTL, optional response | 1,024 | conservative guess |
| Order audit | order/offer IDs, reference, mode, totals, timestamps, TTL | 512 | current response shape |
| LINE trip/vote | title, member aliases, identity mappings, compact options, ballots, TTL | 16,384 | conservative POC ceiling |
| LINE lookup/dedupe/quota | trip reference or counter, timestamps, TTL | 512 | current record shape |

These are estimates, not measured item sizes. No free-text itinerary or passenger data is written. A future authenticated production model should include the server-verified user ID in the partition key or split booking data into a separate authorization-aligned table.

## Well-Architected alignment

### Operational Excellence

- GitHub Actions runs tests, production dependency audit, builds, packaging, Terraform checks, and a post-deploy smoke test.
- A saved Terraform plan is applied unchanged. Lambda aliases provide an explicit rollback target.
- CloudWatch logs, access logs, WAF logs, alarms, and a dashboard are declared as code.
- Gap: model-backed end-to-end tests are not in CI because they consume paid external APIs.

### Security

- OIDC and SSO use temporary credentials; no long-lived AWS access keys exist.
- Terraform checks the full account ID and the `0081` suffix before planning or applying.
- Secrets Manager holds API credentials under a rotating customer-managed KMS key; values remain outside state.
- Private S3 plus CloudFront OAC prevents origin bypass. Regional WAF limits direct API Gateway access.
- Gap: API Gateway authorization is `NONE` for the public POC. Do not enable real payments or booking before adding user auth.

### Reliability

- Existing provider fallbacks and circuit breakers remain.
- S3 state/artifact/frontend buckets use versioning. DynamoDB has PITR and deletion protection.
- Conditional DynamoDB writes guard idempotency and prevent silent overwrite or phantom updates.
- Gap: an ambiguous upstream booking timeout is quarantined as `UNCERTAIN` and needs an operator reconciliation workflow before live mode.

### Performance Efficiency

- CloudFront caches immutable Vite assets and bypasses cache for `/api/*`.
- REST API and Lambda stream NDJSON instead of buffering long model results.
- Lambda runs on arm64 with a 1 GiB initial setting; esbuild produces a deterministic 4.4 MB uncompressed package instead of packaging a runtime-specific `node_modules` tree.
- Gap: the frontend bundle remains large and should be split if field measurements show slow startup.

### Cost Optimization

- Lambda and DynamoDB on-demand avoid idle servers.
- API throttling and WAF limits cap accidental compute/model usage. The account's current Lambda quota cannot reserve three executions while preserving AWS's required unreserved pool, so no function-level reservation is set.
- A tag-scoped monthly budget starts at USD 50 after cost-allocation tag activation.
- Logs and noncurrent objects expire automatically.
- Gap: two WAF ACLs, two KMS keys, CloudFront, API Gateway, and logging have baseline charges; review the first week of spend.

### Sustainability

- Arm64 Lambda and edge caching avoid continuously running compute.
- TTL and lifecycle policies bound data and artifact retention.
- Single-Region deployment avoids duplicated idle resources during the POC.

## Production gate

Keep `BOP_FLIGHT_BOOKING=0` until all are complete:

1. End-user authentication and booking-owner authorization.
2. A reconciliation path for `UNCERTAIN` idempotency records.
3. Webhook signature verification and replay protection.
4. Payment threat model and PCI scope decision.
5. Representative WAF Count logs reviewed before Block mode.
6. Recovery objectives, operational owner, and alarm recipient agreed.
