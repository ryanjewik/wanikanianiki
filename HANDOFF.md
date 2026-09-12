# Kanji Workshop — state of the build

Written 2026-09-09, replacing the 2026-08-31 snapshot. Written for picking the
work up in a fresh session.

Two independent projects in one tree — `backend/` (FastAPI, owns the WaniKani
token) and `mobile/` (Expo / React Native). They share nothing at runtime; see
`CLAUDE.md` and `mobile/AGENTS.md` before touching either.

---

## Where things actually stand

The backend is still ahead of the app, but the gap has narrowed a lot. Vocab
sets, the quiz, grammar, and timezone-correct streaks all landed since the last
snapshot, and each of them closed an item this document previously listed as
unbuilt.

**The wiring backlog is gone.** For most of this project's life the recurring
shape was a finished backend path with no screen on the end of it — vocab sets,
the level browser, the session summary, `/api/activity`. All four are now
consumed. Every endpoint the client declares has a caller, with one exception
noted below.

**Lesson bundles are built and have generated real questions.** Part 2's
centrepiece spans four tables, a scheduled top-up, two routes and a screen, and
three bundles are sitting in the queue right now.

What is left is smaller than it has been at any point in this document's life.
The local deck mirror (gap 1) is half-built and blocks starting an imported-vocab
session offline; the rest is polish and one deployment step.

**Verified on 2026-09-10:** app runs on the Android Studio emulator against a
local backend, `114 passed, 58 skipped`, ruff clean, `npm run typecheck` clean,
and `npm run check:grading` agrees across 1412 checks.

**Generation has now run for real** (2026-09-11): 28 drafted, 4 rejected, 3
bundles of 8 created, in about 90 seconds. All four rejections were the failure
the verifier exists for — an answer that is not uniquely determined. Question
quality on the first pass was good enough to ship without prompt tuning.

---

## Backend — done

### Database

Postgres on Supabase, SQLAlchemy 2.x async + asyncpg, Alembic for schema.

**Eight migrations**, head is `3413a054bc88`:

```
2da9b14da58f  initial schema
3ff132e7ce86  vocab_sources.image_uri is nullable
dff614418157  vocab_items.usage_context
94753d45601c  vocab sets, answers and SRS state
d44cf9719b8e  grammar entries and examples
b71c4f9d20ae  users.timezone
a1c7e33b90f4  widen grammar_entries.style
3413a054bc88  questions and lesson bundles
```

Two conventions worth not re-litigating:

- **Every foreign key is explicitly named.** An unnamed one compiles fine on
  upgrade and then breaks `alembic downgrade base` with `Can't emit DROP
  CONSTRAINT ... it has no name`.
- **`server_default` accompanies a Python `default` only where "unset" has an
  unambiguous correct value** — bools, counters, status, empty JSONB. Not on
  `users.level`, `max_level_granted`, or any `type` column, where a default
  would invent data.

### WaniKani

`app/wanikani/client.py` — token-bucket rate limiter (60 req/min is **per
token**, held at 55), `updated_after` cursors, `RateLimit-Reset` handling as an
absolute timestamp. `app/wanikani/mapping.py` converts API payloads to models.

`app/services/sync.py` — incremental sync and one-time backfill, capped at the
account's `max_level_granted`. Subjects are written before the assignments that
reference them, which is not cosmetic ordering — the reverse violates the FK.

### Photo import (OCR)

`app/services/ocr.py` — Anthropic vision extraction. The prompt names the three
page layouts in `vocab_samples/` and instructs the model to skip show-through
from the reverse side, margin bleed from the facing page, audio markers, the 行
column, and ◆◇ markers. Rows with no printed meaning are dropped at extraction,
and a word listed twice on one page collapses to a single row.

**Measured against the user's real textbook pages**, not synthetic ones:
28/28 rows in 18.9s, 44/44 in 21.8s, 28 rows in 16.6s. The 120s
`VISION_TIMEOUT_SECONDS` is set from that measurement — roughly 5.5× headroom,
not a guess.

