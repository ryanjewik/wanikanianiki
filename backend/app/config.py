"""Settings.

Everything is read from the environment. Locally that comes from the repo-root
`.env`; in Lambda it comes from the function's environment variables, populated
from Secrets Manager or SSM. The WaniKani token never appears in code, in a
default, or in a log line.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The token lives in `backend/.env` — the backend is the only thing that uses
# it, so it sits with the code that reads it rather than at the repo root where
# the mobile app would also see it.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Later entries win, so a repo-root .env is a fallback and
        # `backend/.env` is authoritative.
        env_file=(REPO_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        # The existing .env uses `wanikani_apikey`, lower case.
        case_sensitive=False,
    )

    # --- WaniKani -----------------------------------------------------------
    # SecretStr so an accidental repr/log of the settings object prints
    # `**********` instead of the token.
    wanikani_apikey: SecretStr = Field(...)

    wanikani_base_url: str = "https://api.wanikani.com/v2"

    # Date-versioned API revision. Pinning this is what stops WaniKani changing
    # response shapes under us; bump it deliberately, never automatically.
    wanikani_revision: str = "20170710"

    # Documented cap is 60 requests/minute per token. Held slightly under it so
    # a burst of concurrent handlers cannot tip us into a 429.
    wanikani_rate_limit_per_minute: int = 55

    wanikani_timeout_seconds: float = 20.0
    wanikani_max_retries: int = 3

    # --- Database -----------------------------------------------------------
    # Neon/Supabase style URL. Empty means "no database configured": the app
    # still serves every read-only WaniKani-backed route, it just cannot cache.
    database_url: str = ""

    # --- Runtime ------------------------------------------------------------
    environment: str = "local"
    log_level: str = "INFO"

    @field_validator("database_url")
    @classmethod
    def _normalise_driver(cls, value: str) -> str:
        """Force the async driver.

        A pasted Neon/Supabase URL is `postgresql://` or `postgres://`, which
        SQLAlchemy resolves to psycopg2 — a sync driver that would block the
        event loop. Rewriting here means the URL can be copied from the
        provider's dashboard unmodified.
        """
        if not value:
            return value
        for prefix in ("postgresql+asyncpg://", "postgresql+psycopg://"):
            if value.startswith(prefix):
                return value
        if value.startswith("postgres://"):
            return "postgresql+asyncpg://" + value[len("postgres://") :]
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value[len("postgresql://") :]
        return value

    @property
    def has_database(self) -> bool:
        return bool(self.database_url)

    @property
    def is_lambda(self) -> bool:
        import os

        return bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))


@lru_cache
def get_settings() -> Settings:
    """Cached so the .env is parsed once per process (once per warm Lambda)."""
    return Settings()
