variable "expected_account_id" {
  description = "Full AWS account ID expected by the fail-closed provider guard."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must contain exactly 12 digits."
  }
}

variable "aws_region" {
  description = "AWS home Region for state and the workload."
  type        = string
  default     = "us-east-1"
}

variable "github_owner" {
  type        = string
  description = "GitHub organization or owner allowed to deploy."
  default     = "Team37-Bop"
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to deploy."
  default     = "sea-x-openai-regional-codex-hackathon-thailand"
}

variable "github_owner_id" {
  type        = string
  description = "Immutable GitHub owner ID used in OIDC subjects."
  default     = "224233918"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "github_owner_id must be numeric."
  }
}

variable "github_repository_id" {
  type        = string
  description = "Immutable GitHub repository ID used in OIDC subjects."
  default     = "1466116167"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must be numeric."
  }
}

variable "github_branch" {
  type        = string
  description = "Only this branch may assume the deployment role."
  default     = "main"
}

variable "create_github_oidc_provider" {
  description = "Set true only when this AWS account does not yet have the GitHub Actions OIDC provider."
  type        = bool
  default     = false
}

variable "require_generated_policies" {
  description = "Fail closed if scoped GitHub update policy files were not regenerated from application state."
  type        = bool
  default     = true
}

variable "project_tag" {
  description = "Project tag required on every supported deployment resource."
  type        = string
  default     = "sea-openai"
}

variable "environment" {
  type    = string
  default = "prod"
}