### SRS

`app/services/srs.py` — SM-2, pure functions, no I/O. 1 day → 6 days → ×ease,
ease floor 1.3, lapse handling. Also `normalise()` / `matches()`, which fold
away the punctuation textbooks print but nobody types — `決心（する）` is
answered `決心`, `[〜が]苦手な` is answered `苦手な` — plus NFKC width folding
and English article folding.

Each imported word gets **two** `SrsState` rows, recognition and production,
scheduled independently. A word you can recognise is not a word you can write.

### Grammar

New since the last snapshot, and a full vertical: `app/services/grammar.py`,
two migrations, CRUD plus an enrichment pass that expands a logged pattern into
something studiable. A verbose register in the model's reply no longer fails
the whole enrichment. Covered by `tests/test_grammar_routes.py` (469 lines).

### Days and timezones

`app/services/dates.py`. Study days bucket in **the user's zone, not UTC** — an
evening in California is still that day locally, a morning in Tokyo is already
tomorrow. `users.timezone` persists it and the client sends `tz` per request.

**`tzdata` is a hard dependency, not a nicety.** `zoneinfo` reads the *system*
tz database, which Windows does not have and slim containers strip. Without it
every zone lookup raises, including the `ZoneInfo("UTC")` fallback inside
`dates.py` itself. A venv created before this dependency landed fails 8 tests
in `test_dates.py`; the fix is `pip install -e ".[dev]"`.

### Generated lessons

`app/services/lessons.py`, four tables, one scheduled handler and two routes.

**Two prompts, not an agent framework.** There is no LangChain, no LangGraph and
no MCP — the whole surface is `client.messages.parse(output_format=...)` plus
the SDK's own `tool_runner`. That was a deliberate call: the graph is
generate → gate → verify → store, and a framework would add a dependency tree to
a Lambda artifact for a loop worth fifteen lines. The SDK covers tools, the
loop, and MCP natively if any of that is ever wanted.

**The generator writes, the verifier vetoes, and the verifier cannot edit.** A
verifier that repairs a question is a second generator, and it talks itself into
the draft it just read. Its only output is a verdict.

**The verifier runs on `verifier_model` (Sonnet 5), the generator on
`lesson_model` (Opus 5).** Writing a good question is judgement; checking one
against retrieved rows is not. Verification is also the call that scales — once
per question, where generation is once per bundle.

**Nothing unverified is servable.** `questions.verified` starts false, only
`mark_question_verified` sets it, and the answer route returns 409 for a
question that never passed. A wrong answer key is worse than a missing question:
the SRS rehearses the mistake until the learner believes it.

**An unreachable verifier rejects.** Defaulting to "serve it" when the network
wobbles would delete the only safeguard the module has. There is a test on it.

Three layers of checking, and the split is deliberate:

| Concern | Checked by | Why there |
|---|---|---|
| Invented vocab id, answer not among its own choices, missing `___`, tiles that do not rebuild the answer | `_structurally_sound`, in Python | Arithmetic and string equality. Free, and runs *before* any verifier call |
| Is this one question answerable, is exactly one answer right | Sonnet 5, with `look_up_word` on multiple choice | Genuine judgement |
| One word drilled repeatedly across a batch | `prune_for_variety`, in Python | The verifier sees one question at a time and structurally cannot detect this. It is also countable, so a model would only add cost |
| Question-type monotony | Fed back as text on the retry pass | A judgement call about the material — some word sets genuinely do not support sentence construction |

`look_up_word` reads the learner's own deck, and exists for one failure: a
distractor that is *also* an accepted answer for the word being tested. A
verifier working from parametric memory has to guess whether "permission" is
acceptable for 免許; one that can read `vocab_answers` does not. It runs on
multiple choice only — no other type has choices to be wrong about, and the tool
loop is several round trips.

