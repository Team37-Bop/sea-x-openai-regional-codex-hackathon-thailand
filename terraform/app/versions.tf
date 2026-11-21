terraform {
  required_version = ">= 1.10.0, < 2.0.0"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}

variable "account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{8}0081$", var.account_id))
    error_message = "Supply the sanctioned 12-digit account ending 0081."
  }
}
variable "region" { type = string }
variable "repository" { type = string }
variable "environment" {
  type    = string
  default = "poc"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,12}$", var.environment))
    error_message = "Use a short lowercase environment name."
  }
}
variable "waf_mode" {
  type    = string
  default = "count"
  validation {
    condition     = contains(["count", "block"], var.waf_mode)
    error_message = "Choose count or block."
  }
}
variable "waf_requests_per_ip" {
  type    = number
  default = 100
}
variable "api_rate" {
  type    = number
  default = 10
}
variable "api_burst" {
  type    = number
  default = 20
}
variable "log_days" {
  type    = number
  default = 30
}
variable "budget_usd" {
  type    = number
  default = 50
}
variable "alert_email" {
  type    = string
  default = ""
}
locals {
  name = "bop-${var.environment}"
  tags = { Project = "poc-tourism", Workload = "poc-tourism", Environment = var.environment, ManagedBy = "Terraform", Repository = var.repository }
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags { tags = local.tags }
}
provider "aws" {
  alias               = "edge"
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]
  default_tags { tags = local.tags }
}
