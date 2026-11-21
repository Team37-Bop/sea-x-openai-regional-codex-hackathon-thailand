// Build update-only GitHub policies from deployed Terraform resource identifiers.
// Action families were derived with IAM Policy Autopilot from real code and WAF update plans.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [statePath, outputDir] = process.argv.slice(2);
if (!statePath || !outputDir) throw new Error('usage: node generate-ci-update-policy.mjs <state.json> <output-dir>');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const resources = [];
function walk(module) {
  resources.push(...(module.resources || []));
  for (const child of module.child_modules || []) walk(child);
}
walk(state.values.root_module);
const value = address => {
  const resource = resources.find(item => item.address === address);
  if (!resource) throw new Error(`missing Terraform state resource: ${address}`);
  return resource.values;
};

const partition = 'aws';
const region = value('aws_lambda_function.api').region || 'us-east-1';
const account = value('aws_lambda_function.api').arn.split(':')[4];
const lambda = value('aws_lambda_function.api').arn;
const lambdaRole = value('aws_iam_role.api').arn;
const apiId = value('aws_api_gateway_rest_api.app').id;
const apiArn = `arn:${partition}:apigateway:${region}::/restapis/${apiId}`;
const distribution = value('aws_cloudfront_distribution.app').arn;
const oac = value('aws_cloudfront_origin_access_control.frontend').arn;
const wafArns = [value('aws_wafv2_web_acl.edge').arn, value('aws_wafv2_web_acl.api').arn];
const buckets = ['artifacts', 'frontend', 'cloudfront_logs'].map(name => value(`aws_s3_bucket.${name}`).arn);
const objectBuckets = ['artifacts', 'frontend'].map(name => value(`aws_s3_bucket.${name}`).arn);
const logArns = ['function', 'api', 'edge_waf', 'api_waf'].map(name => value(`aws_cloudwatch_log_group.${name}`).arn.replace(/:\*$/, ''));
const kmsArns = ['logs', 'secrets'].map(name => value(`aws_kms_key.${name}`).arn);
const alarmArns = ['cloudfront_5xx', 'api_5xx', 'lambda_errors', 'dynamodb_throttles', 'waf_blocked'].map(name => value(`aws_cloudwatch_metric_alarm.${name}`).arn);
const dashboardArn = `arn:${partition}:cloudwatch::${account}:dashboard/${value('aws_cloudwatch_dashboard.app').dashboard_name}`;
const tableArn = value('aws_dynamodb_table.state').arn;
const secretArn = value('aws_secretsmanager_secret.runtime').arn;
const topicArn = value('aws_sns_topic.alerts').arn;
const budgetArn = value('aws_budgets_budget.workload').arn;

