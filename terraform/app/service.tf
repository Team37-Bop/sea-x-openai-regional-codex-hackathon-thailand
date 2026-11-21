resource "aws_s3_bucket" "app" {
  for_each = toset(["frontend", "releases"])
  bucket   = "${local.name}-${each.key}-${var.account_id}-${var.region}"
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "app" {
  for_each                = aws_s3_bucket.app
  bucket                  = each.value.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "app" {
  for_each = aws_s3_bucket.app
  bucket   = each.value.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  for_each = aws_s3_bucket.app
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

locals {
  web_root    = "${path.module}/../../dist"
  lambda_root = "${path.module}/../../build/lambda"
  mime        = { html = "text/html; charset=utf-8", js = "text/javascript; charset=utf-8", mjs = "text/javascript; charset=utf-8", css = "text/css; charset=utf-8", json = "application/json", svg = "image/svg+xml", png = "image/png", webp = "image/webp", woff2 = "font/woff2" }
}
resource "aws_s3_object" "frontend" {
  for_each      = fileset(local.web_root, "**")
  bucket        = aws_s3_bucket.app["frontend"].id
  key           = each.key
  source        = "${local.web_root}/${each.key}"
  source_hash   = filesha256("${local.web_root}/${each.key}")
  content_type  = lookup(local.mime, reverse(split(".", each.key))[0], "application/octet-stream")
  cache_control = startswith(each.key, "assets/") ? "public,max-age=31536000,immutable" : "no-cache"
  depends_on    = [aws_s3_bucket_versioning.app]
}
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = local.lambda_root
  output_path = "${path.module}/../../build/bop-lambda.zip"
}
resource "aws_s3_object" "release" {
  bucket      = aws_s3_bucket.app["releases"].id
  key         = "lambda/${data.archive_file.lambda.output_sha256}.zip"
  source      = data.archive_file.lambda.output_path
  source_hash = data.archive_file.lambda.output_sha256
  depends_on  = [aws_s3_bucket_versioning.app]
  lifecycle { create_before_destroy = true }
}
resource "aws_dynamodb_table" "state" {
  name         = "${local.name}-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "record_key"
  attribute {
    name = "record_key"
    type = "S"
  }
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
  point_in_time_recovery {
    enabled                 = true
    recovery_period_in_days = 35
  }
  server_side_encryption { enabled = true }
  deletion_protection_enabled = true
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_key" "runtime" {
  description         = "Bop runtime configuration"
  enable_key_rotation = true
  lifecycle { prevent_destroy = true }
}
resource "aws_secretsmanager_secret" "runtime" {
  name       = "${local.name}/runtime"
  kms_key_id = aws_kms_key.runtime.arn
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role" "runtime" {
  name               = "${local.name}-runtime"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_cloudwatch_log_group" "runtime" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = var.log_days
}
resource "aws_iam_role_policy" "runtime" {
  role = aws_iam_role.runtime.id
  name = "runtime"
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.runtime.arn}:*" },
    { Effect = "Allow", Action = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"], Resource = "*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem"], Resource = aws_dynamodb_table.state.arn },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.runtime.arn },
    { Effect = "Allow", Action = "kms:Decrypt", Resource = aws_kms_key.runtime.arn, Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" } } }
  ] })
}
resource "aws_lambda_function" "api" {
  function_name = local.name
  role          = aws_iam_role.runtime.arn
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 1024
  ephemeral_storage { size = 512 }
  timeout           = 300
  publish           = true
  s3_bucket         = aws_s3_object.release.bucket
  s3_key            = aws_s3_object.release.key
  s3_object_version = aws_s3_object.release.version_id
  source_code_hash  = data.archive_file.lambda.output_base64sha256
  tracing_config { mode = "Active" }
  environment {
    variables = {
      NODE_ENV              = "production"
      BOP_PROVIDER          = "openai"
      BOP_CACHE_DIR         = "/tmp/bop/cache"
      BOP_FLIGHT_BOOKING    = "0"
      BOP_STATE_TABLE       = aws_dynamodb_table.state.name
      BOP_RUNTIME_SECRET_ID = aws_secretsmanager_secret.runtime.arn
      BOP_LINE_MONTHLY_CAP  = "200"
    }
  }
  depends_on = [aws_iam_role_policy.runtime]
}
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}
