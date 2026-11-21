module "regional_waf" {
  source   = "../modules/waf"
  name     = "${local.name}-api"
  edge     = false
  mode     = var.waf_mode
  limit    = var.waf_requests_per_ip
  log_days = var.log_days
}
module "edge_waf" {
  source    = "../modules/waf"
  providers = { aws = aws.edge }
  name      = "${local.name}-edge"
  edge      = true
  mode      = var.waf_mode
  limit     = var.waf_requests_per_ip
  log_days  = var.log_days
}
resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_api_gateway_stage.app.arn
  web_acl_arn  = module.regional_waf.arn
}
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name}-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
data "aws_cloudfront_cache_policy" "api" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_cache_policy" "site" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_origin_request_policy" "api" { name = "Managed-AllViewerExceptHostHeader" }
resource "aws_cloudfront_response_headers_policy" "frontend" {
  name = "${local.name}-frontend"
  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://tiles.openfreemap.org https://api.line.me https://*.line-scdn.net https://*.line.me; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
      override                = true
    }
    content_type_options { override = true }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  web_acl_id          = module.edge_waf.arn
  origin {
    domain_name              = aws_s3_bucket.app["frontend"].bucket_regional_domain_name
    origin_id                = "frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }
  origin {
    domain_name = "${aws_api_gateway_rest_api.api.id}.execute-api.${var.region}.amazonaws.com"
    origin_path = "/${aws_api_gateway_stage.app.stage_name}"
    origin_id   = "api"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 120
    }
  }
  default_cache_behavior {
    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend.id
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.site.id
    compress                   = true
  }
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.api.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.api.id
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.app["frontend"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "OnlyDistributionReadsObjects", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject",
    Resource = "${aws_s3_bucket.app["frontend"].arn}/*", Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } } }
  ] })
  depends_on = [aws_s3_bucket_public_access_block.app]
}
output "site_url" { value = "https://${aws_cloudfront_distribution.site.domain_name}" }
output "frontend_origin" { value = "https://${aws_s3_bucket.app["frontend"].bucket_regional_domain_name}" }
output "distribution_id" { value = aws_cloudfront_distribution.site.id }
output "rest_api_id" { value = aws_api_gateway_rest_api.api.id }
output "runtime_secret_arn" { value = aws_secretsmanager_secret.runtime.arn }
output "waf_mode" { value = var.waf_mode }