const statement = (Sid, Action, Resource, extra = {}) => ({ Sid, Effect: 'Allow', Action, Resource, ...extra });
const updatePolicy = {
  Version: '2012-10-17',
  Statement: [
    statement('DeployApiGatewayRevision', ['apigateway:DELETE', 'apigateway:GET', 'apigateway:PATCH', 'apigateway:POST', 'apigateway:PUT'], [apiArn, `${apiArn}/*`]),
    statement('DeployLambdaVersion', [
      'lambda:AddPermission', 'lambda:GetAlias', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:GetPolicy',
      'lambda:ListTags', 'lambda:ListVersionsByFunction', 'lambda:PublishVersion', 'lambda:RemovePermission',
      'lambda:TagResource', 'lambda:UntagResource', 'lambda:UpdateAlias', 'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration',
    ], [lambda, `${lambda}:*`]),
    statement('PassOnlyApiRuntimeRole', ['iam:PassRole'], [lambdaRole], {
      Condition: { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } },
    }),
    statement('PublishReleaseObjects', [
      's3:AbortMultipartUpload', 's3:DeleteObject', 's3:DeleteObjectVersion', 's3:GetObject', 's3:GetObjectTagging', 's3:GetObjectVersion', 's3:PutObject', 's3:PutObjectTagging',
    ], objectBuckets.map(arn => `${arn}/*`)),
    statement('UpdateCloudFront', [
      'cloudfront:GetDistribution', 'cloudfront:GetDistributionConfig', 'cloudfront:ListTagsForResource',
      'cloudfront:TagResource', 'cloudfront:UntagResource', 'cloudfront:UpdateDistribution',
    ], [distribution]),
    statement('UpdateWafRules', [
      'wafv2:GetLoggingConfiguration', 'wafv2:GetWebACL', 'wafv2:ListTagsForResource',
      'wafv2:PutLoggingConfiguration', 'wafv2:TagResource', 'wafv2:UntagResource', 'wafv2:UpdateWebACL',
    ], wafArns),
    statement('UpdateMonitoring', ['cloudwatch:DescribeAlarms', 'cloudwatch:PutMetricAlarm'], alarmArns),
    statement('UpdateDashboard', ['cloudwatch:GetDashboard', 'cloudwatch:PutDashboard'], dashboardArn),
  ],
};
const readPolicy = {
  Version: '2012-10-17',
  Statement: [
    statement('ReadManagedCloudFrontPolicies', [
      'cloudfront:GetCachePolicy', 'cloudfront:GetOriginAccessControl', 'cloudfront:GetOriginAccessControlConfig',
      'cloudfront:GetOriginRequestPolicy', 'cloudfront:GetResponseHeadersPolicy', 'cloudfront:ListCachePolicies',
      'cloudfront:ListOriginRequestPolicies', 'cloudfront:ListResponseHeadersPolicies',
    ], '*'),
    statement('ReadBuckets', [
      's3:GetAccelerateConfiguration', 's3:GetBucketAcl', 's3:GetBucketCORS', 's3:GetBucketLogging',
      's3:GetBucketObjectLockConfiguration', 's3:GetBucketOwnershipControls', 's3:GetBucketPolicy',
      's3:GetBucketPublicAccessBlock', 's3:GetBucketRequestPayment', 's3:GetBucketTagging', 's3:GetBucketVersioning',
      's3:GetBucketWebsite', 's3:GetEncryptionConfiguration', 's3:GetLifecycleConfiguration',
      's3:GetReplicationConfiguration', 's3:ListBucket', 's3:ListBucketVersions',
    ], buckets),
    statement('DiscoverS3Owner', ['s3:ListAllMyBuckets'], '*'),
    statement('ReadRuntimeRole', [
      'iam:GetRole', 'iam:GetRolePolicy', 'iam:ListAttachedRolePolicies', 'iam:ListRolePolicies', 'iam:ListRoleTags',
    ], lambdaRole),
    statement('ReadKmsKeys', ['kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:GetKeyRotationStatus', 'kms:ListResourceTags'], kmsArns),
    statement('ListKmsAliases', ['kms:ListAliases'], '*'),
    statement('DescribeLogGroups', ['logs:DescribeLogGroups'], '*'),
    statement('ReadLogTags', ['logs:ListTagsForResource'], [...logArns, ...logArns.map(arn => `${arn}:*`)]),
    statement('ReadDynamoState', ['dynamodb:DescribeContinuousBackups', 'dynamodb:DescribeTable', 'dynamodb:DescribeTimeToLive', 'dynamodb:ListTagsOfResource'], tableArn),
    statement('ReadRuntimeSecretMetadata', ['secretsmanager:DescribeSecret', 'secretsmanager:GetResourcePolicy'], secretArn),
    statement('ReadAlertsTopic', ['sns:GetTopicAttributes', 'sns:ListTagsForResource'], topicArn),
    statement('ReadBudget', ['budgets:ListTagsForResource', 'budgets:ViewBudget'], budgetArn),
    statement('ReadWafAssociation', ['wafv2:GetWebACLForResource'], '*'),
    statement('ReadCanonicalIdentity', ['s3:GetAccountPublicAccessBlock'], '*'),
    statement('ReadCallerAccount', ['sts:GetCallerIdentity'], '*'),
    statement('ReadCloudWatchTags', ['cloudwatch:ListTagsForResource'], [...alarmArns, dashboardArn]),
    statement('ReadLambdaConcurrency', ['lambda:GetFunctionCodeSigningConfig', 'lambda:GetFunctionConcurrency'], lambda),
  ],
};

mkdirSync(outputDir, { recursive: true });
for (const [index, policy] of [updatePolicy, readPolicy].entries()) {
  const compact = JSON.stringify(policy);
  if (compact.length > 6144) throw new Error(`policy ${index + 1} exceeds 6144 characters (${compact.length})`);
  const file = path.join(outputDir, `github-update-${String(index + 1).padStart(2, '0')}.json`);
  writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  console.log(`Wrote ${path.basename(file)} (${compact.length} compact characters)`);
}
