resource "aws_cloudwatch_log_group" "function" {
  name              = local.function_log_group
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = local.api_log_group
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "edge_waf" {
  name              = local.edge_waf_log_group
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "api_waf" {
  name              = local.api_waf_log_group
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  tags = local.common_tags
}
