# aws-deployment Specification

## Purpose
Describe the AWS resources, build outputs and release checks declared in the reference repository. Terraform defaults and workflow steps below describe the reference at commit `292ba5f`. They do not establish which configuration a running AWS account currently uses.

Evidence: `terraform/app/{edge,api_gateway,compute,database,storage,variables,observability,budget,versions}.tf`, `terraform/bootstrap/main.tf`, `.github/workflows/ci-cd.yml`, `scripts/package-lambda.sh`, `server/lambda-handler.mjs`, `server/runtime-secrets.mjs`, and the Lambda, packaged-handler and infrastructure regression scripts in `scripts/`.

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
Terraform SHALL publish an immutable function version from the versioned S3 artifact and point the `live` alias at the published version. API Gateway SHALL integrate with the alias and its deployment fingerprint SHALL include the function version and transfer mode. The workflow tests the packaged handler locally before apply, then probes the public endpoint after apply. Direct candidate invocation and emergency alias rollback are operator procedures.

#### Scenario: Source content changes

- **WHEN** the normalized ZIP has a new content hash
- **THEN** Terraform selects the corresponding release object version, publishes a Lambda version, and updates the alias and API deployment.

#### Scenario: Public smoke check fails after apply

- **WHEN** retries against the public health endpoint are exhausted or direct S3 access returns a status other than 403
- **THEN** the deploy job fails. The workflow contains no automatic rollback step or pre-alias production invocation gate.

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
CloudFront and API Gateway SHALL each have AWS WAF managed-rule and per-IP rate controls, starting in Count mode until logs are reviewed. WAF logs SHALL redact the Authorization, X-Bop-Trip-Token and Cookie headers. API Gateway and Lambda logs, X-Ray, alarms, a dashboard, SNS and a budget SHALL monitor the POC.

#### Scenario: WAF promotion
- **WHEN** representative Count-mode logs have been reviewed and false positives tuned
- **THEN** an operator may dispatch the deployment workflow with `waf_mode=block`

### Requirement: Workload tagging
Supported AWS resources SHALL carry `Project=poc-tourism`, `Workload=poc-tourism`, environment, management and repository tags through provider defaults or explicit resource tags.

#### Scenario: Cost inventory is queried
- **WHEN** resources are filtered by the `poc-tourism` workload tag
- **THEN** the deployed CloudFront, API, compute, data, security, logging and budget resources are attributable to the workload

### Requirement: Edge routing and cache behavior

The distribution SHALL serve frontend GET, HEAD and OPTIONS requests from its S3 regional origin using signed OAC requests. The ordered `/api/*` behavior SHALL forward viewer requests over HTTPS to the environment stage of the REST API with caching disabled and the viewer Host header replaced. All seven standard viewer methods are allowed by this behavior. The API origin read timeout is 120 seconds and is distinct from the Lambda and Gateway execution limits.

#### Scenario: Interactive plan and static asset hit the same distribution

- **WHEN** a browser fetches a built asset and then sends a JSON plan request
- **THEN** the frontend object has a one-year immutable cache header under `assets/`, other uploaded frontend files use `no-cache`, and the POST reaches the API stage with its body, query and application headers.

### Requirement: Lambda request adapter and resource limits

The function SHALL use Node.js 24 on arm64 with 1,024 MiB of memory, 512 MiB of ephemeral storage and a 300-second timeout. Its adapter SHALL reconstruct a Node-style HTTP request, preserve webhook body bytes, lower-case header names and flush status and headers exactly once before streaming the application response. Lazy initialization SHALL load secrets before importing the API and reuse that initialization on warm invocations.

#### Scenario: Encoded webhook and repeated query parameters

- **WHEN** the event marks its body as base64 or carries multiple values for a query key
- **THEN** the adapter decodes the original bytes before verification. URL reconstruction prefers the raw query if supplied, then the multi-value map, then the single-value map.

#### Scenario: Production environment defaults

- **WHEN** the reference Terraform configuration creates a function revision
- **THEN** OpenAI is selected, the local cache is under `/tmp/bop/cache`, the state-table and runtime-secret identifiers are passed to the function, live flight booking is disabled and the LINE monthly cap is 200.

### Requirement: CI validation, rollout and release identity

Pull requests SHALL run the package/test/build procedure, Terraform formatting checks and offline-backend configuration validation for both stacks. The deploy job SHALL require successful validation, a push or manual dispatch on `main`, all required repository variables, and a matching STS account. It SHALL initialize a lockfile-enabled S3 backend and apply the saved application plan.

#### Scenario: Bundle construction rejects an incomplete release

- **WHEN** tests fail, the frontend worker is missing or empty, the production dependency audit fails at high severity, the packaged CommonJS health regression fails, or the package exceeds 250 MiB uncompressed
- **THEN** packaging stops. The expected package contains the CommonJS handler and route seed, with normalized modes and timestamps. Terraform uses the ZIP SHA-256 in the release object key.

#### Scenario: Checks performed by the deploy job

- **WHEN** infrastructure apply succeeds
- **THEN** the workflow retries the public health request and checks for HTTP 403 on direct S3 access to `index.html`. The health probe requires HTTP success and does not exercise a billed model call.

### Requirement: Operational defaults and observability

The default API stage SHALL enable X-Ray, metrics, ERROR logging and structured access logs. It SHALL disable body data tracing and stage caching, with configurable steady/burst throttles defaulting to 10/20. Both WAFs SHALL evaluate the Common and Known Bad Inputs managed rule groups and default to counting requests; the body-size managed rule retains its count override. Default rate thresholds are 100 requests per IP per five minutes. The edge rate rule is scoped to the API path.

#### Scenario: Workload monitoring

- **WHEN** default monitoring is provisioned
- **THEN** the stack defines alarms for CloudFront 5xx, API 5xx, Lambda errors, DynamoDB throttling and WAF blocks, plus a dashboard and SNS topic. The default application log retention is 30 days.

#### Scenario: Budget notification

- **WHEN** tagged monthly costs exceed the configured forecast or actual thresholds
- **THEN** the budget publishes via SNS at forecast above 80% or actual above 100% of the configurable limit (default USD 50). Attribution depends on the Project billing tag being active. The optional email subscription requires confirmation.
