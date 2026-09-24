# Infrastructure

Terraform for the AWS side: three Lambda functions off one zip, an EventBridge
bus with one rule, and two EventBridge Scheduler schedules.

```
                 ┌──────── Scheduler: rate(30 minutes) ─────────► sync     (concurrency 1)
                 │
 API function ───┤  LessonBundleClaimed ┐
 (publishes)     │  VocabConfirmed      ├─► bus ─► lesson-demand rule ─┐
                 │                      ┘                              ├─► lessons  (concurrency 1)
                 └──────── Scheduler: cron(0 7,19 * * ? *) ────────────┘
```

The schedules are the backstop; the events are what make a drained lesson queue
refill in a minute instead of by evening. Why each piece is shaped the way it
is lives next to the code: `app/services/events.py`, `app/lambda_handler.py`,
and the comments in the `.tf` files.

**Cost** is effectively zero at one person's usage: Scheduler's free tier is 14M
invocations a month, custom events are $1 per million, and the functions sit
inside Lambda's free tier. There is deliberately no VPC — see "Keep Lambda out
of a VPC" in `backend/README.md`.

## Applying it

Needs Terraform ≥ 1.6 and AWS credentials (`aws configure`). Nothing here has
been applied yet; it passes `terraform validate` and `terraform fmt` on
Terraform 1.16.4 with AWS provider 6.66.0, which is what the committed lock
file pins.

**1. Build the zip.** Re-run after any change under `app/`; Terraform notices
the new hash and redeploys.

```bash
cd backend
.venv/Scripts/python scripts/build_lambda.py
```

**2. Put the secrets in Parameter Store.** Not in Terraform, on purpose: a value
Terraform sets is a value Terraform state holds in plaintext. The functions read
everything under `/kanji-workshop/` at cold start (`app/parameters.py`), and each
parameter becomes the environment variable named by its last path segment.

The easy way is the script, run by you (it reads `backend/.env`, never prints
a secret, and refuses any account but this one):

```bash
aws login --profile kanji
powershell -ExecutionPolicy Bypass -File infra\put-secrets.ps1
```

It uploads `wanikani_apikey`, `DATABASE_URL`, `ANTHROPIC_API_KEY` (and
`ANTHROPIC_WORKSPACE_ID` if set), plus `API_KEY` — generated if `.env` has none,
and printed once so you can paste it into the app. The `SUPABASE_*` keys in the
same file are deliberately left out: the backend reaches Supabase only as
Postgres through `DATABASE_URL`, and nothing reads the others.

By hand, the same thing is one `put-parameter` per secret:

```bash
aws ssm put-parameter --profile kanji --type SecureString --name /kanji-workshop/API_KEY --value '<key>'
```

They live in `us-east-2`, the region Terraform deploys to (next to the Supabase
project, in Ohio) — the functions only look in their own region.

`API_KEY` is not optional here. The functions run with
`ENVIRONMENT=production`, where a missing key makes the API refuse every
request (503) rather than run open. Parameters are read at cold start, so after
changing one, force fresh containers — re-applying with a new zip does it, or
`aws lambda update-function-configuration` with any small change.

**3. Apply.**

```bash
cd infra
terraform init
$env:AWS_PROFILE = "kanji"   # PowerShell; the sumo-admin keys are refused
terraform apply              # region defaults to us-east-2, next to Supabase
```

Migrations still run from a laptop against `DATABASE_MIGRATION_URL`, as today.

## Checking it works

```bash
# One lesson pass, the way the schedule would run it:
aws lambda invoke --function-name kanji-workshop-lessons --payload '{"trigger":"manual"}' \
  --cli-binary-format raw-in-base64-out out.json && cat out.json

# The event path end to end — the lessons log should show
# "Lesson top-up triggered by LessonBundleClaimed" within a few seconds:
aws events put-events --entries '[{"EventBusName":"kanji-workshop","Source":"kanji-workshop.api","DetailType":"LessonBundleClaimed","Detail":"{}"}]'
aws logs tail /aws/lambda/kanji-workshop-lessons --since 5m
```

## Publishing events from the local API

The API publishes whenever `EVENT_BUS_NAME` is set, wherever it runs. So the
event path works before the API is on Lambda at all: a laptop with AWS
credentials can drive the deployed workers.

```bash
cd backend
.venv/Scripts/python -m pip install -e ".[dev,aws]"
# then in backend/.env:
EVENT_BUS_NAME=kanji-workshop
```

Unset, it is a no-op, which is the default and the right one for most local work.

## Making the API public

The function URL is private (IAM auth) until you choose otherwise:

```bash
terraform apply -var api_public=true
terraform output api_url    # → EXPO_PUBLIC_API_URL in mobile/.env
```

Public is safe to the extent the key is: every route, `/health` included,
demands `Authorization: Bearer <API_KEY>`, compared in constant time, and the
`/docs` pages are not served outside `ENVIRONMENT=local`. The phone keeps the
key in its secure storage, entered once on the My profile screen (the crabigator avatar on the dashboard);
it is never part of the app bundle.

**One thing still breaks on Lambda: photo import.** Extraction drafts live in
process memory (`_CACHE` in `app/services/ocr.py`), and the client's polls can
land in a different container from the upload that produced them — the import
then looks stuck. Everything else works. Moving the drafts into Postgres fixes
it; until then, import photos against the local API.
