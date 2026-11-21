resource "aws_api_gateway_rest_api" "app" {
  name        = "${local.name_prefix}-api"
  description = "Regional response-streaming API for Bop"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = local.common_tags
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.app.id
  parent_id   = aws_api_gateway_rest_api.app.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
  rest_api_id      = aws_api_gateway_rest_api.app.id
  resource_id      = aws_api_gateway_resource.proxy.id
  http_method      = "ANY"
  authorization    = "NONE"
  api_key_required = false
}

resource "aws_api_gateway_integration" "proxy" {
  rest_api_id             = aws_api_gateway_rest_api.app.id
  resource_id             = aws_api_gateway_resource.proxy.id
  http_method             = aws_api_gateway_method.proxy.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  response_transfer_mode  = "STREAM"
  timeout_milliseconds    = 300000
  uri                     = "arn:${data.aws_partition.current.partition}:apigateway:${var.aws_region}:lambda:path/2021-11-15/functions/${aws_lambda_alias.live.arn}/response-streaming-invocations"
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGatewayStreamingInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  qualifier     = aws_lambda_alias.live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.app.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "app" {
  rest_api_id = aws_api_gateway_rest_api.app.id

  triggers = {
    redeployment = sha1(jsonencode({
      resource_id            = aws_api_gateway_resource.proxy.id
      method_id              = aws_api_gateway_method.proxy.id
      integration_id         = aws_api_gateway_integration.proxy.id
      lambda_version         = aws_lambda_alias.live.function_version
      response_transfer_mode = aws_api_gateway_integration.proxy.response_transfer_mode
    }))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_lambda_permission.api_gateway]
}

resource "aws_api_gateway_stage" "app" {
  rest_api_id          = aws_api_gateway_rest_api.app.id
  deployment_id        = aws_api_gateway_deployment.app.id
  stage_name           = var.environment
  description          = "${var.project_tag} ${var.environment}"
  xray_tracing_enabled = true

  variables = {
    Environment = var.environment
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      sourceIp           = "$context.identity.sourceIp"
      requestTime        = "$context.requestTime"
      httpMethod         = "$context.httpMethod"
      resourcePath       = "$context.resourcePath"
      status             = "$context.status"
      responseLength     = "$context.responseLength"
      responseLatency    = "$context.responseLatency"
      integrationLatency = "$context.integration.latency"
      errorMessage       = "$context.error.message"
    })
  }

  depends_on = [aws_cloudwatch_log_group.api]
  tags       = local.common_tags
}

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.app.id
  stage_name  = aws_api_gateway_stage.app.stage_name
  method_path = "*/*"

  settings {
    metrics_enabled        = true
    data_trace_enabled     = false
    logging_level          = "ERROR"
    throttling_rate_limit  = var.api_throttle_rate
    throttling_burst_limit = var.api_throttle_burst
    caching_enabled        = false
  }
}
