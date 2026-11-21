# AWS deployment

This stack publishes the static frontend from `dist/` to S3 and runs the trip planner API on Lambda in the AWS account supplied as `expected_account_id`. Authenticate locally with an AWS role or IAM Identity Center profile that has permissions for the reviewed bootstrap and initial application plans. GitHub Actions uses short-lived OIDC credentials and never stores AWS access keys.

## Architecture

```text
Browser
  -> CloudFront + edge AWS WAF
       |-> private S3 frontend through OAC/SigV4
       `-> /api/* -> Regional REST API Gateway + regional AWS WAF
                       -> response-streaming Lambda (Node.js 24)
                            -> Secrets Manager (provider credentials)
```

REST API Gateway is used instead of HTTP API because Bop streams NDJSON and model calls can exceed 30 seconds. The integration uses `responseTransferMode=STREAM` and a five-minute timeout. The frontend S3 origin is IAM-protected: public access is blocked, and its bucket policy permits only the exact CloudFront distribution through OAC.

The Regional API Gateway endpoint remains directly addressable for this public proof of concept. It has its own WAF, stage throttling, access logs, and account-level Lambda safeguards, so bypassing CloudFront does not bypass those controls.

Runtime API keys are read from one KMS-encrypted Secrets Manager JSON secret. Terraform creates only the secret container and never receives or stores secret values. Resource identifiers such as OIDC and deployment-role ARNs come from Terraform data sources and outputs rather than hardcoded values.

Every supported resource receives these tags:

```text
Project=sea-openai
Workload=sea-openai
ManagedBy=Terraform
```

The application stack also manages an on-demand DynamoDB table with deletion protection and 35 days of point-in-time recovery. The current planner keeps its trip data in the browser.

## Prerequisites

- AWS CLI credentials for the intended account
- Terraform 1.10 or newer
- Node.js 24 for runtime-equivalent validation
- GitHub CLI (`gh`) for repository-variable setup

## One-time OIDC and state bootstrap

First authenticate to the intended AWS account, set the real 12-digit account ID, and create a local bootstrap plan. Because the state bucket does not exist yet, the very first bootstrap run uses local state: temporarily remove `backend "s3" {}` from `terraform/bootstrap/versions.tf`, then restore it after applying the bootstrap plan. The checked-in tfvars example contains a placeholder account ID; replace it before planning. The GitHub owner and repository IDs are already set to this repository's immutable IDs.

```bash
export AWS_REGION=us-east-1
export TF_VAR_expected_account_id="$(aws sts get-caller-identity --query Account --output text)"
cp terraform/bootstrap/terraform.tfvars.example terraform/bootstrap/terraform.tfvars
# Edit terraform/bootstrap/terraform.tfvars and replace expected_account_id.
# Set create_github_oidc_provider=true only if the provider is absent in this account.
terraform -chdir=terraform/bootstrap init -input=false
terraform -chdir=terraform/bootstrap plan -input=false -var=require_generated_policies=false -out=bootstrap.tfplan
terraform -chdir=terraform/bootstrap apply -input=false bootstrap.tfplan
```

Bootstrap creates the OIDC role and encrypted, versioned state bucket. The role trusts `Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand` on `refs/heads/main` with audience `sts.amazonaws.com`. It initially has only scoped Terraform state access. Read both outputs from local state and write the backend configuration files before restoring the S3 backend block.

```bash
export TF_STATE_BUCKET="$(terraform -chdir=terraform/bootstrap output -raw terraform_state_bucket)"
export TF_STATE_KEY="$(terraform -chdir=terraform/bootstrap output -raw terraform_state_key)"
./scripts/write-backend-config.sh
```

Restore `backend "s3" {}` in `terraform/bootstrap/versions.tf`. For the first migration into the new bucket, copy the local bootstrap state to S3 and initialize the app backend.

```bash
terraform -chdir=terraform/bootstrap init -migrate-state -force-copy -input=false -backend-config=backend.hcl
terraform -chdir=terraform/app init -input=false -backend-config=backend.hcl
```

## Initial application deployment

Use the same authenticated AWS operator for the first app plan. Build the app, inspect the plan, and apply it.

```bash
./scripts/package-lambda.sh
terraform -chdir=terraform/app plan -input=false -out=app.tfplan
terraform -chdir=terraform/app show app.tfplan
terraform -chdir=terraform/app apply -input=false app.tfplan
```

For a later checkout of the same stack, run `./scripts/write-backend-config.sh` with the existing repository variables or explicit `TF_STATE_BUCKET` and `TF_STATE_KEY`. Then initialize both modules with `terraform init -backend-config=backend.hcl` in their respective directories.

This creates billable CloudFront, WAF, API Gateway, Lambda, DynamoDB, KMS, Secrets Manager, S3, CloudWatch, SNS, and Budget resources. Review the saved plan before applying it.

Populate the secret from ignored `.env.local` without printing values or putting them in Terraform state:

```bash
./scripts/sync-runtime-secret.sh
```

AWS sets `BOP_PROVIDER=openai`. Set `OPENAI_API_KEY` in `.env.local` to enable live planning. The script writes a new secret version containing the supported values from that file. With no provider key, the Chiang Mai demo remains available and `GET /api/health` reports `"provider": null`.

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

Review the Access Analyzer findings and saved Terraform plan before applying. The GitHub role can publish frontend and Lambda releases and update this stack’s API Gateway, CloudFront, WAF, and monitoring resources. Apply new infrastructure through SSO, then regenerate policies using the updated state.

## GitHub Actions

`.github/workflows/ci-cd.yml` runs the application tests, builds the frontend from `web/`, packages the Node.js Lambda handler, runs pre-commit, and checks both Terraform configurations on every pull request. A push to `main` assumes the account-scoped role through GitHub OIDC, verifies the full configured account ID, applies a saved plan, smoke-tests CloudFront, and confirms direct S3 access returns `403`.

Install the local commit hooks with `python3 -m pip install pre-commit==4.7.0` and `pre-commit install`. The checked-in `.pre-commit-config.yaml` checks YAML, whitespace, merge markers, private keys, large files, and Terraform formatting.

The validation check is named **Test, build, and validate IaC**. Third-party actions are pinned by commit SHA.

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
