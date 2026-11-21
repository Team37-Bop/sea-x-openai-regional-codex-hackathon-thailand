data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    sid     = "LambdaAssumeRole"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.name_prefix}-api"
  path               = "/${var.project_tag}/"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = local.common_tags
}

# IAM Policy Autopilot is run against the AWS SDK source and the real Terraform
# plan. These references constrain its baseline actions to this workload.
data "aws_iam_policy_document" "api" {
  statement {
    sid = "WriteFunctionLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.function.arn}:*"]
  }

  statement {
    sid       = "ReadRuntimeSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for secret in local.runtime_secrets : secret.arn]
  }

  dynamic "statement" {
    for_each = local.runtime_secrets
    iterator = secret
    content {
      sid       = "DecryptRuntimeSecret${title(secret.key)}"
      actions   = ["kms:Decrypt"]
      resources = [secret.value.kms_key_arn]

      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["secretsmanager.${var.aws_region}.${data.aws_partition.current.dns_suffix}"]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:SecretARN"
        values   = [secret.value.arn]
      }
    }
  }

  statement {
    sid = "UsePocStateTable"
    actions = [
      "dynamodb:ConditionCheckItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.state.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "runtime"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}
