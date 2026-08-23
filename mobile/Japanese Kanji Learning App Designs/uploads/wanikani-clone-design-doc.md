#tech #LanguageStudy #Japanese #selfstudy 
# Building a WaniKani-connected app: API notes

Reference notes on how to use the WaniKani API v2 to build a personal WaniKani client with a shared backend, a web app, and an Android app — covering the progress dashboard, the lesson/review loop, sync timing, offline handling, and the Postgres schema.

## Auth & setup

- Base URL: `https://api.wanikani.com/v2`
- Every request needs:
    - `Authorization: Bearer <token>`
    - `Wanikani-Revision: 20170710` (date-versioned API revision header)
- Rate limit: historically ~60 requests/minute. Fine for this flow since most calls are small and infrequent.
- The token lives only on the backend — neither the web app nor the Android app talks to WaniKani directly. Both clients call your own API server, which is the only thing holding the token.

## Endpoint reference

|Endpoint|Method|Purpose|Read/Write|
|---|---|---|---|
|`/assignments`|GET|Per-subject SRS state (unlocked, started, srs_stage, available dates, subject_id)|Read|
|`/assignments/{id}/start`|PUT|Mark a lesson as started, moves it into the SRS|**Write**|
|`/subjects`|GET|Kanji/vocab/radical content: characters, meanings, readings, mnemonics|Read|
|`/review_statistics`|GET|Accuracy history per subject|Read|
|`/level_progressions`|GET|Timestamps of level start/pass/completion|Read|
|`/reviews`|POST|Submit a review result (correct/incorrect counts)|**Write**|
|`/summary`|GET|Precomputed "what's due now" for lessons and reviews|Read|

Only `start` and `reviews` change state on WaniKani's side. Everything else is read-only and safe to cache.

**Assignments reference subjects by ID only** — an assignment record has `subject_id` and `subject_type`, not the subject's actual content (character, meanings, readings, mnemonics). Displaying anything requires joining that `subject_id` against your own cached `subjects` table.

## Subject object shapes (`GET /subjects`)

Shared across all three types: `characters`, `meanings` (array of `{ meaning, primary, accepted_answer }`), `auxiliary_meanings` (alternate or blacklisted answers), `meaning_mnemonic`, `level`, `slug`, `created_at`, `document_url`.

**Radical** — no readings at all; not a real word, nothing to pronounce. Sometimes has no Unicode glyph, in which case `character_images` (SVG/PNG) is used instead of `characters`.

```json
{
  "characters": "一",
  "character_images": [ { "url": "...", "content_type": "image/svg+xml" } ],
  "meanings": [ { "meaning": "Ground", "primary": true } ],
  "amalgamation_subject_ids": [5, 4, 98]   // kanji this radical is used in
}
```

**Kanji** — adds `readings` (kana strings, tagged onyomi/kunyomi/nanori) and `reading_mnemonic`, plus links both down to component radicals and up to vocab that use it.

```json
{
  "characters": "一",
  "meanings": [ { "meaning": "One", "primary": true } ],
  "readings": [
    { "reading": "いち", "type": "onyomi", "primary": true },
    { "reading": "ひと", "type": "kunyomi", "primary": false }
  ],
  "reading_mnemonic": "...",
  "component_subject_ids": [1],        // radicals that make this kanji
  "amalgamation_subject_ids": [2467]    // vocab that use this kanji
}
```

**Vocabulary** — same shape as kanji, but usually one reading type (no onyomi/kunyomi split), and `component_subject_ids` points at kanji rather than radicals.

**Note on furigana:** `readings` is just kana text — WaniKani doesn't return pre-rendered furigana markup. If notecards need furigana-style display (small kana above the character), that's built client-side from `characters` + `readings`, e.g. `<ruby>一<rt>いち</rt></ruby>`.

## Notecards

A notecard for any subject is a view over data already in the schema — no new tables needed, just a front/back split:

- **Front:** `characters` (or `character_images` for radicals with no glyph) — from `subjects`.
- **Back:** `meanings` — from `subject_meanings`, plus `readings` (if any) — from `subject_readings`. `meaning_mnemonic` / `reading_mnemonic` from `mnemonics` can optionally show as a hint before flipping.