**The pools are three queries times two origins.** A WaniKani word's due-ness is
`study_progress.available_at`; an imported word's is `srs_state.due_at`. Building
a pool on `srs_state` alone silently yields imported vocabulary only — which for
a WaniKani-only account is every pool empty but "new", the exact imbalance the
three pools exist to prevent. Both halves are merged interleaved, not
concatenated, so a heavy sync cannot crowd out everything photographed.

**`project_wanikani_vocabulary` exists because sync stops short.** Sync fills
`subjects` and `study_progress`; `vocab_items` — the table every question points
at — stays empty until this runs. Vocabulary only: a radical is not a word, and a
kanji alone is WaniKani's unit of study.

### The two study tracks, and the rule that keeps them apart

**A generated question never moves a WaniKani word's schedule.** This is the
rule most likely to be broken by a later change that looks reasonable on its own
("answering should always advance something"), so `tests/test_track_separation.py`
exists to make that change fail.

The design notes state two rules that collide on exactly one case:

- WaniKani items keep WaniKani's stage, **not reimplemented**.
- A flashcard and a lesson question write **the same** SRS record — one source
  of truth per word.

For an imported word there is no conflict: `create_flashcards` wrote the rows and
both paths use them. For a WaniKani word the rules pointed opposite ways, and
there was no third option that satisfied both — WaniKani's API accepts reviews
only for real assignments, so the answer cannot be forwarded either.

**Resolved as: scheduling is separate, content is shared.** `study_progress`
stays the sole authority for when WaniKani shows you a word, and nothing here
writes it. A WaniKani word may still be *asked about* — that is practice — and
`schedulable_states` returns no rows for it, with a flag saying so. The answer
route reports that as `practiceOnlyWords` rather than passing off a no-op as
progress.

`schedulable_states` also creates nothing. A word with no SRS rows was never
confirmed into the deck, and inventing a schedule would put a word into rotation
the user never accepted.

### Running one pass

The cron checks first and usually stops: at or above `lesson_bundle_low_water`
(5) it costs one `COUNT` and no model calls. Below it, `lesson_bundles_per_run`
(3) bundles of `lesson_questions_per_bundle` (8). Schedule it twice a day with
**reserved concurrency 1** — see `backend/README.md`, and note the reason
differs from the sync worker's: the check and the write are not one transaction,
so two overlapping runs both see "below the mark" and both generate.

```bash
.venv/Scripts/python scripts/seed_lesson_samples.py   # project vocab, add sample grammar
.venv/Scripts/python -c "from app.lambda_handler import lessons_handler; print(lessons_handler({}, None))"
```

`seed_lesson_samples.py --remove` takes the sample grammar back out. Projected
vocabulary is left alone — those are real words the account started.

### Deployment shape

AWS Lambda behind a **Function URL** (not API Gateway), one artifact with many
handlers, Mangum adapter. Terraform later — deliberately no SAM template.

`app/db/session.py` picks pooling and prepared-statement settings from the
runtime and the URL *separately*, which is the correct split: pool class
depends on where the process runs, prepared-statement safety depends on whether
a transaction-mode pooler is in front of it. Statement caching is disabled per
URL rather than per runtime, so uvicorn-on-a-laptop pointed at Supabase's 6543
pooler is handled the same way Lambda is.

### Tests

`114 passed, 58 skipped` (`cd backend && .venv\Scripts\python -m pytest`).

**The 58 skips are not dead tests** — they are DB integration tests gated on
`TEST_DATABASE_URL`, deliberately a different variable from `DATABASE_URL`
because the test drops and recreates every table and must never find a real
database by accident. Four of them are `test_track_separation.py`, which exists
to make a future "answering should always advance something" change fail
loudly. **They have never been run** — set the variable and run them.

---

## Mobile — done

Expo Router, file-based. `mobile/AGENTS.md` insists on reading the versioned
Expo 57 docs before writing code — Expo has changed.

