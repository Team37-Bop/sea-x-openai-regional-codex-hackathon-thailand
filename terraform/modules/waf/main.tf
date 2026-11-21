terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}
variable "name" { type = string }
variable "edge" { type = bool }
variable "mode" { type = string }
variable "limit" { type = number }
variable "log_days" { type = number }

resource "aws_wafv2_web_acl" "app" {
  name  = var.name
  scope = var.edge ? "CLOUDFRONT" : "REGIONAL"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    sampled_requests_enabled   = false
    metric_name                = var.name
  }
  dynamic "rule" {
    for_each = { AWSManagedRulesCommonRuleSet = 0, AWSManagedRulesKnownBadInputsRuleSet = 1 }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        dynamic "count" {
          for_each = var.mode == "count" ? [1] : []
          content {}
        }
        dynamic "none" {
          for_each = var.mode == "block" ? [1] : []
          content {}
        }
      }
      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? [1] : []
            content {
              name = "SizeRestrictions_BODY"
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        sampled_requests_enabled   = false
        metric_name                = rule.key
      }
    }
  }
  rule {
    name     = "RequestsPerIP"
    priority = 2
    action {
      dynamic "count" {
        for_each = var.mode == "count" ? [1] : []
        content {}
      }
      dynamic "block" {
        for_each = var.mode == "block" ? [1] : []
        content {}
      }
    }
    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        limit                 = var.limit
        evaluation_window_sec = 300
        dynamic "scope_down_statement" {
          for_each = var.edge ? [1] : []
          content {
            byte_match_statement {
              positional_constraint = "STARTS_WITH"
              search_string         = "/api/"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = false
      metric_name                = "RequestsPerIP"
    }
  }
}
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.name}"
  retention_in_days = var.log_days
}
resource "aws_wafv2_web_acl_logging_configuration" "app" {
  resource_arn            = aws_wafv2_web_acl.app.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  dynamic "redacted_fields" {
    for_each = toset(["authorization", "x-bop-trip-token", "cookie"])
    content {
      single_header { name = redacted_fields.value }
    }
  }
}
output "arn" { value = aws_wafv2_web_acl.app.arn }
output "name" { value = aws_wafv2_web_acl.app.name }
