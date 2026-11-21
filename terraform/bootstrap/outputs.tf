output "terraform_state_bucket" {
  description = "S3 bucket used by the application Terraform backend."
  value       = aws_s3_bucket.terraform_state.id
}

output "terraform_state_key" {
  description = "State object key used by the application stack."
  value       = local.state_key
}

output "github_deploy_role_arn" {
  description = "Role ARN configured as the GitHub Actions AWS_DEPLOY_ROLE_ARN variable."
  value       = aws_iam_role.github_deploy.arn
}

output "github_oidc_provider_arn" {
  value = local.github_oidc_provider_arn
}
