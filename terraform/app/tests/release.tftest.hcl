mock_provider "aws" {}
mock_provider "aws" { alias = "edge" }
mock_provider "archive" {}

variables {
  account_id = "000000000081"
  region     = "ap-southeast-1"
  repository = "example/bop"
}

run "protected_streaming_release" {
  command = plan
  assert {
    condition     = aws_dynamodb_table.state.deletion_protection_enabled && aws_dynamodb_table.state.hash_key == "record_key" && one(aws_dynamodb_table.state.ttl).attribute_name == "expires_at" && one(aws_dynamodb_table.state.point_in_time_recovery).recovery_period_in_days == 35
    error_message = "Operational state requires event TTL, 35-day recovery and deletion protection."
  }
  assert {
    condition     = aws_lambda_function.api.runtime == "nodejs24.x" && aws_lambda_function.api.publish && contains(aws_lambda_function.api.architectures, "arm64") && aws_lambda_function.api.timeout == 300 && aws_lambda_function.api.memory_size == 1024
    error_message = "The streaming adapter must run as a published Node.js 24 arm64 function."
  }
  assert {
    condition     = aws_lambda_alias.live.name == "live" && aws_api_gateway_integration.stream.response_transfer_mode == "STREAM" && aws_api_gateway_integration.stream.timeout_milliseconds == 300000 && aws_api_gateway_integration.stream.type == "AWS_PROXY"
    error_message = "The REST API must stream the aliased Lambda response."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.app["frontend"].restrict_public_buckets && aws_s3_bucket_public_access_block.app["frontend"].block_public_policy && aws_cloudfront_origin_access_control.frontend.signing_behavior == "always"
    error_message = "CloudFront must sign requests to a private frontend bucket."
  }
  assert {
    condition     = alltrue([for behavior in aws_cloudfront_distribution.site.ordered_cache_behavior : behavior.path_pattern == "/api/*" && length(behavior.allowed_methods) == 7])
    error_message = "CloudFront must forward every supported API method."
  }
  assert {
    condition     = aws_api_gateway_stage.app.xray_tracing_enabled && one(aws_api_gateway_method_settings.stage.settings).data_trace_enabled == false && var.waf_mode == "count" && var.waf_requests_per_ip == 100
    error_message = "Default public ingress must limit traffic and avoid request-body logs."
  }
}
