"""Test-wide environment.

`app/main.py` calls `create_app()` at module scope so `lambda_handler.py` has
an `app` to wrap, which means importing it constructs `Settings` — and
`wanikani_apikey` has no default, deliberately, so that a missing token fails
loudly rather than silently sending unauthenticated requests.

Collection imports test modules before any fixture runs, so the token has to be
in the environment by then. Setting it here, at conftest import time, is early
enough. `setdefault` so a real `.env` or a real exported token still wins.
"""

import os

os.environ.setdefault("wanikani_apikey", "test-token-not-real")

# Route tests run open, the way the API runs on a laptop. Set outright rather
# than defaulted: a developer's real API_KEY in backend/.env would otherwise put
# every route test behind a 401. `test_auth.py` turns the key on per test.
os.environ["API_KEY"] = ""
os.environ.setdefault("ENVIRONMENT", "local")

# The same, and more important: no unit test may reach the real database a
# developer's backend/.env points at. `monkeypatch.delenv("DATABASE_URL")` does
# not achieve that — the variable is gone but Settings still reads the .env
# file — so a test calling /health would open a connection to it. An empty
# variable wins over the file. The integration tests set their own URL from
# TEST_DATABASE_URL, which this does not touch.
os.environ["DATABASE_URL"] = ""
