resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"
  description   = "Bop streaming API backend"
  role          = aws_iam_role.api.arn
  handler       = "server/lambda-handler.handler"
  runtime       = "nodejs24.x"
  architectures = ["arm64"]

  s3_bucket         = aws_s3_object.lambda.bucket
  s3_key            = aws_s3_object.lambda.key
  s3_object_version = aws_s3_object.lambda.version_id
  source_code_hash  = data.archive_file.lambda.output_base64sha256

  memory_size = 1024
  timeout     = 300
  publish     = true

  ephemeral_storage {
    size = 512
  }

  environment {
    variables = {
      NODE_ENV                 = "production"
      BOP_PROVIDER             = "openai"
      BOP_RUNTIME_SECRET_ID    = local.active_runtime_secret.arn
      BOP_CACHE_DIR            = "/tmp/bop/cache"
      BOP_STATE_TABLE          = aws_dynamodb_table.state.name
      BOP_STATE_RETENTION_DAYS = tostring(var.state_retention_days)
      BOP_NO_STORE             = "0"
      BOP_FLIGHT_BOOKING       = "0"
      BOP_WEATHER_DISK         = "1"
      BOP_LINE_MONTHLY_CAP     = "200"
    }
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
  }

  depends_on = [
    aws_cloudwatch_log_group.function,
    aws_iam_role_policy.api,
    aws_s3_bucket_policy.artifacts,
  ]

  tags = local.common_tags
}

resource "aws_lambda_alias" "live" {
  name             = "live"
  description      = "Terraform-managed production revision"
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}
