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
    sid = "ReadRuntimeSecret"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = [aws_secretsmanager_secret.runtime.arn]
  }

  statement {
    sid = "DecryptRuntimeSecret"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.secrets.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
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
