mock_provider "aws" {}
variables {
  account_id               = "000000000081"
  region                   = "ap-southeast-1"
  repository               = "example/bop"
  repository_owner_id      = "100"
  repository_id            = "200"
  state_bucket             = "example-bop-state"
  github_oidc_provider_arn = "arn:aws:iam::000000000081:oidc-provider/token.actions.githubusercontent.com"
  gateway_logging_role_arn = "arn:aws:iam::000000000081:role/example-gateway"
}
run "empty_bootstrap" {
  command = plan
  assert {
    condition     = length(aws_iam_role_policy.release) == 0
    error_message = "The CI identity gains write permissions after an operator supplies the existing app IDs."
  }
  assert {
    condition     = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:example@100/bop@200:ref:refs/heads/main"
    error_message = "OIDC trust must bind immutable owner and repository IDs to main."
  }
}
run "known_application" {
  command = plan
  variables {
    distribution_id = "E123456789"
    rest_api_id     = "abc123"
  }
  assert {
    condition     = length(aws_iam_role_policy.release) == 1
    error_message = "A provisioned app must have a scoped release policy."
  }
}