Since new radicals/kanji/vocab only ever arrive via the `subjects` sync (never generated dynamically), notecards can be generated lazily at render time straight from `local_subjects` — there's no separate "notecards" table to keep in sync, just a query joining `subjects` with `subject_meanings` and `subject_readings` on `subject_id`.

## Architecture

```
Web app (React)         Android app (React Native)
      \                        /
       \                      /
        v                    v
          Your backend (API server)
           |              |
           v              v
        Postgres      Sync worker  <---->  WaniKani API
        (cache +
         progress)
```

- Web and Android are separate builds distributed through separate channels (a URL vs. an installed APK) — there's no shared runtime routing between them. What they share is the backend.
- The backend is the only thing that calls WaniKani. Clients call your own API (e.g. `GET /api/dashboard`, `POST /api/reviews`), which reads/writes Postgres and, when needed, talks to WaniKani.
- The sync worker is a background job (cron / scheduled function / queue) that periodically pulls WaniKani state your app didn't directly cause — see polling section below.

## Flow 1 — Progress dashboard (read-only)

```
Dashboard loads
      |
      +--> GET /assignments          SRS stage per item
      |
      +--> GET /review_statistics    Accuracy history
      |
      +--> GET /level_progressions   Level timeline
      |
      v
Render dashboard (streaks, charts, level pace)
```

- All three calls are simple `GET`s. In practice these are served from Postgres, not called live against WaniKani on every dashboard load.
- WaniKani doesn't compute streaks or "days to next level" for you — derive those client-side (or in your API layer) from the raw timestamps.
- `/summary` is a lighter alternative if you just need "what's due right now" rather than full history.

## Flow 2 — Serving a lesson (write)

```
GET /assignments                     New items ready to learn
      |
      v
GET /subjects                        Fetch meanings, readings, mnemonics
      |
      v
User studies the item                In-app, no API call
      |
      v
PUT /assignments/{id}/start          Marks lesson complete, begins SRS
```

- Step 1 filters assignments for items that are unlocked but not yet started (`immediately_available_for_lessons=true`).
- Step 4 is the only write — it tells WaniKani the item has moved from "unlocked" to "in SRS" (stage 1), which is what makes it show up in reviews later. This call happens immediately when the user finishes the lesson in your app, or gets queued for later if offline (see below).

## Flow 3 — Answering a review (write)

```
GET /assignments                     Items due for review now
      |
      v
GET /subjects                        Fetch item content to display
      |
      v
User answers the review              Meaning and reading typed in-app
      |
      v
POST /reviews                        Reports correct/incorrect counts
      |
      v
  (SRS stage updates; item returns to queue later)
```

- Step 1 filters for `immediately_available_for_review=true`.
- Step 4 body example:
    
    ```json
    {  "review": {    "assignment_id": 1422,    "incorrect_meaning_answers": 1,    "incorrect_reading_answers": 0  }}
    ```
    
- WaniKani computes the new SRS stage server-side from the incorrect counts — you never send the stage yourself.
- Each submitted review creates a new review record (a log), it doesn't overwrite a single "current" review — so review history builds up naturally over time.

## When endpoints actually get called

There are two different triggers, and they shouldn't be conflated:

**1. User actions → immediate, synchronous calls.** When a lesson finishes or a review is answered inside your app, your API server calls WaniKani right then, inline with handling that request:

- Lesson finished → `PUT /assignments/{id}/start`
- Review answered → `POST /reviews`

**2. The sync worker → catches up on things your app didn't cause.** WaniKani has no webhooks, so this is poll-only. It exists for:

- New lessons unlocking (WaniKani computes this server-side on level-up)
- Level-ups and the level_progressions timeline
- Studying done on the real WaniKani app/website outside your app
- Resets or subscription changes

**Recommended cadence:**

- Poll on app open (pull-to-refresh style) rather than a fixed interval, since that's when staleness actually matters to the user.
- Layer a scheduled safety-net poll on top — every 15–60 minutes is plenty; lessons/level-ups don't happen more often than that.
- Always use `updated_after` on `/assignments` so each poll is a cheap incremental diff, not a full re-pull.

## Offline handling (Android)

Preload both subjects and assignments locally so a full lesson/review session can run with zero connectivity — the only thing that actually requires a live connection is submitting the result. This means SQLite needs to hold its own mirror of the same data Postgres holds server-side, not just a write queue.

**SQLite schema (on-device):**

