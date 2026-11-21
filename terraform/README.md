# AWS deployment

This stack deploys Bop to AWS account **ending in 0081**. Local operators authenticate through the existing `com7business-ruchida` IAM Identity Center profile. GitHub Actions uses short-lived OIDC credentials and never stores AWS access keys.

## Architecture

```text
Browser
  -> CloudFront + edge AWS WAF
       |-> private S3 frontend through OAC/SigV4
       `-> /api/* -> Regional REST API Gateway + regional AWS WAF
                       -> response-streaming Lambda (Node.js 24)
                            |-> Secrets Manager (API credentials)
                            `-> DynamoDB (POC idempotency and booking audit)
```

REST API Gateway is used instead of HTTP API because Bop streams NDJSON and model calls can exceed 30 seconds. The integration uses `responseTransferMode=STREAM` and a five-minute timeout. The frontend S3 origin is IAM-protected: public access is blocked, and its bucket policy permits only the exact CloudFront distribution through OAC.

The Regional API Gateway endpoint remains directly addressable for this public proof of concept. It has its own WAF, stage throttling, access logs, and account-level Lambda safeguards, so bypassing CloudFront does not bypass those controls. Add Cognito or LINE Login before enabling live booking or payments.

Runtime API keys are read from one KMS-encrypted Secrets Manager JSON secret. Terraform creates only the secret container and never receives or stores secret values. Resource identifiers such as OIDC and deployment-role ARNs come from Terraform data sources and outputs rather than hardcoded values.

Every supported resource receives these tags:

```text
Project=poc-tourism
Workload=poc-tourism
ManagedBy=Terraform
```

## DynamoDB POC state

One on-demand table serves the current tightly bound operational state:

| Access pattern | Operation | Key | Retention |
|---|---|---|---|
| Claim one mutating booking request | Conditional `PutItem` | `IDEMPOTENCY#<uuid>` | 24 hours |
| Read a repeated request result | Strong `GetItem` | `IDEMPOTENCY#<uuid>` | 24 hours |
| Complete or quarantine a request | Conditional `UpdateItem` | `IDEMPOTENCY#<uuid>` | 24 hours |
| Create a booking audit entry | Conditional `PutItem` | `ORDER#<order-id>` | 90 days |
| Mark an order cancelled | Conditional `UpdateItem` | `ORDER#<order-id>` | 90 days |
| Store one LINE-linked trip and compact vote | `PutItem` / `UpdateItem` | `TRIP#<uuid>` | 30 days after trip |
| Resolve one-time link code or group | `GetItem` | `LINK#<code>` / `GROUP#<id>` | 30 minutes / trip TTL |
| Deduplicate one LINE webhook | Conditional `PutItem` | `LINE_EVENT#<event-id>` | 24 hours |
| Cap monthly LINE pushes | Atomic `UpdateItem` | `LINE_QUOTA#<YYYY-MM>` | about 40 days |

The table uses `PAY_PER_REQUEST`, TTL on numeric epoch-seconds field `expires_at`, 35-day PITR, AWS-managed encryption, service-level deletion protection, and Terraform `prevent_destroy`. Streams are disabled because there is no consumer.

Typical records remain below 1 KiB. Idempotency items contain a SHA-256 request hash and final response; order records contain IDs, totals, timestamps, and status but no passenger details. The Lambda role is the only application principal with item access.

## Prerequisites

- AWS CLI and the `com7business-ruchida` SSO profile
- Terraform 1.10 or newer
- Node.js 24 for runtime-equivalent validation
- `uvx` and IAM Policy Autopilot
- GitHub CLI (`gh`) for repository-variable setup

## One-time bootstrap

```bash
export AWS_PROFILE=com7business-ruchida
export AWS_REGION=us-east-1
aws sso login --profile "$AWS_PROFILE"

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
[[ ${ACCOUNT_ID: -4} == 0081 ]] || { echo 'Wrong AWS account' >&2; exit 1; }
export TF_VAR_expected_account_id="$ACCOUNT_ID"
```

Terraform discovers the account's existing GitHub Actions OIDC provider by its canonical URL. No provider ARN is committed or copied into Terraform inputs. This repository's state bucket was created once with local state, then both bootstrap and application state were migrated into separate versioned S3 keys. For a fresh clone of this established deployment:

```bash
./scripts/write-backend-config.sh
terraform -chdir=terraform/app init -reconfigure -backend-config=backend.hcl
terraform -chdir=terraform/bootstrap init -reconfigure -backend-config=backend.hcl
./scripts/generate-ci-update-policy.sh
terraform -chdir=terraform/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=terraform/bootstrap apply bootstrap.tfplan
```

`write-backend-config.sh` reads the bucket and application key from the GitHub repository variables (or explicit `TF_STATE_BUCKET` / `TF_STATE_KEY`) and writes owner-only, gitignored backend files. The generated policy guard makes bootstrap planning fail closed when the two local scoped policy files are missing, preventing a fresh clone from accidentally detaching CI permissions. The bootstrap owns the encrypted/versioned state bucket, the OIDC role and its update-only policies. Its trust policy accepts only the immutable GitHub owner/repository IDs for `222-KPR/sea-x-openai-regional-codex-hackathon-thailand`, on `refs/heads/main`, with audience `sts.amazonaws.com`. GitHub repositories created with immutable OIDC subjects do not use the older name-only `sub` format.

## First application deployment

The initial deployment runs under the approved SSO administrator because the GitHub role is intentionally unable to create infrastructure.

```bash
./scripts/package-lambda.sh
terraform -chdir=terraform/app init -reconfigure -backend-config=backend.hcl
terraform -chdir=terraform/app plan -out=app.tfplan
terraform -chdir=terraform/app apply app.tfplan
```

This creates billable CloudFront, WAF, API Gateway, Lambda, DynamoDB, KMS, Secrets Manager, S3, CloudWatch, SNS, and Budget resources. Review the saved plan before applying it.

Populate the secret from ignored `.env.local` without printing values or putting them in Terraform state:

```bash
./scripts/sync-runtime-secret.sh
```

The current local file can include future Google Maps and Omise keys. Storing them does not activate unfinished features. AWS sets `BOP_PROVIDER=openai`; the service-account key can be named `OPENAI_APIKEY` (the current local name) or `OPENAI_API_KEY`. Model tiers map Claude Opus/Sonnet/Haiku to OpenAI `gpt-6.2-astra`/`gpt-6.2-sol`/`gpt-6-luna`. If no supported model key exists, `/api/health` remains reachable but reports sample mode.

## Derive the routine GitHub deployment policy

After the first stack exists, generate update-only policies from its exact resource identifiers:

```bash
./scripts/generate-ci-update-policy.sh
for file in terraform/bootstrap/generated/github-update-*.json; do
  aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY --policy-document "file://$file"
done
terraform -chdir=terraform/bootstrap plan -out=bootstrap-policy.tfplan
terraform -chdir=terraform/bootstrap apply bootstrap-policy.tfplan
./scripts/configure-github-variables.sh
```

IAM Policy Autopilot is run against real code-update and WAF plans to establish the action set. The checked-in generator then removes unrelated provider suggestions and scopes each remaining resource to this stack. IAM Access Analyzer must return no errors before attachment. The GitHub role can publish routine code/static releases and update API Gateway, CloudFront, WAF and alarms; it cannot create a new service or delete DynamoDB, KMS, Secrets Manager, S3 buckets or IAM roles. Run new infrastructure changes once through SSO and regenerate the policies deliberately.

## LINE setup

The same Secrets Manager document accepts `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ID` (also accepted as `LINE_LOGIN_CHANNEL_ID`) and `LIFF_ID`. Only `LIFF_ID` is returned to the browser through `/api/config`; tokens and secrets never leave Lambda.

After deployment, set the LINE Messaging API webhook URL to:

```text
<application_url>/api/line/webhook
```

Enable group-chat participation for the Bop Official Account, then enable **Use webhook** in the LINE Developers Console. The endpoint URL is configured and LINE's built-in test returns `200 OK`, but the channel API currently reports `active:false`, and LINE exposes this activation toggle in the console. Then use the planner's **เชื่อมกลุ่ม LINE** button. The organizer adds Bop to a group and posts the generated six-character code. Webhooks are accepted only after HMAC-SHA256 verification of the exact raw body.

For LIFF, configure its endpoint URL as `<application_url>/liff.html`, add `LIFF_ID` to `.env.local`, and run `./scripts/sync-runtime-secret.sh` again. The current local key-name inventory did not include `LIFF_ID`, so group linking and postback votes work after deployment, but the LIFF page will report that its identifier is not configured until this value is added.

Pushes are capped at 200 per month by default; replies use the inbound reply token and do not consume the push counter. DynamoDB removes LINE personal data 30 days after the trip ends, and the organizer can delete it earlier in the planner.

## GitHub Actions

`.github/workflows/ci-cd.yml` runs tests, a production dependency audit, Vite build, deterministic esbuild Lambda packaging, Terraform formatting, and Terraform validation on every pull request. A push to `main` assumes the account-scoped role through GitHub OIDC, verifies the full account ID and `0081` suffix, applies a saved plan, smoke-tests CloudFront, and confirms direct S3 access returns `403`.

Protect `main` with required pull-request reviews and require the `validate` job before merge. Third-party actions are pinned by commit SHA.

## WAF rollout

Initial `waf_mode=count` configures Core Rule Set (700 WCU), Known Bad Inputs (200 WCU), and per-IP API rate rules on both CloudFront and the Regional API Gateway. WAF logs go to KMS-encrypted `aws-waf-logs-*` groups with `authorization` and `cookie` redacted.

After representative requests have been reviewed and false positives tuned, dispatch the workflow with `waf_mode=block`. `SizeRestrictions_BODY` remains in Count because valid plan/replan payloads can exceed its default threshold; the application independently caps bodies at 2 MiB.

## Verification

```bash
PUBLIC_URL=$(terraform -chdir=terraform/app output -raw application_url)
API_URL=$(terraform -chdir=terraform/app output -raw api_gateway_url)
FRONTEND_BUCKET=$(terraform -chdir=terraform/app output -raw frontend_bucket_name)

curl --fail "$PUBLIC_URL/"
curl --fail "$PUBLIC_URL/api/health"
curl --fail "$API_URL/api/health"
curl -o /dev/null -s -w '%{http_code}\n' \
  "https://$FRONTEND_BUCKET.s3.$AWS_REGION.amazonaws.com/index.html" # must be 403
```

Verify both WAF log groups receive records before switching to Block. Activate `Project` as a cost-allocation tag before relying on the tag-scoped budget.

## Rollback

Revert the application commit and push the revert to `main`; Lambda publishes an immutable version and the `live` alias moves to it. For an urgent rollback, point the alias at the prior version and then reconcile Terraform immediately.

## Sources

- [API Gateway REST API response streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)
- [Lambda proxy streaming response format](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html)
- [CloudFront OAC for private S3 origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [GitHub OIDC in AWS](https://docs.github.com/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [GitHub immutable OIDC subjects](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)
- [OpenAI model selection](https://developers.openai.com/api/docs/models)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [LINE webhook signature verification](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE group chats](https://developers.line.biz/en/docs/messaging-api/group-chats/)
- [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
