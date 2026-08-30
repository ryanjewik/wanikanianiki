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

    # --- Vision extraction ---------------------------------------------------
    # Photo import only. Empty means the feature is off: uploads are rejected
    # with a 503 rather than silently accepted and never processed.
    anthropic_api_key: SecretStr | None = None

    # Pinned deliberately, the same way `wanikani_revision` is — an extraction
    # prompt is tuned against a model, and a silent upgrade re-tunes it.
    vision_model: str = "claude-opus-5"

    # Where uploaded page photos are kept. A local directory in development; in
    # Lambda this is the only writable path, and S3 takes over via
    # `VOCAB_IMAGE_BUCKET` once that is wired.
    vocab_image_dir: str = "/tmp/kanji-workshop/vocab-sources"
    vocab_image_bucket: str = ""

    # --- Database -----------------------------------------------------------
    # Neon/Supabase style URL. Empty means "no database configured": the app
    # still serves every read-only WaniKani-backed route, it just cannot cache.
    database_url: str = ""

    # Alembic runs against this instead, when set. Providers hand out two
    # endpoints: a transaction-mode *pooler* — which is what the app should use,
    # and what `database_url` should point at — and a *direct* connection.
    # DDL through a transaction-mode pooler is unreliable, so migrations want
    # the direct one. Unset falls back to `database_url`, which is correct for a
    # local Postgres where there is only one endpoint.
    database_migration_url: str = ""

    # --- Runtime ------------------------------------------------------------
    environment: str = "local"
    log_level: str = "INFO"

    @field_validator("database_url", "database_migration_url")
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
    def has_vision(self) -> bool:
        return self.anthropic_api_key is not None

    @property
    def migration_url(self) -> str:
        """The URL Alembic connects with. See `database_migration_url`."""
        return self.database_migration_url or self.database_url

    @property
    def is_lambda(self) -> bool:
        import os

        return bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))


@lru_cache
def get_settings() -> Settings:
    """Cached so the .env is parsed once per process (once per warm Lambda)."""
    return Settings()
