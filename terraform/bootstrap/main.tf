data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name_prefix        = "bop-${var.project_tag}-${var.environment}"
  repository         = "${var.github_owner}/${var.github_repository}"
  repository_subject = "${var.github_owner}@${var.github_owner_id}/${var.github_repository}@${var.github_repository_id}"
  state_key          = "${var.project_tag}/${var.environment}/terraform.tfstate"
  common_tags = {
    Project     = var.project_tag
    Workload    = var.project_tag
    Environment = var.environment
    ManagedBy   = "Terraform"
    Repository  = local.repository
  }
}

check "target_account" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
    error_message = "Refusing to bootstrap: AWS identity does not match expected_account_id."
  }
}

resource "aws_s3_bucket" "terraform_state" {
  bucket        = "${local.name_prefix}-tfstate-${substr(md5(data.aws_caller_identity.current.account_id), 0, 10)}"
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    id     = "retain-recoverable-state"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "terraform_state" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  policy = data.aws_iam_policy_document.terraform_state.json
}

# Use the existing account provider by default. For a new account, set
# create_github_oidc_provider=true to let bootstrap register it.
data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = local.common_tags
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    sid     = "GitHubActionsMainBranch"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.repository_subject}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name_prefix}-github-deploy"
  path                 = "/${var.project_tag}/"
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600

  tags = local.common_tags
}

# Terraform's S3 backend operations are outside a Terraform plan, so IAM Policy
# Autopilot cannot derive them from plan.json. Keep this policy limited to one
# state key and its native lock file.
data "aws_iam_policy_document" "state_access" {
  statement {
    sid       = "ListStatePrefix"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.terraform_state.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        local.state_key,
        "${local.state_key}.tflock",
      ]
    }
  }

  statement {
    sid     = "ReadWriteStateAndLock"
    actions = ["s3:GetObject", "s3:PutObject"]
    resources = [
      "${aws_s3_bucket.terraform_state.arn}/${local.state_key}",
      "${aws_s3_bucket.terraform_state.arn}/${local.state_key}.tflock",
    ]
  }

  statement {
    sid       = "ReleaseStateLock"
    actions   = ["s3:DeleteObject"]
    resources = ["${aws_s3_bucket.terraform_state.arn}/${local.state_key}.tflock"]
  }

  statement {
    sid = "ReadStateBucketConfiguration"
    actions = [
      "s3:GetEncryptionConfiguration",
      "s3:GetBucketVersioning",
    ]
    resources = [aws_s3_bucket.terraform_state.arn]
  }
}

resource "aws_iam_role_policy" "state_access" {
  name   = "terraform-state-access"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.state_access.json
}

# A local, gitignored bootstrap step writes scoped, Autopilot-reviewed
# update policies here after inspecting the deployed Terraform state.
locals {
  generated_policy_files = fileset(path.module, "generated/github-update-*.json")
}

resource "terraform_data" "generated_policy_guard" {
  input = sort(tolist(local.generated_policy_files))

  lifecycle {
    precondition {
      condition     = !var.require_generated_policies || length(local.generated_policy_files) >= 2
      error_message = "Generate the scoped GitHub update policies from application state before planning bootstrap."
    }
  }
}

resource "aws_iam_policy" "generated_deploy" {
  for_each = local.generated_policy_files

  name   = "${local.name_prefix}-${trimsuffix(basename(each.value), ".json")}"
  path   = "/${var.project_tag}/"
  policy = file("${path.module}/${each.value}")

  depends_on = [terraform_data.generated_policy_guard]
  tags       = local.common_tags
}

resource "aws_iam_role_policy_attachment" "generated_deploy" {
  for_each = local.generated_policy_files

  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.generated_deploy[each.value].arn
}