| Screen | Data |
|---|---|
| `app/(tabs)/index.tsx` — dashboard | real (`useDashboard`, `useActivityStrip`) |
| `app/(tabs)/study.tsx` — study hub | real, both tracks |
| `app/(tabs)/import.tsx` — photo import | real upload/poll/confirm |
| `app/(tabs)/items.tsx` — level browser | real (`useLevelItems`) |
| `app/sets/index.tsx` — set browser | real |
| `app/sets/[id].tsx` — one set, notecards | real |
| `app/quiz/index.tsx` — imported-vocab quiz | real |
| `app/grammar/index.tsx` — grammar list | real |
| `app/grammar/[id].tsx` — grammar detail | real |
| `app/review/index.tsx` — WaniKani review | real |
| `app/lesson/index.tsx` — WaniKani lesson | real |
| `app/item/[id].tsx` — item detail | real, fixture fallback |
| `app/lesson-bundle.tsx` — generated lesson | real (`useLessonBundle`) |
| `app/session-summary.tsx` | real (`useSessionSummary`) |

Notecards mode is **not** a route — it lives inside `app/sets/[id].tsx`, which
browses a set as cards, photographs pages into it, and confirms extracted rows
without leaving the set.

Offline model: writes go to a SQLite outbox (`pending_writes`) and a sync pass
drains it oldest-first, stopping at the first failure so ordering is never
broken. The drain switches exhaustively on write type — an unrecognised type
throws rather than falling through into whichever branch happens to be last,
which would post one kind of answer to another kind of endpoint.

### The two-grader hazard — read before touching grading

`mobile/src/data/grading.ts` is a **hand port** of `backend/app/services/srs.py`.
Two graders exist because the phone must show a verdict on the keystroke and
must work offline, while the server regrades every answer and *its* verdict is
what the deck records. Two graders that disagree would flash "correct" and
quietly record a lapse.

`npm run check:grading` diffs them over textbook-shaped inputs — 1412 checks
including parenthesised qualifiers, width variants, article folding, and
multi-answer production cards. It has been verified to *fail* on injected
drift, so it is not a vacuous check.

**Change one grader, run that script, change the other.**

---

## Closed since the last snapshot

Recorded so nobody re-opens them from a stale reading:

- **Vocab sets** — was "the largest finished-but-invisible feature". Now built
  on both sides: `app/sets/index.tsx` names and lists them, `app/sets/[id].tsx`
  browses one and imports pages into it.
- **Notecards mode** — was routing to `/import`. Now inside `sets/[id].tsx`.
- **Streak union** — `routes.py:159` unions `get_review_days` with
  `get_vocab_review_days` over one shared zone, so a day spent only on imported
  vocabulary now counts.
- **The quiz screen** — `app/quiz/index.tsx`, real data, ends inline with real
  counts.
- **Grammar** — did not exist at all in the last snapshot.
- **The level browser** (2026-09-09) — `items.tsx` rendered `LEVEL_12_ITEMS`
  directly. Now `useLevelItems(level)` fetches the level's full roster from
  `/api/subjects?level=`, joins it to cached assignments, and derives each
  tile's state. Fixtures remain only as the no-backend fallback.
- **The session summary** (2026-09-09) — reported invented stage movements.
  `src/data/session.ts` now carries what happened from the review and lesson
  screens to the summary, and `useSessionSummary` syncs, then diffs each item's
  recorded `startingStage` against the stage WaniKani returned.
  **Typechecked but not yet exercised on a device** — walk one review and one
  lesson through to the summary before trusting it.
- **A real SRS bug in the review screen** (2026-09-09) — the submitted review
  reported `current.strikes`, the strike count of whichever half was answered
  *last*. Miss the meaning twice, get the reading right last, and the meaning
  misses never reached WaniKani, which then derived the wrong SRS stage. Both
  halves are now tallied per subject and reported together. `QueueEntry.strikes`
  is gone — it had become write-only and shadowed the new tally's name.
