# aws-deployment Specification

## Purpose
Define the deployed AWS architecture, release controls, state protection, secret handling and operational checks for the Bop proof of concept.

## Requirements

### Requirement: CloudFront edge and private frontend origin
CloudFront SHALL be the public application entry point, SHALL read the frontend from an S3 origin protected by Origin Access Control, and SHALL route `/api/*` to the Regional REST API. The frontend bucket SHALL block public access and permit reads only from the distribution.

#### Scenario: Direct frontend-origin request
- **WHEN** a client requests `index.html` from the S3 regional endpoint
- **THEN** S3 returns 403 while the same document remains available through CloudFront

### Requirement: Streaming REST API
The Regional API Gateway REST API SHALL use an `AWS_PROXY` Lambda integration with `responseTransferMode=STREAM`, a five-minute integration timeout and the published Lambda `live` alias. The public POC API SHALL retain stage throttling, access logs and a Regional WAF when authorization is `NONE`.

#### Scenario: Agent streams a plan
- **WHEN** `/api/plan` emits NDJSON progress and a terminal event
- **THEN** API Gateway forwards chunks through CloudFront without buffering the complete response

#### Scenario: Live commerce is enabled
- **WHEN** live booking or payment is prepared for public use
- **THEN** Cognito, LINE Login or an equivalent verified-user authorization gate is required before activation

### Requirement: Deterministic Lambda release package
The Node.js 24 arm64 Lambda SHALL run a bundled CommonJS handler beneath a package-local `type: commonjs` boundary. Packaging SHALL normalize directories to mode 0755, files to mode 0644 and all mtimes before Terraform creates the ZIP, and SHALL invoke the packaged health handler as a regression check.

#### Scenario: Developer and CI use different umasks
- **WHEN** identical source is packaged under umask 0002 and umask 0022
- **THEN** both Terraform archives have the same SHA-256 digest and produce no release change

#### Scenario: Package cannot load
- **WHEN** the bundled artifact does not export and execute the Lambda handler
- **THEN** packaging fails before Terraform planning or alias movement

### Requirement: Versioned Lambda rollout and rollback
Terraform SHALL publish an immutable Lambda version and point API Gateway at the `live` alias. A candidate artifact SHALL be invokable through `$LATEST` before the alias moves, and an urgent rollback SHALL move the alias to a known-good version followed by Terraform reconciliation.

#### Scenario: Candidate fails initialization
- **WHEN** direct response-stream invocation of `$LATEST` returns an initialization error
- **THEN** the `live` alias remains on its previous healthy version

### Requirement: Runtime secrets
Terraform SHALL create the KMS-encrypted Secrets Manager container without a secret version. Lambda SHALL receive only the secret identifier, load allowlisted fields at runtime and keep secret values out of Terraform state, Git, logs and browser responses.

#### Scenario: Lambda starts in AWS
- **WHEN** `BOP_RUNTIME_SECRET_ID` identifies the runtime JSON secret
- **THEN** only allowlisted non-empty fields are added to the process environment and existing process values take precedence

### Requirement: Protected DynamoDB state
The operational state table SHALL use on-demand capacity, string partition key `record_key`, TTL on numeric epoch-seconds `expires_at`, 35-day point-in-time recovery, encryption, service deletion protection and Terraform `prevent_destroy`.

#### Scenario: Terraform destroy targets the table
- **WHEN** a routine plan would delete the state table
- **THEN** Terraform blocks the operation, and service deletion protection independently rejects a direct deletion

### Requirement: Short-lived CI identity and scoped deployment
GitHub Actions SHALL use OIDC credentials restricted to the immutable repository identity and `main` branch, SHALL verify the full sanctioned AWS account and `0081` suffix, and SHALL apply the exact saved Terraform plan. The deployment role SHALL update existing resources without broad resource-creation or destructive data-service permissions.

#### Scenario: Workflow runs from another repository or branch
- **WHEN** an OIDC token does not contain the allowed immutable repository subject and main-branch reference
- **THEN** AWS denies `AssumeRoleWithWebIdentity`

#### Scenario: Package and infrastructure are unchanged
- **WHEN** CI rebuilds the same release from committed source
- **THEN** Terraform reports no changes and applies zero additions, changes and destructions

### Requirement: Defense in depth and operations
CloudFront and API Gateway SHALL each have AWS WAF managed-rule and per-IP rate controls, starting in Count mode until logs are reviewed. WAF logs SHALL redact authorization and cookie fields. API Gateway and Lambda logs, X-Ray, alarms, a dashboard, SNS and a budget SHALL monitor the POC.

#### Scenario: WAF promotion
- **WHEN** representative Count-mode logs have been reviewed and false positives tuned
- **THEN** an operator may dispatch the deployment workflow with `waf_mode=block`

### Requirement: Workload tagging
Supported AWS resources SHALL carry `Project=sea-openai`, `Workload=sea-openai`, environment, management and repository tags through provider defaults or explicit resource tags.

#### Scenario: Cost inventory is queried
- **WHEN** resources are filtered by the `sea-openai` workload tag
- **THEN** the deployed CloudFront, API, compute, data, security, logging and budget resources are attributable to the workload
