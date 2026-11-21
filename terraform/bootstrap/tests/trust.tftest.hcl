mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "000000000081" }
  }
}

variables {
  expected_account_id        = "000000000081"
  github_owner               = "example"
  github_repository          = "bop"
  github_owner_id            = "100"
  github_repository_id       = "200"
  require_generated_policies = false
}

run "empty_bootstrap" {
  command = plan

  assert {
    condition     = length(aws_iam_role_policy_attachment.generated_deploy) == 0
    error_message = "The CI identity gains update permissions after an operator generates policies from app state."
  }
  assert {
    condition = anytrue(flatten([
      for statement in data.aws_iam_policy_document.github_trust.statement : [
        for condition in statement.condition :
        condition.variable == "token.actions.githubusercontent.com:sub" &&
        condition.test == "StringEquals" &&
        toset(condition.values) == toset(["repo:example@100/bop@200:ref:refs/heads/main"])
      ]
    ]))
    error_message = "OIDC trust must bind immutable owner and repository IDs to main."
  }
}
run "missing_generated_policies" {
  command = plan
  variables {
    require_generated_policies = true
  }
  expect_failures = [terraform_data.generated_policy_guard]
}
