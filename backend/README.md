# Kanji Workshop API

FastAPI backend. It holds the WaniKani token and is the only thing that talks
to wanikani.com — the mobile and web clients call this instead.

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"    # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload
```

Interactive docs at `http://localhost:8000/docs`.

**A database is optional.** With `DATABASE_URL` unset, every read route works
by calling WaniKani directly — enough to develop the whole client against. With
it set, reads are served from Postgres and WaniKani is touched only by the sync
worker.

## Configuration

Read from the repo-root `.env` (see `.env.example`). Nothing has a default that
could leak a token.

| Variable | Required | Notes |
|---|---|---|
| `wanikani_apikey` | yes | Personal access token. Held as a `SecretStr`, so an accidental log prints `**********`. |
| `DATABASE_URL` | no | `postgresql://…`. The driver is rewritten to `postgresql+asyncpg` automatically, so a URL pasted from Neon/Supabase works unmodified. |
| `ENVIRONMENT` | no | Anything other than `local` locks CORS down to an empty allowlist. |
| `WANIKANI_REVISION` | no | Pinned to `20170710`. Bump deliberately — it is what keeps response shapes stable. |
| `WANIKANI_RATE_LIMIT_PER_MINUTE` | no | Defaults to 55, held under the documented 60. |

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Liveness, plus row counts when a database is attached. |
| `GET /api/dashboard` | Everything the home screen needs, in one payload. |
| `GET /api/assignments` | SRS state. Supports `updated_after` and the two availability filters. |
| `GET /api/subjects` | Content, by `ids` or `level`. Cache-first. |
| `PUT /api/assignments/{id}/start` | **Write.** Finish a lesson. |
| `POST /api/reviews` | **Write.** Submit one answered review. |
| `POST /api/sync` | Run a sync pass now. |
| `POST /api/sync/backfill` | One-time content pull for every level the account can see. |

Responses are camelCase and match `src/data/types.ts` in the app, so the
TypeScript side needs no mapping layer.

## What the WaniKani integration has to get right

Most of the difficulty is in `app/wanikani/client.py`, and it is not the HTTP.

**The rate limit is per token, so concurrency is worthless.** 60 requests/minute
against the account, not against a connection. Fanning out cannot go faster; it
can only manufacture 429s. Requests are serialised through a token bucket, and
the client is built **once per process** and shared — a per-request client would
hand every request its own budget and defeat the limiter entirely.

**429 carries an exact answer.** `RateLimit-Reset` is an absolute Unix
timestamp, so the client sleeps until precisely then instead of guessing at a
backoff curve.

**Only two endpoints write.** `PUT /assignments/{id}/start` and
`POST /reviews`. Everything else is safe to call as often as you like.

**Reviews report incorrect counts only.** WaniKani derives the resulting SRS
stage server-side; a client that sends a stage is doing it wrong. The response's
`resources_updated.assignment` is the authoritative post-review state and the
only real source for the next-review time — the app should replace its
optimistic guess with it.

**WaniKani no longer persists reviews** (`POST /reviews` returns `id: 0`), so
`reviews_log` here is the only durable history of what was answered and when.
The streak is derived from it, which is why the streak is empty without a
database.

**A 422 is usually a stale client, not a bug.** Starting an already-started
assignment, or reviewing something not yet due. Both surface as a `409` with a
hint rather than a generic 500.

**There are four subject types, not three.** `kana_vocabulary` (real words with
no kanji, like ラーメン) is folded into `vocabulary` on the way out, since the
design system defines only three colours. Its readings also carry no `type`
field, which would otherwise fail validation.

**`accepted_answer` is not always true.** Nanori and some kunyomi readings are
listed for reference but rejected as answers. Grading must respect it.

## Deployment — Lambda + serverless Postgres

The app is plain ASGI with no hosting-specific code in it. `uvicorn` runs it
locally, `app/lambda_handler.py` wraps it for Lambda, and the same image runs
unchanged on Fargate or App Runner. Only the pooling strategy varies, and that
is isolated in `app/db/session.py`.

Two functions off one artifact:

| Handler | Trigger | Notes |
|---|---|---|
| `app.lambda_handler.handler` | Function URL / API Gateway HTTP API | The HTTP API. |
| `app.lambda_handler.sync_handler` | EventBridge, every 15–60 min | **Reserved concurrency 1.** |

### Keep Lambda out of a VPC

This is the decision that matters. Putting Lambda in a VPC to reach RDS means
it can no longer reach the internet, and calling WaniKani then requires a NAT
gateway — roughly **$33/month standing**, before any traffic. For a personal app
that idles most of the day, that single line item costs more than everything
else combined and removes the reason to be serverless at all.

So use a Postgres that is reachable without a VPC:

- **Neon or Supabase** — publicly reachable, generous free tier. Simplest.
- **Aurora Serverless v2 + Data API** — pure AWS, HTTP-based so still no VPC,
  and it scales to zero ACU. Storage bills while paused.

Use the provider's **pooler** endpoint. Under Lambda the engine uses `NullPool`
(a frozen container's sockets may be dead by the next invocation), so a pooler
is what keeps the per-request connection cost small. Statement caching is also
disabled there, because a transaction-mode pooler can land a cached plan on a
different server-side session than prepared it.

### Why concurrency 1 on the sync worker

The rate limiter is process-local, and deliberately so: one serialised worker is
the intended deployment, so a distributed limiter would solve a problem the
architecture already prevents. Two overlapping sync runs cannot go faster than
one — they just collide on the same 60/min budget.

## Tests

```bash
.venv/Scripts/python -m pytest
```

23 tests, no network. `respx` mocks the transport, so 429 handling, pagination,
and both write endpoints are covered without touching a real account.

## Not built yet

- **Migrations.** The ORM models are complete but there is no Alembic revision
  yet; `alembic` is declared as a dependency and nothing more.
- **Auth.** Single-user. `users.wanikani_token` from the design notes is
  deliberately *not* implemented — a stored token needs encryption at rest, and
  that is not worth building before there is a second account.
- **Conditional requests.** The client supports `If-None-Match` and returns 304
  through, but nothing stores ETags yet, so no caller benefits.
- **Part 2** — OCR ingestion, generated lessons, JLPT tracking. Untouched.