```
local_subjects
  subject_id      integer PK
  type            text
  character       text
  level           integer
  meanings_json   text   -- flattened JSON, simpler than normalized tables on-device
  readings_json   text
  mnemonics_json  text

local_assignments
  subject_id      integer PK
  srs_stage       integer
  unlocked_at     text
  started_at      text
  available_at    text
  synced_at       text   -- last time this row was confirmed fresh from server

pending_writes
  id              integer PK
  type            text        -- 'start_assignment' | 'submit_review'
  payload_json    text        -- request body that would've been sent
  created_at      text
  synced_at       text        -- null until confirmed

sync_meta
  key             text PK     -- e.g. 'last_synced_at'
  value           text
```

- `local_subjects` collapses meanings/readings/mnemonics into JSON blobs rather than separate normalized tables — on-device there's no need for cross-user queries, so it's simpler to read/write as one row per subject.
- `local_assignments` mirrors `study_progress` for the current user, and is what the lesson/review queue and "backlog" are actually built from — see below.
- **Writes are queued in `pending_writes`** while offline — an "outbox". On reconnect, replay queued writes **oldest first** — order matters for reviews, since multiple reviews of the same item should land in the sequence the user actually did them.
- Mark a row synced only after WaniKani confirms the write; don't delete optimistically. Use a client-generated ID (or check WaniKani's response) to avoid double-submitting on retry.
- Known UX wrinkle: a queued-but-unsynced review means the locally-displayed "next review due" time is a guess until the real SRS-stage calc happens on sync — worth a small "pending sync" indicator in the UI.
- `pending_writes` is local-only; it has no equivalent in Postgres, which only represents server-confirmed state.

**Dashboard "last updated" timestamp.** `sync_meta['last_synced_at']` does double duty: it's the value shown in the UI ("Last synced 4 minutes ago"), and it's also what gets passed into `updated_after` on the next `/assignments` poll — so freshness display and incremental sync share one source of truth. Update it every time a poll completes successfully.

**Lesson backlog while offline.** There's no separate "backlog" concept to build — it's just whatever's sitting in `local_assignments` as unlocked-but-not-started from the last successful sync. The user can work through that queue offline indefinitely, and each completion adds a row to `pending_writes`.

The real limitation: WaniKani decides what unlocks next **server-side**, based on passed assignments and level. If the device is offline long enough to burn through the entire cached backlog, no new lessons can appear until it's back online and syncs — even if completing those lessons would have unlocked more content on the real account. Offline works great up to whatever was cached at last sync, then plateaus until reconnect. Worth surfacing this in the UI when the cached backlog is running low (e.g. "You're offline and running low on lessons — reconnect to get more").

## Postgres schema

All content and progress tables key off `subject_id` — using WaniKani's own subject ID directly as the primary key avoids a separate ID-mapping layer.

```
subjects
  subject_id      int PK        -- WaniKani's own subject id, reused directly
  type            text          -- radical | kanji | vocabulary
  character       text
  level           int

subject_meanings
  id              serial PK
  subject_id      int FK -> subjects.subject_id
  meaning         text
  is_primary      bool

subject_readings
  id              serial PK
  subject_id      int FK -> subjects.subject_id
  reading         text
  is_primary      bool

mnemonics
  id              serial PK
  subject_id      int FK -> subjects.subject_id
  type            text          -- meaning | reading
  content         text

users
  id              serial PK
  wanikani_token  text          -- encrypted at rest

study_progress
  id              serial PK
  user_id         int FK -> users.id
  subject_id      int FK -> subjects.subject_id
  srs_stage       int
  available_at    timestamp     -- when it's next due for review

reviews_log
  id                  serial PK
  study_progress_id   int FK -> study_progress.id
  incorrect_meaning   int
  incorrect_reading   int
  created_at          timestamp
```

**How the pieces connect:**

- `subjects` is the hub — content that never changes, keyed by WaniKani's own ID.
- `subject_meanings`, `subject_readings`, `mnemonics` hang off `subject_id` (one-to-many — a kanji can have multiple meanings/readings).
- `study_progress` is where `users` meets `subjects` — one row per (user, subject) pair, holding current SRS stage. This is what the dashboard and lesson/review queues query against.
- `reviews_log` hangs off `study_progress` (not `subjects` directly) via `study_progress_id`, since a review is really "this user's attempt at this assignment" — relevant if a user resets and re-studies a subject, giving them a second `study_progress` row for it.

