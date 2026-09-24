terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.40"
    }
  }
}

provider "aws" {
  region = var.region

  # The one account this app deploys to. Any other credentials — a stray
  # AWS_PROFILE, a default profile from another job — stop before planning.
  allowed_account_ids = ["050451388503"]

  default_tags {
    tags = {
      app = var.name
    }
  }
}

data "aws_caller_identity" "current" {
  # The same account also holds the `sumo-admin` IAM user, which exists for
  # something else — and its keys back this machine's other AWS profiles. A
  # postcondition, not a `check` block: a failed check only warns, and this
  # has to stop the run.
  lifecycle {
    postcondition {
      condition     = !endswith(self.arn, ":user/sumo-admin")
      error_message = "These credentials are the sumo-admin IAM user, which is not for this app. Sign in with `aws login --profile kanji` and set AWS_PROFILE=kanji."
    }
  }
}
