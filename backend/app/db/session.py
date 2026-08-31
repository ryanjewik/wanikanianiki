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

Prepared statements are a separate axis, and it is the *connection URL* that
decides them, not the runtime: a transaction-mode pooler hands each transaction
whichever server-side session is free, so a statement prepared on one lands on
another and Postgres reports it does not exist. That is true of uvicorn on a
laptop pointed at the pooler just as much as of Lambda, which is why the two
questions are answered separately below.

`create_engine_for_environment` picks both, so neither deployment needs a code
change.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from uuid import uuid4

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


# Ports and host markers that mean "a transaction-mode pooler is in front of
# you". Supabase splits the two modes by port on the same host — 6543 is
# transaction mode, 5432 on that host is session mode, which holds one
# server-side session for the life of the client connection and so is safe for
# prepared statements. Neon marks its pooler in the hostname instead. The
# `pgbouncer=true` query flag is the convention several ORMs settled on.
_TRANSACTION_POOLER_PORTS = frozenset({6543})
_TRANSACTION_POOLER_HOST_MARKERS = ("-pooler.",)


def uses_transaction_pooler(url: str) -> bool:
    """Whether `url` points at a pooler that reassigns sessions per transaction.

    Deliberately narrow. A false positive only costs the prepared-statement
    cache, but a false negative is a hard runtime failure the first time a
    statement is reused, so the markers here are ones that unambiguously mean
    transaction mode rather than anything pooler-shaped.
    """
    parts = urlsplit(url)
    if parts.port in _TRANSACTION_POOLER_PORTS:
        return True
    host = (parts.hostname or "").lower()
    if any(marker in host for marker in _TRANSACTION_POOLER_HOST_MARKERS):
        return True
    return "pgbouncer=true" in (parts.query or "").lower()


def _pooler_connect_args() -> dict[str, object]:
    """The three settings a transaction-mode pooler needs. All three matter.

    `statement_cache_size` turns off asyncpg's own cache and
    `prepared_statement_cache_size` turns off the one SQLAlchemy's asyncpg
    adapter keeps on top of it — disabling either alone still leaves the other
    handing a stale statement to a fresh session.

    `prepared_statement_name_func` covers the remaining case: asyncpg names
    statements in numeric order, so two client connections independently
    prepare `__asyncpg_stmt_1__`, and through a pooler both can land on one
    server-side session where the second name is already taken. Uniqueness per
    statement removes the collision.
    """
    return {
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    }


def create_engine_for_environment(settings: Settings) -> AsyncEngine:
    if not settings.has_database:
        raise RuntimeError("DATABASE_URL is not configured")

    connect_args: dict[str, object] = {}
    if uses_transaction_pooler(settings.database_url):
        connect_args = _pooler_connect_args()

    if settings.is_lambda:
        return create_async_engine(
            settings.database_url,
            poolclass=NullPool,
            connect_args=connect_args,
            echo=False,
        )

    return create_async_engine(
        settings.database_url,
        pool_size=5,
        max_overflow=5,
        # Recycle below any idle timeout the provider enforces.
        pool_recycle=280,
        pool_pre_ping=True,
        connect_args=connect_args,
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