## Practical notes

- **Cache subjects locally.** Kanji/vocab content basically never changes, so pull `/subjects` once and store it rather than refetching it every lesson/review batch.
- **Poll with `updated_after`.** Most list endpoints support this filter — use it to pull only what changed since your last sync instead of re-fetching everything.
- **Only two endpoints write:** `PUT /assignments/{id}/start` and `POST /reviews`. Everything else is safe to call as often as you like.
- **Local-only vs. live-synced:** a snapshot-import approach (pull once, study locally, never write back) is simpler but drifts from your real WaniKani account over time. A live-synced app needs the write calls above plus the offline queuing and sync-conflict handling described here.

---

# Part 2: vocab capture & AI-generated lessons

Extends the app beyond WaniKani-sourced content: importing vocab from textbook photos, and generating structured practice (multiple choice, fill-in-the-blank, sentence construction) on top of it.

## New components

- **OCR/vision ingestion microservice** — accepts a photo (upload or camera capture). Rather than classic OCR, this is a vision-capable LLM call: prompt it to return structured JSON with the three textbook columns kept separate (kanji+furigana, furigana-only, English) — layout-aware extraction, not just raw text.
- **Agent orchestration service** — hosts the question-generation agent, its verifier sub-agent, and the Obsidian connector. A distinct service from the core API server since it's doing LLM calls, not plain CRUD.

### Obsidian connector

Unlike the read-only assumption in earlier drafts, this connector is read/write and user-configured, not automatic:

- **Setup is explicit file selection**, not a whole-vault scan. During setup, the user picks:
    - a **read file** — where they keep notes on newly learned grammar and other topics they want folded into practice questions
    - a **write file** — where the agent posts a quick summary of what was studied / what needs review after a session
- **Writes are opt-out.** The user can disable the write-back independently of the read side — e.g. keep pulling grammar topics for context, but never have the app touch their vault.
- **The whole connector is opt-out.** If disabled entirely, the agent generates questions without any grammar-topic context — it falls back to vocab-only question generation (still fully functional, just without the grammar-aware angle).
- This means `grammar_topics` (see below) can simply be empty for a user who never connects Obsidian or who has reads disabled — the generation prompt should treat it as an optional context block, not a required one.
- **TTS/STT service** — thin wrapper around Google Cloud's speech APIs, used for spoken question output and voice-input answers. (Note: DeepL / Google Translate are text-translation APIs, not speech — the actual need here is speech-to-text and text-to-speech, which is a separate API pair. See "Voice & translation APIs" below.)

## Data model additions

**Vocab now has two sources — WaniKani and OCR import — so it needs a unifying table.** Notecards, SRS state, and questions all reference `vocab_items.id`, not `subjects.subject_id` directly; WaniKani-sourced items just have that FK populated.

```
vocab_items
  id                    serial PK
  source                text        -- 'wanikani' | 'ocr_import'
  wanikani_subject_id   int NULL FK -> subjects.subject_id
  kanji_furigana        text        -- e.g. "食べる"
  furigana_only         text        -- e.g. "たべる"
  english               text
  source_image_id       int NULL FK -> vocab_sources.id
  is_user_edited         bool default false
  updated_at             timestamp

vocab_sources
  id           serial PK
  user_id      int FK
  image_url    text
  uploaded_at  timestamp
  status       text        -- pending | processed | failed
```

- **Editable flashcards:** any `vocab_items` row can be edited by the user (e.g. correcting a bad OCR read). Editing just updates the row and sets `is_user_edited = true` — no separate versioning table needed unless you later want edit history, in which case a simple `vocab_item_edits(id, vocab_item_id, field, old_value, new_value, edited_at)` log can be added on top without changing the core table.
- WaniKani-sourced rows (`source = 'wanikani'`) can still be edited locally (e.g. a custom mnemonic note) without ever writing back to WaniKani — local edits never sync upstream, since WaniKani's own content is read-only from this app's perspective.

**Questions are a first-class entity, separate from vocab items and from lessons:**

```
questions
  id                serial PK
  type              text     -- multiple_choice | fill_in_blank | sentence_construction | recall
  payload_json      text     -- choices, correct answer, tiles, blanks — shape varies by type
  vocab_item_ids    int[]    -- which items this question tests
  grammar_topic     text NULL -- pulled from Obsidian, if relevant
  verified          bool     -- did the sub-agent confirm correctness
  created_at        timestamp
```

