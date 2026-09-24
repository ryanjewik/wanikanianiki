"""Request-scoped dependencies."""

from __future__ import annotations

import hmac
from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db.session import get_session_factory
from app.wanikani.client import WaniKaniClient, get_client


def settings_dep() -> Settings:
    return get_settings()


# `auto_error=False` so a missing header reaches the check below and gets the
# same 401 as a wrong one, instead of FastAPI's own 403.
_bearer = HTTPBearer(auto_error=False)


async def require_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(settings_dep),
) -> None:
    """Every route sits behind this, `/health` included.

    Health is not exempt because it is not harmless: it reports table counts
    and, when the database is unhappy, the driver's error text — which can name
    the host. There is no uptime checker to keep it open for.
    """
    expected = settings.api_key
    if expected is None:
        if settings.environment == "local":
            return
        # Fail closed. An unset key on a deployed function is a missing
        # Parameter Store entry, not a decision to run open.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "No API key configured",
                "hint": "Set API_KEY. Outside ENVIRONMENT=local the API will not run open.",
            },
        )

    # Constant-time, so response timing cannot be used to guess the key a
    # character at a time.
    given = credentials.credentials if credentials else ""
    if not hmac.compare_digest(given.encode(), expected.get_secret_value().encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or wrong API key",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def wanikani_client() -> WaniKaniClient:
    """The one client for this process.

    Shared deliberately: it owns the rate limiter, and a per-request client
    would give each request its own budget and defeat the limit entirely.

    Read from the module rather than `app.state`, because under Mangum the
    lifespan that populates `app.state` re-runs on every invocation — see
    `get_client()`.
    """
    return get_client()


async def db_session(
    settings: Settings = Depends(settings_dep),
) -> AsyncIterator[AsyncSession]:
    """A transactional session, or a 503 when no database is configured.

    Routes that can degrade gracefully should depend on `optional_db_session`
    instead and handle `None`.
    """
    if not settings.has_database:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No database configured (set DATABASE_URL)",
        )

    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def optional_db_session(
    settings: Settings = Depends(settings_dep),
) -> AsyncIterator[AsyncSession | None]:
    """Yields None when there is no database.

    This is what lets the whole read side work against a bare WaniKani token
    with no Postgres at all — useful for local development and for the very
    first run before any sync has happened.
    """
    if not settings.has_database:
        yield None
        return

    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