- **Lesson bundles** (2026-09-10) — Part 2's centrepiece, unbuilt on both sides
  in every previous version of this document. Four tables, a generator and a
  verifier, a scheduled top-up, two routes and a screen. `fetchLessonBundle` no
  longer points at a route that does not exist. **Never run — see gap 2.**
- **The WaniKani / generated-lesson track split** (2026-09-10) — the design
  notes' two SRS rules collide on WaniKani-sourced words, and nothing had ever
  written state to expose it. Resolved as scheduling separate, content shared;
  see the section above and `tests/test_track_separation.py`.
- **The activity strip** (2026-09-09) — `/api/activity` had no consumer. The
  dashboard's streak strip now runs on it: a fortnight instead of a week, with
  a third state for a day that logged grammar and answered nothing. That day is
  drawn hollow and deliberately does not extend the streak. Falls back to the
  dashboard payload's own seven days when the endpoint cannot be reached.
  **The filled and hollow states are unverified against live data** — the
  endpoint currently returns zero days, because nothing has been answered in
  this database yet.

---

## Not built yet

Ordered by what unblocks the most relative to effort.

### 1. Local mirror for the imported deck is half-built

`src/data/db.ts` now declares `vocab_items`, `vocab_sources` and `srs_state`,
but exports **no read or write helpers for any of them** — every exported
helper still serves the WaniKani side (subjects, assignments, queues).

So the schema is there and nothing fills or reads it. A quiz already underway
finishes offline (each card carries its accepted answers, and the outbox queues
what you type), but a session still cannot be **started** without the server.
Finishing this is: cache on fetch, read on cache-hit, mirror the WaniKani path.

### 2. One generation pass has run; the answer path has not

The first live run (2026-09-11) produced **28 drafts, 4 rejected, 3 bundles** —
13 multiple choice, 7 sentence construction, 5 fill-in-blank, 3 recall, with 8
built around a confirmed grammar point. Roughly 90 seconds and ~30 model calls.

**The rejection rate is 14%, and every rejection was on-target.** Three recall
questions whose answer was not unique ("to start working" also admits 就業する,
働き出す, 仕事を始める) and one multiple choice where a distractor was a real
alternative reading (いりくち for 入り口). That last one is precisely what
`look_up_word` was added for. No prompt tuning is indicated.

What is still unexercised:

- **Answering a generated question.** `POST .../questions/{id}/answer` has never
  run against a real question, so the SRS write path and `practiceOnlyWords`
  are untested outside unit tests.
- **The retry pass.** Rejections did occur, so the feedback loop should have
  fired — but nothing recorded whether the replacement drafts were better. Its
  one-pass cap remains a theory.
- **Cross-run behaviour.** Only one run has happened, so nothing is known about
  duplicate questions across runs.

### 3. The cron is not deployed

`lessons_handler` exists and runs by hand; no EventBridge rule fires it. The
exact commands are in `backend/README.md`, including the **reserved concurrency
1** setting, which is not optional — the low-water check and the write are not
one transaction, so two overlapping runs both generate.

There is deliberately no Terraform or SAM in this repo yet, so this stays a
documented procedure rather than code until IaC lands.

### 4. Smaller, in the lesson system

- **No cross-run dedupe.** Two runs can produce near-identical questions;
  nothing compares a draft against questions already stored.
- **Rejected questions accumulate.** Kept on purpose — a run of similar
  `verifier_note` values is the only signal a prompt has drifted — but nothing
  ever prunes them.
- **Verified-but-unbundled questions accumulate too.** A bundle needs two
  survivors; a pass that yields one leaves it in the table, and no later run
  picks it up.
- **`practiceOnlyWords` is returned but not surfaced.** The lesson screen does
  not yet tell the user that a WaniKani word was practice rather than progress.

### 5. Smaller, still real

- **End-of-session sync trigger** — sync is manual (app open, pull to refresh).
- **CORS** is wide open under `ENVIRONMENT=local`. Not a factor for React
  Native, which is not browser-sandboxed, but it is for `expo start --web`.
