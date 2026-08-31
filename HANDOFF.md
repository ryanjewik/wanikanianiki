# Kanji Workshop — state of the build

Written 2026-08-31. Snapshot for picking the work up in a fresh session.

Two independent projects in one tree — `backend/` (FastAPI, owns the WaniKani
token) and `mobile/` (Expo / React Native). They share nothing at runtime; see
`CLAUDE.md` and `mobile/AGENTS.md` before touching either.

---

## Where things actually stand

The backend is ahead of the app. Every read and write path the app needs
exists and is tested; the gap is that several endpoints have no screen calling
them yet. That asymmetry is the main thing to know.

**Live against the real Supabase project as of this writing:** the schema is
migrated, 362 WaniKani subjects (levels 1–3) and 134 assignments are in the
database, and the app is pointed at a local backend from an Android emulator.

---

## Backend — done

### Database

Postgres on Supabase, SQLAlchemy 2.x async + asyncpg, Alembic for schema.

Four migrations, applied to Supabase and verified end-to-end against a local
Postgres 16 (`upgrade head` → 12 tables → `alembic check` reports no drift):

```
2da9b14da58f  initial schema
3ff132e7ce86  vocab_sources.image_uri is nullable
dff614418157  vocab_items.usage_context
94753d45601c  vocab sets, answers and SRS state
```

12 tables: `Subject`, `User`, `StudyProgress`, `ReviewLog`, `SyncMeta`,
`VocabSource`, `VocabItem`, `VocabSet`, `VocabSetItem`, `VocabAnswer`,
`SrsState`, `VocabReviewLog`.

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
account's `max_level_granted`.

### Photo import (OCR)

`app/services/ocr.py` — Anthropic vision extraction. The prompt names the three
page layouts in `vocab_samples/` and instructs the model to skip show-through
from the reverse side, margin bleed from the facing page, audio markers, the 行
column, and ◆◇ markers. Rows with no printed meaning are dropped at extraction.

**Measured against the user's real textbook pages**, not synthetic ones:
28/28 rows in 18.9s, 44/44 in 21.8s, 28 rows in 16.6s. Zero show-through
leakage on the page with a legible reverse side. The 120s `VISION_TIMEOUT_SECONDS`
is set from that measurement — roughly 5.5× headroom, not a guess.

### SRS

`app/services/srs.py` — SM-2, pure functions, no I/O. 1 day → 6 days → ×ease,
ease floor 1.3, lapse handling. Also `normalise()` / `matches()`, which fold
away the punctuation textbooks print but nobody types — `決心（する）` is
answered `決心`, `[〜が]苦手な` is answered `苦手な` — plus NFKC width folding
and English article folding.

Each imported word gets **two** `SrsState` rows, recognition and production,
scheduled independently. A word you can recognise is not a word you can write.

### Deployment shape

AWS Lambda behind a **Function URL** (not API Gateway), one artifact with many
handlers, Mangum adapter. Terraform later — deliberately no SAM template.

`app/db/session.py` picks its pooling and prepared-statement settings from the
runtime and the URL *separately*, which is the correct split: pool class
depends on where the process runs, prepared-statement safety depends on whether
a transaction-mode pooler is in front of it. Both Lambda and uvicorn-on-a-laptop
pointed at Supabase's 6543 pooler need caching disabled.

### Tests

`84 passed, 28 skipped` (`cd backend && .venv/Scripts/python -m pytest`).

**The 28 skips are not dead tests** — they are DB integration tests gated on
`TEST_DATABASE_URL`. Now that a real database exists, set that variable and run
them; they cover `create_flashcards`, dedupe, due-card selection, and review
recording.

---

## Mobile — done

Expo Router, file-based. `mobile/AGENTS.md` insists on reading the versioned
Expo 57 docs before writing code — Expo has changed.

