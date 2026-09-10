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

What is left is real feature work, not plumbing. **Lesson bundles** (gap 2) are
Part 2's whole point — AI-generated, verifier-checked practice questions,
unbuilt on both sides, with the design already written down and worth reading
before anything is designed fresh. The local deck mirror (gap 1) is half-built
and blocks starting an imported-vocab session offline.

**Verified working on 2026-09-09:** app runs on the Android Studio emulator
against a local backend, `95 passed, 54 skipped` on the backend suite, and
`npm run check:grading` agrees across 1412 checks.

---

## Backend — done

### Database

Postgres on Supabase, SQLAlchemy 2.x async + asyncpg, Alembic for schema.

**Seven migrations**, head is `a1c7e33b90f4`:

```
2da9b14da58f  initial schema
3ff132e7ce86  vocab_sources.image_uri is nullable
dff614418157  vocab_items.usage_context
94753d45601c  vocab sets, answers and SRS state
d44cf9719b8e  grammar entries and examples
b71c4f9d20ae  users.timezone
a1c7e33b90f4  widen grammar_entries.style
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

`95 passed, 54 skipped` (`cd backend && .venv\Scripts\python -m pytest`).

**The 54 skips are not dead tests** — they are DB integration tests gated on
`TEST_DATABASE_URL`, deliberately a different variable from `DATABASE_URL`
because the test drops and recreates every table and must never find a real
database by accident.

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

### 2. Lesson bundles — the one genuinely large feature left

`fetchLessonBundle()` calls `/api/lesson-bundles/next`. **That route does not
exist** — confirmed absent from `routes.py`, along with the `questions` and
`lesson_bundles` tables. This is not a wiring job; it is Part 2's
centrepiece, unbuilt on both sides.

**The full design is already written** — `backend/docs/wanikani-api-notes.md`,
"Part 2: vocab capture & AI-generated lessons". Read it before designing
anything; what follows is the shape, not a replacement for it.

**What a lesson bundle is.** Not a flashcard. Flashcards are
`vocab_items` + `srs_state` queried directly, no `questions` table involved.
Lessons are *generated structured practice* — multiple choice, fill-in-blank,
sentence construction, recall — built from the vocab, grammar and kanji the
user has actually been learning. The four types are already in
`QuestionType` (`mobile/src/data/types.ts:281`), and `Question` / `LessonBundle`
are typed on the client with no backend behind them.

**Two agents, and the split is a safety property.** A generation agent writes
question drafts; a **verifier sub-agent** must flip `verified = true` before a
question is servable. *Never serve an unverified question.* That comment is
already in the type definition — `verified` exists on `Question` today. The
orchestration service is intended as distinct from the core API: it is doing
LLM calls, not CRUD.

**It reads a narrow feed, never the raw tables.** The generator gets
`GET /api/agent-context/newly-learned` — `study_progress` filtered to items
passed in the last N days, joined to vocab. Not years of burned items. The same
call folds in recent grammar entries.

**The mix is three pools, deliberately weighted.** A bundle draws from
*review* (items due per `srs_state` / `study_progress` — the bulk of a healthy
session), *new* (just-learned WaniKani items and recent grammar — a seasoning,
not the body), and *continuing* (started but not mastered). Newly learned
content seasons the batch; it must not dominate it.

**How it meets the SRS — the part worth getting right.** Answering a word via a
generated question and answering it via a flashcard write **the same** SRS
record. One source of truth for "how well do I know this word", regardless of
which mode taught it. That is why `questions.vocab_item_ids` points at
`vocab_items` rather than at `subjects`.

But the two SRS systems stay separate, and a generated question inherits that
split: a WaniKani-sourced item's due date always comes from **WaniKani's own
stage** (mirrored, never reimplemented); everything else runs the local
**SM-2** in `srs_state`, with recognition and production scheduled apart. A
generated question targeting a WaniKani item must not write SM-2 state for it.

**The two tracks are never blended into one queue.** WaniKani lessons and
AI-generated lessons are presented and reviewed independently. This is a
product decision, not an implementation detail — do not merge the queues.

**Bundles are the offline unit.** Generate 3–5 at a time and mirror them the
way `local_assignments` is mirrored — not individual questions. This is the
same gap as item 1 and should probably be solved once, for both.

**Superseded — do not build it.** The design doc's Obsidian connector is dead;
grammar lives in the app instead (`grammar_entries` / `grammar_examples`,
migration `d44cf9719b8e`). Two principles carried over and still hold: grammar
is **optional** context for generation, never required — a user with no grammar
entries still gets working vocab-only questions — and nothing generated is
served before a human confirms it. Two did not: the vault write-back and the
whole-file read.

### 3. Smaller, still real

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
file regenerates when the dev server starts. Run `npx expo start` once before
believing a route-typing error.

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
