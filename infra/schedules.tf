# The clock-driven half. EventBridge Scheduler rather than scheduled rules:
# it reads cron in a real time zone (DST included) and is where AWS puts new
# scheduling features. Scheduler invokes asynchronously, so the reserved
# concurrency of 1 on each worker queues an overlapping run instead of doubling.

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.fn["sync"].arn,
      aws_lambda_function.fn["lessons"].arn,
      aws_lambda_function.fn["api"].arn,
    ]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "invoke-workers"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

locals {
  schedules = {
    sync    = var.sync_schedule
    lessons = var.lessons_schedule
  }
}

resource "aws_scheduler_schedule" "worker" {
  for_each = local.schedules

  name                         = "${var.name}-${each.key}"
  schedule_expression          = each.value
  schedule_expression_timezone = var.schedule_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.fn[each.key].arn
    role_arn = aws_iam_role.scheduler.arn
    # lessons_handler logs this, so a run can be traced to what woke it.
    input = jsonencode({ trigger = "schedule" })
  }
}

# Keeps one API instance warm. A cold start is about five seconds of init
# before the first request is served, and the app's home screen waits on that
# request; a ping every few minutes means it is usually already up. The
# handler answers `{"warmer": true}` without touching the app, so each ping is
# a few milliseconds -- a few thousand a month, well inside the free tier.
resource "aws_scheduler_schedule" "api_warmer" {
  count = var.api_warmer_schedule == null ? 0 : 1

  name                = "${var.name}-api-warmer"
  schedule_expression = var.api_warmer_schedule

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.fn["api"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ warmer = true })
  }
}
