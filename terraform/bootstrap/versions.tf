terraform {
  required_version = ">= 1.10.0, < 2.0.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
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
variable "repository" {
  type = string
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.repository))
    error_message = "Use owner/repository."
  }
}
variable "repository_owner_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]+$", var.repository_owner_id))
    error_message = "Supply the numeric GitHub owner ID."
  }
}
variable "repository_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]+$", var.repository_id))
    error_message = "Supply the numeric GitHub repository ID."
  }
}
variable "state_bucket" { type = string }
variable "environment" {
  type    = string
  default = "poc"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,12}$", var.environment))
    error_message = "Use a short lowercase environment name."
  }
}
variable "distribution_id" {
  type        = string
  default     = ""
  description = "ID of the CloudFront distribution from the first operator-applied application release."
  validation {
    condition     = var.distribution_id == "" || can(regex("^E[A-Z0-9]+$", var.distribution_id))
    error_message = "Supply a CloudFront distribution ID."
  }
}
variable "rest_api_id" {
  type        = string
  default     = ""
  description = "ID of the existing application API."
  validation {
    condition     = var.rest_api_id == "" || can(regex("^[a-z0-9]+$", var.rest_api_id))
    error_message = "Supply a REST API ID."
  }
}
variable "github_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "Existing token.actions.githubusercontent.com provider ARN, if the account already trusts GitHub."
  validation {
    condition     = var.github_oidc_provider_arn == "" || var.github_oidc_provider_arn == "arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"
    error_message = "Supply the GitHub OIDC provider for this account."
  }
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags { tags = { Project = "poc-tourism", Workload = "poc-tourism", Environment = var.environment, ManagedBy = "Terraform", Repository = var.repository } }
}
