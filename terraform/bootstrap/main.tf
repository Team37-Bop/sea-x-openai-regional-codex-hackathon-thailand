locals {
  name         = "bop-${var.environment}"
  repo         = split("/", var.repository)
  subject      = "repo:${local.repo[0]}@${var.repository_owner_id}/${local.repo[1]}@${var.repository_id}:ref:refs/heads/main"
  deploy_ready = var.distribution_id != "" && var.rest_api_id != ""
  app_buckets  = [for purpose in ["frontend", "releases"] : "arn:aws:s3:::${local.name}-${purpose}-${var.account_id}-${var.region}"]
  state_object = "${aws_s3_bucket.state.arn}/bop/${var.environment}/terraform.tfstate"
  lambda       = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.name}"
}
resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.github_oidc_provider_arn == "" ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-release"
  max_session_duration = 3600
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Action = "sts:AssumeRoleWithWebIdentity",
    Principal = { Federated = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn },
    Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com", "token.actions.githubusercontent.com:sub" = local.subject } }
  }] })
}

# The operator provisions the initial application. The release identity may update approved resources.
resource "aws_iam_role_policy" "release" {
  count = local.deploy_ready ? 1 : 0
  name  = "release-existing-workload"
  role  = aws_iam_role.deploy.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "InspectInfrastructure", Effect = "Allow", Action = [
      "sts:GetCallerIdentity", "acm:DescribeCertificate", "apigateway:GET", "budgets:ViewBudget", "budgets:Describe*", "budgets:ListTagsForResource",
      "cloudfront:Get*", "cloudfront:List*", "cloudwatch:DescribeAlarms", "cloudwatch:GetDashboard", "cloudwatch:ListTagsForResource",
      "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive", "dynamodb:DescribeContinuousBackups", "dynamodb:ListTagsOfResource",
      "iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:ListRoleTags",
      "kms:DescribeKey", "kms:GetKeyPolicy", "kms:GetKeyRotationStatus", "kms:ListResourceTags", "kms:ListAliases",
      "logs:DescribeLogGroups", "logs:ListTagsForResource", "logs:ListTagsLogGroup", "logs:GetLogDelivery", "logs:ListLogDeliveries",
      "secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy", "sns:GetTopicAttributes", "sns:GetSubscriptionAttributes", "sns:ListTagsForResource",
    "wafv2:Get*", "wafv2:List*"], Resource = "*" },
    { Sid = "InspectFunction", Effect = "Allow", Action = ["lambda:Get*", "lambda:List*"], Resource = [local.lambda, "${local.lambda}:*"] },
    { Sid = "InspectBuckets", Effect = "Allow", Action = ["s3:GetBucket*", "s3:GetEncryptionConfiguration", "s3:GetAccelerateConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:ListBucket", "s3:ListBucketVersions"], Resource = concat(local.app_buckets, [aws_s3_bucket.state.arn]) },
    { Sid = "SaveState", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = [local.state_object, "${local.state_object}.tflock"] },
    { Sid = "ReleaseStateLock", Effect = "Allow", Action = "s3:DeleteObject", Resource = "${local.state_object}.tflock" },
    { Sid = "PublishAssets", Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:GetObjectTagging", "s3:PutObjectTagging", "s3:GetObjectVersionTagging", "s3:DeleteObject"], Resource = ["${local.app_buckets[0]}/*", "${local.app_buckets[1]}/lambda/*"] },
    { Sid = "PublishVersion", Effect = "Allow", Action = ["lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:PublishVersion", "lambda:UpdateAlias"], Resource = [local.lambda, "${local.lambda}:live"] },
    { Sid = "UseExecutionRole", Effect = "Allow", Action = "iam:PassRole", Resource = "arn:aws:iam::${var.account_id}:role/${local.name}-runtime", Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } } },
    { Sid = "RefreshDistribution", Effect = "Allow", Action = ["cloudfront:UpdateDistribution", "cloudfront:CreateInvalidation"], Resource = "arn:aws:cloudfront::${var.account_id}:distribution/${var.distribution_id}" },
    { Sid = "RedeployStage", Effect = "Allow", Action = "apigateway:POST", Resource = "arn:aws:apigateway:${var.region}::/restapis/${var.rest_api_id}/deployments" },
    { Sid = "UpdateStage", Effect = "Allow", Action = "apigateway:PATCH", Resource = ["arn:aws:apigateway:${var.region}::/restapis/${var.rest_api_id}/stages/${var.environment}", "arn:aws:apigateway:${var.region}::/restapis/${var.rest_api_id}/resources/*/methods/ANY/integration"] },
    { Sid = "RetireSupersededApiDeployment", Effect = "Allow", Action = "apigateway:DELETE", Resource = "arn:aws:apigateway:${var.region}::/restapis/${var.rest_api_id}/deployments/*" },
    { Sid = "PromoteFirewall", Effect = "Allow", Action = "wafv2:UpdateWebACL", Resource = ["arn:aws:wafv2:us-east-1:${var.account_id}:global/webacl/${local.name}-edge/*", "arn:aws:wafv2:${var.region}:${var.account_id}:regional/webacl/${local.name}-api/*"] }
  ] })
}
variable "gateway_logging_role_arn" {
  type        = string
  default     = ""
  description = "Existing regional API Gateway CloudWatch Logs role. Leave empty to provision one during account bootstrap."
}
resource "aws_iam_role" "gateway_logs" {
  count              = var.gateway_logging_role_arn == "" ? 1 : 0
  name               = "${local.name}-gateway-logs"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "apigateway.amazonaws.com" } }] })
}
resource "aws_iam_role_policy_attachment" "gateway_logs" {
  count      = var.gateway_logging_role_arn == "" ? 1 : 0
  role       = aws_iam_role.gateway_logs[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}
resource "aws_api_gateway_account" "logs" {
  cloudwatch_role_arn = var.gateway_logging_role_arn != "" ? var.gateway_logging_role_arn : aws_iam_role.gateway_logs[0].arn
  depends_on          = [aws_iam_role_policy_attachment.gateway_logs]
}
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
output "state_bucket" { value = aws_s3_bucket.state.id }
output "oidc_subject" { value = local.subject }