| Screen | Data |
|---|---|
| `app/(tabs)/index.tsx` — dashboard | real (`useDashboard`) |
| `app/(tabs)/study.tsx` — study hub | real, both tracks |
| `app/(tabs)/import.tsx` — photo import | real upload/poll/confirm, fixture fallback |
| `app/(tabs)/items.tsx` — level browser | **fixtures** (`LEVEL_12_ITEMS`) |
| `app/review/index.tsx` — WaniKani review | real |
| `app/lesson/index.tsx` — WaniKani lesson | real |
| `app/quiz/index.tsx` — imported-vocab quiz | real |
| `app/item/[id].tsx` — item detail | real, fixture fallback |
| `app/session-summary.tsx` | **fixtures** (`SESSION_SUMMARY`) |

Offline model: writes go to a SQLite outbox (`pending_writes`) and a sync pass
drains it oldest-first, stopping at the first failure so ordering is never
broken. Online and offline take the same code path.

### The two-grader hazard — read before touching grading

`mobile/src/data/grading.ts` is a **hand port** of `backend/app/services/srs.py`.
Two graders exist because the phone must show a verdict on the keystroke and
must work offline, while the server regrades every answer and *its* verdict is
what the deck records. Two graders that disagree would flash "correct" and
quietly record a lapse.

`npm run check:grading` diffs them over textbook-shaped inputs — 1412 checks
including parenthesised qualifiers, width variants (`ﾒﾝｷｮ` vs `めんきょ`),
article folding, and multi-answer production cards. It has been verified to
*fail* on injected drift, so it is not a vacuous check.

**Change one grader, run that script, change the other.**

---

## Not built yet

Ordered roughly by what unblocks the most.

### 1. Endpoints with no screen

The API client has these; nothing calls them:

- `createVocabSet` / `listVocabSets` — **0 consumers.** The schema and
  endpoints for naming a set and importing several photos into it sequentially
  are done. There is no UI to name a set or browse one, so multi-page import
  is unreachable from the app. This is the largest finished-but-invisible
  feature.
- `fetchLevelSubjects` — 0 consumers; `items.tsx` still renders fixtures.
- `fetchLessonBundle` — 0 consumers, **and no backend endpoint.**
  `/api/lesson-bundles/next` does not exist in `routes.py`. The AI-generated
  lesson bundles are unbuilt on both sides; the client function is a stub.

### 2. `/session-summary` is fixture-backed

It reports invented WaniKani stage movements. This affects the real WaniKani
review flow today, not just the quiz. The quiz screen deliberately does *not*
route there — it ends inline with real counts — but review and lesson do.

### 3. No local mirror for the imported deck

The WaniKani queues mirror into SQLite; the imported deck does not. A quiz
session already underway finishes offline fine (each card carries its accepted
answers, and the outbox queues what you type), but a session cannot be
**started** without the server.

### 4. Streak union

`get_vocab_review_days()` exists in the repository layer. The dashboard never
calls it, so a day where you only studied imported vocabulary does not count
toward the streak.

### 5. Smaller, still real

- **Notecards mode** — the study hub's "Notecards" button routes to `/import`.
  Browse-a-deck does not exist.
- **End-of-session sync trigger** — sync is manual (app open, pull to refresh).
- **CORS** is wide open under `ENVIRONMENT=local`. Tighten before any public
  exposure. Not a factor for React Native, which is not browser-sandboxed, but
  it is for `expo start --web`.
- **Local-dev through the pooler** is handled now, but nothing tests it against
  a live pooler — only the URL-detection logic is unit-tested.

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

Its value depends on the target, because an emulator has its own network stack
and `localhost` means the emulator itself:

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

**Checks**

```
cd backend && .venv\Scripts\python -m pytest
cd mobile   && npm run typecheck && npm run check:grading
```

---

## Environment notes for an agent session

The sandboxed container's egress proxy blocks `api.wanikani.com` and every
Supabase Postgres host (6543 and 5432, pooler and direct). `api.anthropic.com`
is reachable. So migrations, backfill, and any live-database work have to be
run by the user on their machine — do not assume a failed connection from
inside the container means something is broken.

There is no test runner in `mobile/`; `npm run typecheck` and
`npm run check:grading` are the available checks.

---

## Outstanding security item

`SUPABASE_SECRET_KEY` and the database password were both pasted into a chat
transcript and **still need rotating**. `.mcp.json` is committed and contains
the project ref.
