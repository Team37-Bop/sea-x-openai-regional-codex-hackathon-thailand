output "application_url" {
  description = "Public CloudFront HTTPS entry point."
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.app.id
}

output "api_gateway_url" {
  description = "Regional REST API endpoint; CloudFront routes /api/* here."
  value       = "https://${aws_api_gateway_rest_api.app.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_api_gateway_stage.app.stage_name}"
}

output "lambda_function_name" {
  value = aws_lambda_function.api.function_name
}

output "state_table_name" {
  value = aws_dynamodb_table.state.name
}

output "runtime_secret_arn" {
  description = "Populate this secret out of band with scripts/sync-runtime-secret.sh."
  value       = aws_secretsmanager_secret.runtime.arn
}

output "frontend_bucket_name" {
  description = "Private S3 origin; public access is blocked and CloudFront uses OAC."
  value       = aws_s3_bucket.frontend.id
}

output "waf_mode" {
  value = var.waf_mode
}

output "resource_tag" {
  value = "Project=${var.project_tag}"
}
