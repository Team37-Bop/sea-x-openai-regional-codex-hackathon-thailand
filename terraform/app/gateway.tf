resource "aws_api_gateway_rest_api" "api" {
  name = local.name
  endpoint_configuration { types = ["REGIONAL"] }
}
resource "aws_api_gateway_resource" "api" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "api"
}
resource "aws_api_gateway_resource" "routes" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.api.id
  path_part   = "{proxy+}"
}
resource "aws_api_gateway_method" "routes" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.routes.id
  http_method   = "ANY"
  authorization = "NONE"
}
resource "aws_api_gateway_integration" "stream" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.routes.id
  http_method             = aws_api_gateway_method.routes.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = "arn:aws:apigateway:${var.region}:lambda:path/2021-11-15/functions/${aws_lambda_alias.live.arn}/response-streaming-invocations"
  response_transfer_mode  = "STREAM"
  timeout_milliseconds    = 300000
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "ApiGatewayStreaming"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  qualifier     = aws_lambda_alias.live.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/${var.environment}/*/api/*"
}
resource "aws_api_gateway_deployment" "live" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  triggers = {
    api = sha256(jsonencode([aws_api_gateway_resource.routes.path, aws_api_gateway_method.routes.authorization, aws_api_gateway_method.routes.http_method, aws_api_gateway_integration.stream.uri, aws_api_gateway_integration.stream.timeout_milliseconds, aws_api_gateway_integration.stream.response_transfer_mode, aws_lambda_alias.live.function_version]))
  }
  lifecycle { create_before_destroy = true }
}
resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_days
}
resource "aws_cloudwatch_log_group" "execution" {
  name              = "API-Gateway-Execution-Logs_${aws_api_gateway_rest_api.api.id}/${var.environment}"
  retention_in_days = var.log_days
}
# API Gateway uses a shared regional CloudWatch role configured by the account operator.
resource "aws_api_gateway_stage" "app" {
  depends_on            = [aws_cloudwatch_log_group.execution]
  deployment_id         = aws_api_gateway_deployment.live.id
  rest_api_id           = aws_api_gateway_rest_api.api.id
  stage_name            = var.environment
  xray_tracing_enabled  = true
  cache_cluster_enabled = false
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway.arn
    format          = jsonencode({ requestId = "$context.requestId", path = "$context.resourcePath", method = "$context.httpMethod", status = "$context.status", latency = "$context.responseLatency", transfer = "$context.integration.responseTransferMode" })
  }
}
resource "aws_api_gateway_method_settings" "stage" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.app.stage_name
  method_path = "*/*"
  settings {
    metrics_enabled        = true
    logging_level          = "ERROR"
    data_trace_enabled     = false
    caching_enabled        = false
    throttling_burst_limit = var.api_burst
    throttling_rate_limit  = var.api_rate
  }
}
