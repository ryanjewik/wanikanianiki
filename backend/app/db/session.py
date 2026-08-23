"""Async engine and session.

Pooling is the one place the deployment target genuinely leaks into the code.

**Under Lambda**, a warm container handles one request at a time, and a frozen
container holds its sockets open between invocations — where the database may
have dropped them, so the next invocation reuses a dead connection. `NullPool`
sidesteps that entirely by connecting per request. That costs a TCP+TLS
handshake, which is why the Neon/Supabase *pooler* endpoint matters: it keeps
warm server-side connections so the per-request cost stays small.

**Under a long-lived container** (Fargate, App Runner, uvicorn locally), a real
pool is correct and `NullPool` would be wasteful.

`create_engine_for_environment` picks based on where it is actually running, so
neither deployment needs a code change.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def create_engine_for_environment(settings: Settings) -> AsyncEngine:
    if not settings.has_database:
        raise RuntimeError("DATABASE_URL is not configured")

    if settings.is_lambda:
        return create_async_engine(
            settings.database_url,
            poolclass=NullPool,
            # Statement caching breaks through a transaction-mode pooler
            # (PgBouncer, Neon's pooler): the cached plan may land on a
            # different server-side session than the one that prepared it.
            connect_args={"statement_cache_size": 0},
            echo=False,
        )

    return create_async_engine(
        settings.database_url,
        pool_size=5,
        max_overflow=5,
        # Recycle below any idle timeout the provider enforces.
        pool_recycle=280,
        pool_pre_ping=True,
        echo=False,
    )


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_engine_for_environment(get_settings())
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(), expire_on_commit=False, class_=AsyncSession
        )
    return _session_factory


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Transactional scope. Commits on clean exit, rolls back on any exception."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
