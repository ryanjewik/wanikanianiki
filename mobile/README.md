# Kanji Workshop

A WaniKani-connected kanji and vocabulary app. Expo SDK 57 / React Native 0.86,
built against the artboards in `Japanese Kanji Learning App Designs/` and the
Crabigator asset pack in `assets/out/`.

```bash
npm start
```

Then `a` for Android, `w` for web. `npm run typecheck` runs `tsc --noEmit`.

## What's here

```
app/                       expo-router routes (file-based)
  _layout.tsx              fonts, splash, database init
  (tabs)/
    _layout.tsx            Home 家 · Study 習 · Import 写 · Items 帳
    index.tsx              Dashboard              — artboard 3b
    study.tsx              Study hub              — not drawn; see below
    import.tsx             Photo import           — artboard 6d
    items.tsx              Level browser          — artboard 6b
  lesson/index.tsx         Lesson                 — artboard 4c
  review/index.tsx         Review                 — artboard 4d
  session-summary.tsx      Session summary        — artboard 6c
  item/[id].tsx            Item detail            — artboard 6a

src/
  theme/tokens.ts          colours, type scale, radii, shadows, SRS stages
  components/
    ui.tsx                 Card, ChunkyButton, CharTile, StatTile, progress…
    icons.tsx              the Asset Sheet SVGs, transcribed
    Mascot.tsx             Crabigator sprite player + stills
    ScreenHeader.tsx       the white top bar, in its three shapes
  data/
    types.ts               domain model
    db.ts                  SQLite mirror + outbox
    api.ts                 client for *your* backend
    sync.ts                sync pass, outbox replay, relative-time helpers
    fixtures.ts            sample content so every screen renders
  hooks/useStudyData.ts    screen-facing data hooks

assets/fonts/              subset TTFs (generated) + OFL licences
assets/mascot/             sprites, poses, views, banners, icons
scripts/subset-fonts.py    regenerates assets/fonts/
```

`app/(tabs)/study.tsx` is the one screen with no artboard — the tab bar needs a
fourth destination, and the design doc is explicit that WaniKani content and
AI-generated content stay separate study tracks rather than one blended queue.
That screen is where the separation becomes visible. It is assembled entirely
from the existing primitives, so it stays inside the drawn system.

## Design system

Everything comes from the artboards, so screens can be diffed against them
directly:

| | |
|---|---|
| Ground / surface | `#F2F2F4` / `#FFFFFF`, 1px `#E7E7EA` edge, 16px radius |
| Radicals | `#2F7CE0` · tint `#E6F0FD` |
| Kanji | `#E8447F` · tint `#FDEAF1` |
| Vocabulary | `#8B5CD6` · tint `#F3ECFD` |
| UI type | Zen Kaku Gothic New, 400/500/700/900 |
| Japanese type | Shippori Mincho, 500/700 |

Two card treatments exist and they are not interchangeable: dashboard and
lesson screens use a **shadowed** card with no border, while detail, browser,
summary and import screens use a **bordered** card with no shadow. `Card` takes
a `variant` rather than picking one.

Anything that commits — a CTA, the review submit button — gets a 1.5px ink
outline over a hard, un-blurred offset shadow, and collapses into that offset
when pressed.

Japanese is reserved for the material being studied. UI copy is English.

### Fonts

The app loads **subset** copies from `assets/fonts/`, not the
`@expo-google-fonts` packages. Those stay in `devDependencies` purely as the
source for regenerating subsets:

```bash
npm run fonts:subset    # rebuild assets/fonts/
npm run fonts:check     # verify without writing
```

Japanese faces are enormous — the six weights the design uses total **26.5MB**
unsubset, which `scripts/subset-fonts.py` cuts to **8.0MB (70% smaller)**. The
two families are cut very differently, because they do different jobs:

| | Coverage | Per weight |
|---|---|---|
| Zen Kaku Gothic New (sans) | Latin, punctuation, kana, ~20 UI kanji | 2.3MB → **80KB** |
| Shippori Mincho (serif) | JIS X 0208 — 6,356 kanji + kana | 8.6MB → **3.8MB** |

The asymmetry is the point. The design reserves Japanese for the material being
studied, so the sans font renders almost no Japanese at all (the `日` in "41日"
on the streak card is the only one that ships today) — it can be cut to the
bone. The serif renders whatever WaniKani returns, and eventually whatever a
user photographs out of a textbook, so **tofu there would be a correctness bug,
not a cosmetic one**. JIS X 0208 is the standard set covering all modern
Japanese, and the script derives it from Python's own `shift_jis` codec rather
than a vendored list, so there is no data file to go stale.

