# Kanji Workshop

A WaniKani-connected kanji and vocabulary app. Two independent projects in one
tree, built and run separately.

```
mobile/     Expo / React Native app  — see mobile/README.md
backend/    FastAPI service          — see backend/README.md
```

They share no code and no build. The only contract between them is HTTP: the
app calls `EXPO_PUBLIC_API_URL`, the backend answers. Nothing imports across the
boundary, and neither folder appears in the other's dependency tree.

## Getting started

Each half stands up on its own.

```bash
cd mobile && npm install && npm start
```

```bash
cd backend && python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"    # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload
```

The app runs without the backend — every screen falls back to the fixtures in
`mobile/src/data/fixtures.ts`. Point it at a running server by setting
`EXPO_PUBLIC_API_URL` in `mobile/.env`.

The backend runs without a database — every read route falls through to
WaniKani directly. Set `DATABASE_URL` in `backend/.env` to enable caching,
streaks, and the sync worker.

## Where the WaniKani token lives

`backend/.env`, and nowhere else. It is gitignored.

The token is deliberately *not* at the repo root: the mobile app would load a
root `.env` too, and the whole point of the architecture is that the client
never holds the token. Clients call the backend; only the backend calls
WaniKani.

## Layout

```
mobile/
  app/                    expo-router routes
  src/                    components, theme, data layer, hooks
  assets/                 subset fonts, Crabigator sprites, icons
  scripts/                font subsetting
  Japanese Kanji Learning App Designs/    source artboards

backend/
  app/
    wanikani/             API client, rate limiting, response mapping
    api/                  HTTP routes
    db/                   models, repository, session
    services/             sync worker
  tests/
  docs/wanikani-api-notes.md    the design doc this implements
```

Design docs sit with what they describe: the artboards in `mobile/`, the API
and schema notes in `backend/docs/`.
