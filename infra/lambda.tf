# Three functions off one zip (backend/scripts/build_lambda.py). They differ only in
# handler, timeout and concurrency — see backend/app/lambda_handler.py for why each
# number is what it is.
#
# `ocr_handler` is not deployed: it is blocked on durable image storage, and
# the API's in-process background task is the working path until that lands.

locals {
  artifact    = "${path.module}/../backend/build/lambda.zip"
  secret_path = "/${var.name}/"

  functions = {
    api = {
      handler = "app.lambda_handler.handler"
      # A photo upload runs its extraction in the same invocation (Mangum waits
      # for background tasks), so this sits above VISION_TIMEOUT_SECONDS.
      timeout  = 180
      memory   = 1024
      reserved = -1
      role     = "api"
    }
    sync = {
      handler = "app.lambda_handler.sync_handler"
      timeout = 300
      memory  = 512
      # WaniKani's 60/min is per token; a second concurrent sync only collides.
      reserved = 1
      role     = "worker"
    }
    lessons = {
      handler = "app.lambda_handler.lessons_handler"
      timeout = 900
      memory  = 512
      # The low-water check and the write are not one transaction: two
      # overlapping runs would both see "below the mark" and both generate.
      # This is also what makes a burst of events safe — they queue behind the
      # running pass and each finds the queue already full.
      reserved = 1
      role     = "worker"
    }
  }
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = 14
}

resource "aws_lambda_function" "fn" {
  for_each = local.functions

  function_name    = "${var.name}-${each.key}"
  role             = aws_iam_role.fn[each.value.role].arn
  handler          = each.value.handler
  runtime          = "python3.12" # must match PYTHON_VERSION in build_lambda.py
  architectures    = ["x86_64"]   # must match PLATFORM in build_lambda.py
  filename         = local.artifact
  source_code_hash = filebase64sha256(local.artifact)
  timeout          = each.value.timeout
  memory_size      = each.value.memory

  reserved_concurrent_executions = each.value.reserved

  environment {
    variables = merge(
      {
        ENVIRONMENT = "production"
        LOG_LEVEL   = var.log_level
        # Secrets are read from here at cold start (app/parameters.py), never
        # passed as values, so none of them reach Terraform state.
        SSM_PARAMETER_PATH = local.secret_path
      },
      each.key == "api" ? { EVENT_BUS_NAME = aws_cloudwatch_event_bus.main.name } : {},
    )
  }

  depends_on = [aws_cloudwatch_log_group.fn]
}

# Both workers are only ever invoked asynchronously, by Scheduler or a rule.
# No retries on error: each handler records its own failure and returns, and
# the next schedule or event is the retry. A throttle (the reserved slot is
# busy) is different — Lambda holds the event and retries it until it is an
# hour old, which is how a burst of events waits its turn instead of dropping.
resource "aws_lambda_function_event_invoke_config" "worker" {
  for_each = toset(["sync", "lessons"])

  function_name                = aws_lambda_function.fn[each.key].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 3600
}

# Private by default, and public only by choice (var.api_public). The API
# checks its own bearer key (API_KEY in Parameter Store), so a public URL is no
# longer an open one — but photo import still keeps its drafts in process
# memory and misbehaves across containers, which is the reason this is a
# decision rather than a default. See infra/README.md.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.fn["api"].function_name
  authorization_type = var.api_public ? "NONE" : "AWS_IAM"
}

# A public URL needs both statements: one to reach the URL, one to invoke the
# function through it. `invoked_via_function_url` keeps the second from
# granting a plain Invoke to the world.
resource "aws_lambda_permission" "api_url_public" {
  count = var.api_public ? 1 : 0

  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.fn["api"].function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "api_invoke_public" {
  count = var.api_public ? 1 : 0

  statement_id             = "FunctionURLAllowInvokeAction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.fn["api"].function_name
  principal                = "*"
  invoked_via_function_url = true
}
