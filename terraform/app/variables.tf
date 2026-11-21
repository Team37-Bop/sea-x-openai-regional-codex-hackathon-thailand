variable "expected_account_id" {
  description = "Full AWS account ID expected by the fail-closed provider guard."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must contain exactly 12 digits."
  }
}

variable "expected_account_suffix" {
  description = "Secondary deployment guard for the sanctioned account."
  type        = string
  default     = "0081"
}

variable "aws_region" {
  description = "Lambda and API Gateway Region. CloudFront and its edge WAF are global."
  type        = string
  default     = "us-east-1"
}

variable "project_tag" {
  description = "Required Project and Workload tag value."
  type        = string
  default     = "poc-tourism"
}

variable "environment" {
  type    = string
  default = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "waf_mode" {
  description = "Use count initially; switch to block only after reviewing WAF logs."
  type        = string
  default     = "count"

  validation {
    condition     = contains(["count", "block"], var.waf_mode)
    error_message = "waf_mode must be count or block."
  }
}

variable "api_throttle_rate" {
  description = "API Gateway steady-state requests per second."
  type        = number
  default     = 10

  validation {
    condition     = var.api_throttle_rate >= 1
    error_message = "api_throttle_rate must be at least 1."
  }
}

variable "api_throttle_burst" {
  description = "API Gateway token-bucket burst capacity."
  type        = number
  default     = 20

  validation {
    condition     = var.api_throttle_burst >= 1
    error_message = "api_throttle_burst must be at least 1."
  }
}

variable "waf_api_requests_per_five_minutes" {
  description = "Per-viewer-IP API request threshold evaluated by AWS WAF."
  type        = number
  default     = 100

  validation {
    condition     = var.waf_api_requests_per_five_minutes >= 10
    error_message = "AWS WAF rate limits must be at least 10 requests."
  }
}

variable "state_retention_days" {
  description = "TTL for POC booking audit records. Idempotency records use 24 hours."
  type        = number
  default     = 90

  validation {
    condition     = var.state_retention_days >= 1
    error_message = "state_retention_days must be at least one day."
  }
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "monthly_budget_usd" {
  description = "Monthly budget scoped to the Project=poc-tourism cost-allocation tag."
  type        = number
  default     = 50
}

variable "alarm_email" {
  description = "Optional email for budget and alarm notifications. AWS sends a confirmation email."
  type        = string
  default     = null
  nullable    = true
}

variable "custom_domain_name" {
  description = "Optional CloudFront hostname. DNS is intentionally managed outside this stack."
  type        = string
  default     = null
  nullable    = true
}

variable "cloudfront_acm_certificate_arn" {
  description = "Optional us-east-1 ACM certificate ARN matching custom_domain_name."
  type        = string
  default     = null
  nullable    = true
}

variable "cloudfront_price_class" {
  description = "PriceClass_200 includes Asia while limiting the highest-cost edge locations."
  type        = string
  default     = "PriceClass_200"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "Use a valid CloudFront price class."
  }
}
