data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_canonical_user_id" "current" {}
data "aws_cloudfront_log_delivery_canonical_user_id" "cloudfront" {}

locals {
  name_prefix = "bop-${var.project_tag}-${var.environment}"
  repository  = "Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand"
  common_tags = {
    Project     = var.project_tag
    Workload    = var.project_tag
    Environment = var.environment
    ManagedBy   = "Terraform"
    Repository  = local.repository
  }

  artifact_source_dir = "${path.module}/../../.build/lambda"
  artifact_zip_path   = "${path.module}/../../.build/bop-api-lambda.zip"
  frontend_source_dir = "${path.module}/../../dist"
  frontend_files      = fileset(local.frontend_source_dir, "**")

  function_log_group = "/aws/lambda/${local.name_prefix}-api"
  api_log_group      = "/aws/apigateway/${local.name_prefix}"
  edge_waf_log_group = "aws-waf-logs-${local.name_prefix}-edge"
  api_waf_log_group  = "aws-waf-logs-${local.name_prefix}-api"

  custom_domain_enabled = var.custom_domain_name != null && var.cloudfront_acm_certificate_arn != null
}

check "target_account" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
    error_message = "Refusing to deploy: AWS identity does not match expected_account_id."
  }
}

check "custom_domain_configuration" {
  assert {
    condition = (
      (var.custom_domain_name == null && var.cloudfront_acm_certificate_arn == null) ||
      (var.custom_domain_name != null && var.cloudfront_acm_certificate_arn != null)
    )
    error_message = "Set both custom_domain_name and cloudfront_acm_certificate_arn, or neither."
  }
}
