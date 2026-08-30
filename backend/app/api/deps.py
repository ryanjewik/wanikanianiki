"""Request-scoped dependencies."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db.session import get_session_factory
from app.wanikani.client import WaniKaniClient, get_client


def settings_dep() -> Settings:
    return get_settings()


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