The generation agent writes drafts; the verifier sub-agent must flip `verified = true` before a question is ever servable. Never serve an unverified question.

**Lessons are pregenerated bundles of questions, mirrored offline the same way `local_assignments` is:**

```
lesson_bundles
  id              serial PK
  user_id         int FK
  question_ids    int[]
  generated_at    timestamp
  consumed        bool
```

Generate 3–5 at a time; the bundle is the offline unit, not individual questions.

**Grammar topics from Obsidian** get a light cache, refreshed whenever the connector reads the file:

```
grammar_topics
  id            serial PK
  user_id       int FK
  topic         text
  source_file   text
  extracted_at  timestamp
```

## SRS design decision

**Two separate SRS systems, not one:**

- **WaniKani-sourced items** keep using WaniKani's own SRS stage, mirrored via `study_progress` as already designed — not reimplemented. WaniKani's stage is authoritative for its own content; this app only reflects it.
- **Everything else** (OCR-imported vocab, and any generated question that targets a non-WaniKani item) runs its own **SM-2** implementation:
    
    ```
    srs_state  id            serial PK  user_id       int FK  vocab_item_id int FK -> vocab_items.id  skill_type    text     -- 'recognition' | 'production'  ease_factor   float    -- SM-2 standard, starts ~2.5  interval_days int  repetitions   int  due_at        timestamp
    ```
    
    `skill_type` splits recognition (multiple choice) from production (typing kanji/furigana) — mirroring WaniKani's own meaning/reading split, since they're genuinely different skills and should schedule independently.

This keeps the two systems from ever disagreeing about the same word: a WaniKani item's due date always comes from WaniKani; a non-WaniKani item's due date always comes from your own SM-2 state.

## Flashcards vs. lessons

- **Flashcards** = `vocab_items` + `srs_state` (or `study_progress` for WaniKani items), queried and reviewed directly — no `questions` table involved.
- **Lessons** = `questions` + `lesson_bundles`, agent-generated and verified ahead of time.
- Both read/write the same underlying SRS record for a given vocab item, so practicing a word via a flashcard or via a lesson question both count toward the same mastery tracking — there's one source of truth for "how well do I know this word," regardless of which mode taught it.

