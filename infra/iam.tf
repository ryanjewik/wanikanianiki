# Two roles. They share logging and read access to the secrets; only the API
# may publish events, since it is the only thing that has any to publish.

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = toset(["api", "worker"])
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each   = aws_iam_role.fn
  role       = each.value.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["ssm:GetParametersByPath"]
    # GetParametersByPath is authorised against the path exactly as requested —
    # and the functions request `/kanji-workshop/`, trailing slash included
    # (SSM_PARAMETER_PATH). Granting only the slash-less form was the first
    # deploy's AccessDenied, so both spellings are listed.
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.name}",
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.name}/",
    ]
  }
  # SecureString decryption under the AWS-managed aws/ssm key needs no kms
  # statement: that key's policy already admits callers coming through SSM.
}

resource "aws_iam_role_policy" "read_secrets" {
  for_each = aws_iam_role.fn
  name     = "read-secrets"
  role     = each.value.id
  policy   = data.aws_iam_policy_document.read_secrets.json
}

data "aws_iam_policy_document" "publish_events" {
  statement {
    actions   = ["events:PutEvents"]
    resources = [aws_cloudwatch_event_bus.main.arn]
  }
}

resource "aws_iam_role_policy" "publish_events" {
  name   = "publish-events"
  role   = aws_iam_role.fn["api"].id
  policy = data.aws_iam_policy_document.publish_events.json
}