- **Local-dev through the pooler** is handled, but only the URL-detection logic
  is unit-tested; nothing exercises a live pooler.

---

## Running it

**Backend**

```
cd backend
.venv\Scripts\python -m uvicorn app.main:app --reload
```

`backend/.env` holds `wanikani_apikey`, `DATABASE_URL` (the 6543 pooler),
`DATABASE_MIGRATION_URL` (the direct endpoint — DDL through a transaction
pooler is unreliable), `ANTHROPIC_API_KEY`, and `ANTHROPIC_WORKSPACE_ID`.

The workspace id is only needed for an identity-linked Anthropic key; such a
key can act in several workspaces, so the API refuses to guess and returns a
400 naming the header.

**Mobile**

```
cd mobile
npx expo start --clear
```

`--clear` matters: `EXPO_PUBLIC_*` is inlined at bundle time, so an env change
is not picked up by a hot reload.

`EXPO_PUBLIC_API_URL` is the **only** environment variable the app reads —
everything else, including anything Supabase, reaches it through the backend.
A one-line `mobile/.env` is a complete one.

| Target | Address |
|---|---|
| Android emulator (Android Studio) | `http://10.0.2.2:8000` — alias for the host's loopback, so uvicorn on 127.0.0.1 is reachable as-is |
| Android emulator (Genymotion) | `http://10.0.3.2:8000` |
| iOS simulator | `http://localhost:8000` — shares the host's network |
| Physical device, same Wi-Fi | `http://<LAN-ip>:8000`, and start uvicorn with `--host 0.0.0.0` |

**Failure mode:** a wrong URL leaves `isBackendConfigured` true (the string is
non-empty), so requests fail rather than falling back to fixtures. The tell is
the WaniKani sections rendering from fixtures while the imported-vocab section
says "Can't reach your deck".

### Android Studio emulator specifically

The app runs as a **dev build**, not through Expo Go — `mobile/android/` is a
gitignored prebuild and `com.anonymous.wanikanianiki` installs directly.

A JS-only change needs **no gradle rebuild**: start Metro and press `a`. Only a
new or upgraded native module, or a change to `app.json`'s `plugins` / `android`
block, requires `npx expo run:android`.

**Checks**

```
cd backend && .venv\Scripts\python -m pytest
cd mobile   && npm run typecheck && npm run check:grading
```

`npm run typecheck` reports phantom errors on routes added since
`.expo/types/router.d.ts` was last generated — `typedRoutes` is on, and that
file regenerates when the dev server starts. Run `npx expo start --clear` once
before believing a route-typing error.

**That generator has been seen emitting a corrupt file** — a bogus
`/../src/data/session` route, and a directory route left as
`/lesson-bundle/index` instead of collapsing to `/lesson-bundle`. It regenerated
corrupt more than once. `--clear` produces a correct file, and flattening the
screen to `app/lesson-bundle.tsx` (a plain file, like `session-summary.tsx`)
made it stable across repeated typechecks. If a route type looks impossible,
check that file before changing a call site.

---

## Environment notes for an agent session

The sandboxed container's egress proxy blocks `api.wanikani.com` and every
Supabase Postgres host (6543 and 5432, pooler and direct). `api.anthropic.com`
is reachable. So migrations, backfill, and any live-database work have to be
run by the user on their machine — do not assume a failed connection from
inside the container means something is broken.

There is no test runner in `mobile/`; `npm run typecheck` and
`npm run check:grading` are the available checks.

`mobile/.gitignore` is generated by expo-cli and reappears as an untracked file
whenever the dev server runs. It is not stray work.

---

## Outstanding security item

`SUPABASE_SECRET_KEY` and the database password were both pasted into a chat
transcript and **still need rotating** — carried forward from the last
snapshot and not verified as done. `.mcp.json` is committed and contains the
project ref.