**WaniKani content and AI-generated content are kept as separate study tracks, not merged into one pool.** WaniKani lessons/flashcards (native WK UI, WK's own SRS) and AI-generated lessons/flashcards (the `questions` / `lesson_bundles` system, SM-2) are presented and reviewed independently — the user isn't shown a blended queue mixing both.

**Only "newly learned" WaniKani items are shared with the agent as context**, not the full WaniKani history. This keeps the generation agent's prompt focused on what's actually useful (recently passed items, ripe for reinforcement) rather than flooding it with years of burned items:

```
GET /api/agent-context/newly-learned
  -> study_progress WHERE user_id = ? AND passed_at > (now - N days)
  -> returns: vocab_items joined on subject_id, meanings, readings
```

This is a read-only, filtered view the agent orchestration service queries before generating a batch of questions — it never gets raw access to the full `study_progress`/`subjects` tables, just this narrow "what did the user just learn" feed. The same filter can also feed the Obsidian grammar-topic context, so a single agent call combines recent WaniKani vocab + recent grammar topics into one generation prompt.

**Question mix — newly learned content should season the batch, not dominate it.** A generated lesson bundle should draw from three pools, not lean too heavily on any one:

- **Review** — items due per `srs_state`/`study_progress`, the bulk of any healthy SRS-driven session
- **New** — freshly learned WaniKani items and recent grammar topics, used to add a handful of questions that reinforce what was _just_ studied
- **Continuing** — items still mid-progress (started but not yet mastered), keeping steady exposure independent of what's "new" this week

The generation agent's prompt should specify an approximate ratio across these three pools (exact split is a tuning knob, not fixed here) rather than letting "newly learned" crowd out everything else — the goal is a balanced session, not a highlight reel of the last thing the user studied.

## Voice & translation APIs

- **Text translation** (if needed anywhere, e.g. displaying an English gloss for a sentence the agent generated): Google Cloud Translation has a reliable, well-documented free tier — the first 500,000 characters per month are free, then $20 per million characters after. DeepL's current API tier structure is unclear as of this writing (sources conflict on whether it still has a recurring free monthly tier) — check deepl.com/pro-api directly before committing to it.
- **Voice input/output is a different need entirely** — translation APIs don't do speech.

**Cheapest/free option: use the platform's built-in speech engine instead of a cloud API.**

- **Android** ships with Google's Speech Recognition & Synthesis service — the standard `android.speech.tts.TextToSpeech` and `android.speech.SpeechRecognizer` APIs, which most devices already have installed and support Japanese. This is **$0 per call, no API key, no quota** — it's a system service, not a billed cloud endpoint. Many devices can also download TTS voice packs for offline use, which fits the app's offline-first design directly.
- **Web** has the equivalent built into the browser — the Web Speech API (`SpeechSynthesis` for TTS, `SpeechRecognition` for STT). Also free, no backend call needed. Caveat: STT support is inconsistent outside Chromium-based browsers, so treat voice-input-on-web as a progressive-enhancement feature, not a guaranteed one.
- **Fallback only if native voice quality/accuracy proves insufficient:** Google Cloud Speech-to-Text and Text-to-Speech both have their own free monthly tiers, separate from the Translation API's. Only reach for these if the on-device experience genuinely isn't good enough — they add a network dependency and per-character cost that the native APIs avoid entirely.

## JLPT tracking

Kanji/vocab coverage per JLPT tier (N5–N1), correlated to WaniKani data where possible. Explicitly _not_ a "readiness" score — JLPT also tests grammar and listening, which this doesn't capture — framed in the UI as vocabulary/kanji coverage toward a tier, not exam readiness.

**Data source:** [`davidluzgouveia/kanji-data`](https://github.com/davidluzgouveia/kanji-data) (MIT licensed) for kanji — it already correlates each kanji to both its current JLPT level (`jlpt_new`) and its WaniKani level (`wk_level`), sourced from KANJIDIC and Jonathan Waller's JLPT Resources page, so no scraping or manual compilation needed. This is a one-time seed import, not a live dependency. For vocabulary, a separate community-maintained JLPT vocab list repo (e.g. `elzup/jlpt-word-list`) fills the gap, since `kanji-data` only covers kanji — license should be double-checked before use.

**Schema:**

```
jlpt_reference
  id            serial PK
  character     text
  jlpt_level    int      -- 5,4,3,2,1
  item_type     text     -- kanji | vocab
  source        text     -- provenance of the list used
```

- `subjects` gets a nullable `jlpt_level`, backfilled once by importing `kanji-data`'s `jlpt_new` field directly (its `wk_level` field doubles as a sanity check against your own `subjects.level`).
- `vocab_sources` gets a nullable `jlpt_level` — the tier the user selects at upload time (N5–N1, or "none"), applied by default to that batch's items.
- `vocab_items` gets a nullable `jlpt_level` too, so an individual item can override the source-level default (or get auto-matched against `jlpt_reference` if the user picked "none" but the word happens to be in a known list).

**Upload UX:** when a user uploads a vocab image, they pick the tier for that list (N5/N4/N3/N2/N1/none) as part of the same upload flow — this sets `vocab_sources.jlpt_level`, which cascades to the extracted `vocab_items` unless individually overridden.

**Progress bars — computed on demand, no extra state to maintain beyond the schema above:**

- Per-tier kanji: `learned kanji WHERE jlpt_level = N` ÷ `total kanji WHERE jlpt_level = N` (denominator from `jlpt_reference`)
- All-kanji: same query without the tier filter
- Per-tier and all-vocab: identical shape, filtered to `item_type = 'vocab'`
- "Learned" reuses whatever threshold is already defined elsewhere in the app — WaniKani `passed_at IS NOT NULL` for WaniKani items, a `srs_state.repetitions` threshold for everything else — so this feature adds no new mastery concept, just a new way to slice existing progress data by JLPT tier.

Everything here is a standard, well-understood pattern — vision-model OCR, an LLM generation-agent-plus-verifier pair, SM-2 spaced repetition, and a tile-based sentence builder (Duolingo's version is well documented). The real complexity isn't any single piece, it's the data model needing to treat WaniKani-sourced and self-imported content as first-class equals (via `vocab_items`) while keeping their SRS scheduling systems intentionally separate.