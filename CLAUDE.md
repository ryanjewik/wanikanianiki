This repo holds two independent projects in one tree:

- `mobile/` — the Expo / React Native app. Has its own `AGENTS.md`; read it
  before touching anything in there.
- `backend/` — the FastAPI service that owns the WaniKani token.

`infra/` is the Terraform that deploys `backend/` to AWS. It is not a third
application: it reads the zip `backend/scripts/build_lambda.py` produces and
nothing else, and never holds a secret (those live in Parameter Store).

They share nothing at runtime and are built and run separately. Work in one
folder at a time, and do not add imports across the boundary.

The WaniKani token lives in `backend/.env` (gitignored). Never print it, and
never move it to the repo root where the mobile app would also load it.