If you load a different weight in `app/_layout.tsx`, re-run the subset script.
`fonts:check` fails loudly if a weight is referenced but not built.

Both families are SIL OFL 1.1 and neither declares a Reserved Font Name, so the
subsets keep the original family names. The licences are copied into
`assets/fonts/`, which OFL requires.

**Neither font contains U+2713 (✓).** Check marks are drawn as SVG
(`CheckMark` in `components/icons.tsx`) rather than set as text, which would
silently fall back to an arbitrary system font.

## Data flow

The app never talks to WaniKani. The token lives on your API server, which is
the only thing that holds it.

```
This app  ──►  your backend  ──►  WaniKani API
   │                │
   ▼                ▼
 SQLite          Postgres
(mirror +       (cache +
 outbox)         progress)
```

`src/data/db.ts` holds a full local mirror of subjects and assignments, not
just a write queue — that is what makes a whole lesson or review session work
with no connectivity. The only thing needing a live connection is submitting
the result.

**Writes always go through the outbox.** `useStudyActions` queues to
`pending_writes` and *then* tries to drain it, so the offline and online paths
are the same code. Replay is oldest-first and stops at the first failure —
several reviews of one item have to land in the order they were answered, so a
gap is worse than a delay. Rows are stamped synced once the server confirms,
never deleted optimistically.

Only two endpoints change state upstream: `PUT /assignments/{id}/start` when a
lesson finishes, and `POST /reviews` when an item is answered. Reviews report
*incorrect counts only* — WaniKani recomputes the SRS stage server-side, so the
client never sends a stage.

`sync_meta['last_synced_at']` does double duty: it is the "Synced 4 minutes ago"
line in the UI and the `updated_after` cursor for the next poll, so freshness
display and incremental sync share one source of truth.

### Connecting a backend

Set one variable:

```bash
EXPO_PUBLIC_API_URL=https://your-api.example.com
```

Until then `isBackendConfigured` is false and every hook falls back to
`src/data/fixtures.ts`, which uses the exact content drawn in the artboards
(level 12, 明 and 山, the Genki II page 84 import). No screen changes when you
switch over.

Endpoints the client expects: `GET /api/dashboard`, `GET /api/assignments`,
`GET /api/subjects`, `PUT /api/assignments/{id}/start`, `POST /api/reviews`,
`POST /api/vocab-sources`, `GET /api/lesson-bundles/next`.

## The Crabigator

`Mascot` plays the sprite strips in `assets/mascot/anim/` — one horizontal row
of 200×200 frames per pose, so the animation is a single `translateX` on an
oversized image inside a clipped box. Stepping runs on the UI thread via
Reanimated rather than through React state, which matters at 24–30fps.

```tsx
<Mascot pose="wave" size={80} speed={0.7} />
```

`idle` / `wave` / `walk` / `blink` loop; `correct` and `wrong` are one-shots for
answer feedback — set the pose when an answer lands and return to idle from
`onReactionEnd`. `MascotStill`, `MascotBust`, `MascotAvatar` and `MascotBanner`
cover the non-animated slots.

Frame counts and fps come from `assets/mascot/anim/manifest.json`, so
re-exporting at different timing needs no code change. The vector source
(`assets/out/app/src/CrabGator.tsx`, react-native-svg + Reanimated) is an
alternative if you want resolution independence over the sprite approach.

## Not built yet

Scaffolding stops at the UI and the local data layer. Still open:

- **The backend.** Nothing here implements the API server, the Postgres schema,
  or the sync worker — that lives in `../backend/`, and the full design is in
  `../backend/docs/wanikani-api-notes.md`.
- **Kana IME.** The review screen accepts kana but leans on the platform
  keyboard; there is no romaji→kana converter.
- **Speech.** The ♪ buttons are drawn but inert. The plan is
  `expo-speech` / the platform engine, which is free and works offline.
- **OCR ingestion.** `uploadVocabPhoto` posts to `/api/vocab-sources`; the
  vision-model service behind it does not exist. The import screen falls back to
  a sample extraction so the review-and-commit flow is still exercisable.
- **AI lesson generation.** `questions` / `lesson_bundles` are typed and the
  SQLite tables exist, but no generation or verifier agent is wired up.
- **JLPT tracking.** `jlptLevel` is plumbed through the schema and shown on
  import rows; the `kanji-data` seed import and the per-tier progress bars are
  not built.
- **Auth.** There is no login; the app assumes a single user.
