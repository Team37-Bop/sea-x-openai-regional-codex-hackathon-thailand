import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/ci-cd.yml');
const bootstrap = read('terraform/bootstrap/main.tf');
const providers = read('terraform/app/versions.tf');
const app = [
  read('terraform/app/api_gateway.tf'),
  read('terraform/app/compute.tf'),
  read('terraform/app/database.tf'),
  read('terraform/app/edge.tf'),
  read('terraform/app/iam.tf'),
  read('terraform/app/kms.tf'),
  read('terraform/app/storage.tf'),
].join('\n');
const variables = read('terraform/app/variables.tf');
const ignored = read('.gitignore');

assert.match(workflow, /id-token:\s*write/);
assert.match(workflow, /configure-aws-credentials@[0-9a-f]{40}/);
assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
assert.match(workflow, /EXPECTED_AWS_ACCOUNT_SUFFIX:\s*"0081"/);
assert.match(workflow, /terraform -chdir=terraform\/app apply -input=false deploy\.tfplan/);
console.log('ok   GitHub Actions uses OIDC, account guards, and a saved Terraform plan');

assert.match(bootstrap, /token\.actions\.githubusercontent\.com:aud/);
assert.match(bootstrap, /repo:\$\{local\.repository_subject\}:ref:refs\/heads\/\$\{var\.github_branch\}/);
assert.match(providers, /allowed_account_ids\s*=\s*\[var\.expected_account_id\]/);
assert.match(bootstrap, /endswith\(data\.aws_caller_identity\.current\.account_id, var\.expected_account_suffix\)/);
console.log('ok   OIDC trust and Terraform fail closed on the target account');

assert.match(app, /resource "aws_api_gateway_rest_api"/);
assert.match(app, /response_transfer_mode\s*=\s*"STREAM"/);
assert.match(app, /resource "aws_lambda_function"/);
assert.match(app, /runtime\s*=\s*"nodejs24\.x"/);
assert.match(app, /resource "aws_dynamodb_table"/);
assert.match(app, /billing_mode\s*=\s*"PAY_PER_REQUEST"/);
assert.match(app, /deletion_protection_enabled\s*=\s*true/);
assert.match(app, /resource "aws_secretsmanager_secret"/);
assert.match(app, /BOP_PROVIDER\s*=\s*"openai"/);
assert.match(app, /BOP_FLIGHT_BOOKING\s*=\s*"0"/);
assert.match(app, /dynamodb:ConditionCheckItem/);
console.log('ok   streaming REST API, Lambda, DynamoDB, OpenAI, and secret controls are declared');

assert.match(read('server/runtime-secrets.mjs'), /'OPENAI_APIKEY'/);
assert.match(read('server/runtime-secrets.mjs'), /'LINE_CHANNEL_ACCESS_TOKEN'/);
assert.match(read('server/line.mjs'), /verifyLineSignature/);
assert.match(read('terraform/app/edge.tf'), /name = "x-bop-trip-token"/);
console.log('ok   OpenAI and LINE credentials resolve only through the runtime secret');

assert.match(app, /origin_access_control_origin_type\s*=\s*"s3"/);
assert.match(app, /block_public_acls\s*=\s*true/);
assert.match(app, /AWS:SourceArn/);
assert.match(app, /resource "aws_wafv2_web_acl_association"/);
assert.match(read('vite.config.js'), /maplibre-gl-worker\.mjs/);
const storage = read('terraform/app/storage.tf');
assert.match(storage, /"\.mjs"\s*=\s*"text\/javascript; charset=utf-8"/);
assert.match(storage, /source_hash\s*=\s*data\.archive_file\.lambda\.output_sha256/);
assert.match(storage, /etag\s*=\s*filemd5/);
assert.equal((storage.match(/ignore_changes\s*=\s*\[source\]/g) || []).length, 2);
console.log('ok   CloudFront assets include the map worker and ignore runner-specific source paths');

assert.match(variables, /default\s*=\s*"poc-tourism"/);
assert.match(read('terraform/app/locals.tf'), /Project\s*=\s*var\.project_tag/);
assert.match(read('terraform/app/locals.tf'), /Workload\s*=\s*var\.project_tag/);
console.log('ok   deployment resources carry the poc-tourism tag');

assert.match(ignored, /^\.env\.local$/m);
assert.match(ignored, /^env\.local$/m);
assert.match(ignored, /^\.build\/$/m);
assert.doesNotMatch(workflow, /\.env\.local/);
console.log('ok   local secrets and build artifacts stay out of Git and CI');

console.log('all passed');
