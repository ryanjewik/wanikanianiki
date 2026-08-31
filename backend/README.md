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
| `POST /api/vocab-sources` | **Write.** Upload a page photo. Returns `202` immediately. |
| `GET /api/vocab-sources/{id}` | Poll until `status` leaves `pending`. |
| `POST /api/vocab-sources/{id}/confirm` | **Write.** Commit the reviewed rows. |
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

"Once per process" has to mean the module, not the app. Mangum builds its
`LifespanCycle` inside `__call__`, so a FastAPI lifespan runs startup *and
shutdown* on every Lambda invocation rather than once per container. The client
therefore hangs off `get_client()`, an `lru_cache` in `app/wanikani/client.py`,
and the lifespan skips teardown when `is_lambda` so a frozen container keeps its
connections. `tests/test_lambda_handler.py` asserts the instance survives two
invocations; both of those tests fail if the carve-out is removed.

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

## Photo import

Upload a textbook page, get vocabulary rows. Three routes and one rule: the
upload never waits for the extraction.

```
POST /api/vocab-sources        -> 202 {sourceId, status: "pending"}
GET  /api/vocab-sources/{id}   -> poll until "processed" or "failed"
POST /api/vocab-sources/{id}/confirm  -> the rows the user kept
```

Reading a page is a vision-model call taking tens of seconds. That is well
inside what a Lambda Function URL allows — fifteen minutes — so this is not a
platform limit. It is that a phone should not be asked to hold a connection
that long: mobile data drops it on a network switch, both mobile OSes suspend a
backgrounded app mid-request, and a synchronous wait bills a Lambda for a minute
of doing nothing. So `vocab_sources.status` carries the state, the upload
returns as soon as the bytes land, and the client polls.

**Two timeouts, and their order matters.** `VISION_TIMEOUT_SECONDS` (120s)
bounds the extraction; the app polls for 300s. The server must give up first —
reversed, a slow extraction shows the user a failure and *then* quietly
succeeds, leaving a `processed` row nobody is watching.

**It is not OCR.** A vocab page is a table, and the useful part is keeping its
three columns apart — kanji+furigana, kana, English. Raw text extraction throws
that structure away. The page goes to `claude-opus-5` with a schema attached and
comes back as rows.

**Ambiguity is flagged, not guessed.** 辛い is からい or つらい and the page
often does not say. Those rows come back `ambiguous`, with the candidates
listed, and arrive **deselected** — a wrong reading here goes into an SRS and
gets rehearsed until it sticks, so an admitted unknown beats a confident guess.

Nothing enters `vocab_items` until the user confirms. Duplicates are matched on
the written form, not the reading, so 橋 and 箸 stay distinct.

Set `ANTHROPIC_API_KEY` to enable it; unset, uploads are refused with a `503`
rather than accepted and never processed.

## Flashcards and the SRS

Confirmed rows become studiable cards in one write: the word, the answers that
count for it, and a place in the schedule for each skill. A word with no answers
is unanswerable and a word with no SRS state never comes up, so a partial write
here is a silently broken card.

```
POST /api/vocab-sets            name a group first
POST /api/vocab-sources         ?set_id=  — pages land in it
GET  /api/vocab-sets            word and page counts, live during an import
GET  /api/flashcards/due        imported vocabulary only
POST /api/flashcards/{id}/answer
```

**`vocab_answers` is why "kanji or furigana, either counts" is true.** A
textbook line like

```
相手   あいて   partner; the other person
```

is not one answer, it is four. 相手 and あいて are both right when the card asks
for the Japanese; *either* gloss is right when it asks for the meaning. Storing
the raw line and comparing against it marks "partner" wrong for want of a
semicolon. `kind` (`written` / `reading` / `meaning`) is what lets one table
serve both directions — a production card accepts `written` and `reading`, a
recognition card accepts `meaning` — so the rule lives in the data rather than
spread through the grader.

**Two skills, two ladders.** Recognition and production are created together and
scheduled independently, because recognising 免許 is easy long before you can
produce it. Both are created up front rather than production being unlocked by
recognition — gating one on the other would be reintroducing WaniKani's staging
into a system deliberately kept apart from it.

**SM-2 lives in `services/srs.py`**, as pure functions over a state record: 1
day, 6 days, then multiplied by the card's ease. A failure resets the ladder
rather than shortening it, and is remembered as a lapse — the algorithm knows
the current interval but not that a word has been forgotten four times, and that
count is what marks one worth relearning rather than rescheduling forever.

Answer matching folds away what a person would never type: NFKC for width and
composition, printed qualifiers (`決心（する）` is answered "決心"), and a leading
article or "to". It is deliberately generous — marking "help" wrong for "to
help" teaches nothing.

