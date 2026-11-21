resource "aws_sns_topic" "alerts" { name = "${local.name}-alerts" }
resource "aws_sns_topic" "edge" {
  provider = aws.edge
  name     = "${local.name}-edge-alerts"
}
resource "aws_sns_topic_subscription" "regional_email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
resource "aws_sns_topic_subscription" "edge_email" {
  provider  = aws.edge
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.edge.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
data "aws_iam_policy_document" "budget_sns" {
  statement {
    sid       = "TopicOwner"
    actions   = ["SNS:*"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
  }
  statement {
    sid       = "BudgetNotifications"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:budgets::${var.account_id}:budget/${local.name}"]
    }
  }
}
resource "aws_sns_topic_policy" "budget" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.budget_sns.json
}
resource "aws_budgets_budget" "workload" {
  name         = local.name
  budget_type  = "COST"
  limit_amount = tostring(var.budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$poc-tourism"]
  }
  dynamic "notification" {
    for_each = { FORECASTED = 80, ACTUAL = 100 }
    content {
      comparison_operator       = "GREATER_THAN"
      notification_type         = notification.key
      threshold                 = notification.value
      threshold_type            = "PERCENTAGE"
      subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
    }
  }
  depends_on = [aws_sns_topic_policy.budget]
}
locals {
  regional_metrics = {
    api      = { namespace = "AWS/ApiGateway", metric = "5XXError", dimensions = { ApiName = aws_api_gateway_rest_api.api.name, Stage = var.environment } }
    lambda   = { namespace = "AWS/Lambda", metric = "Errors", dimensions = { FunctionName = aws_lambda_function.api.function_name } }
    database = { namespace = "AWS/DynamoDB", metric = "ThrottledRequests", dimensions = { TableName = aws_dynamodb_table.state.name } }
    waf      = { namespace = "AWS/WAFV2", metric = "BlockedRequests", dimensions = { WebACL = module.regional_waf.name, Rule = "ALL", Region = var.region } }
  }
  edge_metrics = {
    cloudfront = { namespace = "AWS/CloudFront", metric = "5xxErrorRate", dimensions = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }, statistic = "Average" }
    waf        = { namespace = "AWS/WAFV2", metric = "BlockedRequests", dimensions = { WebACL = module.edge_waf.name, Rule = "ALL" }, statistic = "Sum" }
  }
}
resource "aws_cloudwatch_metric_alarm" "regional" {
  for_each            = local.regional_metrics
  alarm_name          = "${local.name}-${each.key}-errors"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "edge" {
  provider            = aws.edge
  for_each            = local.edge_metrics
  alarm_name          = "${local.name}-edge-${each.key}-errors"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.statistic
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.edge.arn]
}
resource "aws_cloudwatch_dashboard" "ops" {
  dashboard_name = "${local.name}-operations"
  dashboard_body = jsonencode({ widgets = concat(
    [for name, m in local.regional_metrics : { type = "metric", width = 12, height = 6, properties = { title = name, region = var.region, stat = "Sum", metrics = [concat([m.namespace, m.metric], flatten([for k, v in m.dimensions : [k, v]]))] } }],
    [for name, m in local.edge_metrics : { type = "metric", width = 12, height = 6, properties = { title = "edge-${name}", region = "us-east-1", stat = m.statistic, metrics = [concat([m.namespace, m.metric], flatten([for k, v in m.dimensions : [k, v]]))] } }]
  ) })
}
