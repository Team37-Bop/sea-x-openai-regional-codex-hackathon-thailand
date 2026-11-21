data "aws_iam_policy_document" "secrets_kms" {
  statement {
    sid       = "EnableAccountIAMPolicies"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_kms_key" "secrets" {
  description             = "Encrypt ${local.name_prefix} runtime API credentials"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.secrets_kms.json

  tags = local.common_tags
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_secretsmanager_secret" "runtime" {
  name                    = "${var.project_tag}/${var.environment}/runtime"
  description             = "Server-side API credentials for ${local.name_prefix}; values are populated outside Terraform"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 30

  tags = local.common_tags
}

# CloudWatch Logs requires access in the KMS key policy. The encryption-context
# condition confines use to this workload's two log-group name prefixes.
data "aws_iam_policy_document" "logs_kms" {
  statement {
    sid       = "EnableAccountIAMPolicies"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowCloudWatchLogs"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = [
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${local.function_log_group}*",
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${local.api_log_group}*",
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${local.edge_waf_log_group}*",
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${local.api_waf_log_group}*",
      ]
    }
  }
}

resource "aws_kms_key" "logs" {
  description             = "Encrypt ${local.name_prefix} application and WAF logs"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.logs_kms.json

  tags = local.common_tags
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${local.name_prefix}-logs"
  target_key_id = aws_kms_key.logs.key_id
}