**Sets** are many-to-many with words, because the same word plausibly belongs to
a textbook lesson *and* a JLPT tier, and pinning it to one would force a
duplicate row with its own divergent schedule. A set's page counts come from its
sources' own statuses rather than a progress field, so "5 pages, 2 still reading"
cannot drift.

### Checking extraction against real pages

Every test injects a fake vision client, which proves the pipeline handles the
shapes but says nothing about whether the model reads a sideways photo with
show-through. `scripts/extract_page.py` is the other half:

```bash
.venv/Scripts/python scripts/extract_page.py ../vocab_samples/*.jpg
```

It reads `.env` like everything else, writes nothing to the database, and
prints the rows an import would produce plus the wall-clock time each page
took — which is the number `VISION_TIMEOUT_SECONDS` is otherwise only guessing
at. It warns when the slowest page gets within 2× of that timeout.

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
| `app.lambda_handler.ocr_handler` | SQS | Minutes, not seconds. Blocked on durable image storage — see below. |

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

## First run against a real database

Everything below assumes `backend/.env` exists — copy `.env.example` and fill in
`wanikani_apikey` and `DATABASE_URL`. It is gitignored, so it does not travel
with a clone; a fresh checkout has to make its own.

```bash
# 1. Create the schema. Reads the URL from .env; nothing to export.
.venv/Scripts/python -m alembic upgrade head

# 2. Start the API.
.venv/Scripts/python -m uvicorn app.main:app --reload

# 3. Confirm the wiring before pulling anything.
curl localhost:8000/health
#    database: "configured", counts: all zero

# 4. One-time content pull for every level the account can see.
#    Minutes, not seconds — it is rate limited to 55 requests/minute.
curl -X POST localhost:8000/api/sync/backfill

# 5. Assignments and user state.
curl -X POST localhost:8000/api/sync

# 6. Counts are now non-zero, and the cache path is live.
curl localhost:8000/health
curl localhost:8000/api/dashboard
```

A `502` from step 5 or 6 means WaniKani rejected the token — check
`wanikani_apikey`. A `503` means `DATABASE_URL` is unset, so the app fell back
to serving reads straight from WaniKani.

Then point the app at it: set `EXPO_PUBLIC_API_URL` in `mobile/.env` to this
server's URL, and every screen switches off fixtures onto real data.

## Migrations

Alembic, on the async template. The URL is **not** in `alembic.ini` — 
`migrations/env.py` reads it from `app.config`, so a connection string is never
committed.

```bash
.venv/Scripts/python -m alembic upgrade head      # apply
.venv/Scripts/python -m alembic check             # models vs. migrations
.venv/Scripts/python -m alembic revision --autogenerate -m "what changed"
```

**Point migrations at the direct endpoint, not the pooler.** Set
`DATABASE_MIGRATION_URL` to your provider's direct connection string; DDL
through a transaction-mode pooler is unreliable. Unset, it falls back to
`DATABASE_URL`, which is what you want against a local Postgres.

**Always read an autogenerated revision before applying it.** Autogenerate
reliably misses server defaults and constraint changes — the initial revision
needed exactly that correction.

A column carries a `server_default` alongside its Python `default` when "unset"
has an unambiguous correct value: a boolean flag, a counter, the status a row
begins life in, an empty list. Columns that must come from upstream —
`users.level`, every `type` — have neither, so an insert that forgets them fails
loudly rather than inventing a plausible wrong answer.

## Tests

```bash
.venv/Scripts/python -m pytest
```

23 tests, no network. `respx` mocks the transport, so 429 handling, pagination,
and both write endpoints are covered without touching a real account.

`tests/test_repository_integration.py` additionally exercises every repository
function against a real Postgres. It **skips unless `TEST_DATABASE_URL` is
set** — deliberately a separate variable from `DATABASE_URL`, because the test
drops and recreates every table and must never be able to find a real database
by accident.

```bash
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/kanji_test \
  .venv/Scripts/python -m pytest tests/test_repository_integration.py
```

## Not built yet

- **Auth.** Single-user. `users.wanikani_token` from the design notes is
  deliberately *not* implemented — a stored token needs encryption at rest, and
  that is not worth building before there is a second account.
- **Conditional requests.** The client supports `If-None-Match` and returns 304
  through, but nothing stores ETags yet, so no caller benefits.
- **Durable image storage.** The photo is buffered in the process that received
  the upload and dropped once extracted, because nothing reads it afterwards —
  the review screen renders the device's own copy. That is enough while one
  function serves both the upload and the extraction. Separating `ocr-fn` needs
  the bytes to cross a process boundary, and SQS cannot carry them (256 KB cap),
  so `services/storage.py` grows a backend then. Supabase Storage or a `bytea`
  column both fit better than S3: one comes with the Postgres already being
  stood up, the other adds no service at all.
- **Part 2** — generated lessons and JLPT tracking. Photo import is built;
  question generation and the Obsidian connector are not.
