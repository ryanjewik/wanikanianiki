"""Alembic environment.

Two things differ from the stock async template:

* **The URL comes from `app.config`, never from `alembic.ini`.** The token and
  the database URL live in the environment, and duplicating a connection string
  into a tracked file is how one ends up committed.
* **It connects with the *direct* endpoint, not the pooler** — see
  `Settings.database_migration_url`. DDL through a transaction-mode pooler is
  unreliable, so migrations deliberately take a different route to the same
  database than the app does.
"""

from __future__ import annotations

import asyncio
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

# Allow `alembic` to run from anywhere, not just `backend/`.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.db.models import Base  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# What `--autogenerate` diffs the live database against.
target_metadata = Base.metadata


def _database_url() -> str:
    url = get_settings().migration_url
    if not url:
        raise RuntimeError(
            "No database configured. Set DATABASE_URL (or DATABASE_MIGRATION_URL) "
            "in backend/.env before running alembic."
        )
    return url


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting.

    Useful for reviewing what a revision would do against production, or for
    handing the SQL to someone who applies it themselves.
    """
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Autogenerate misses both of these by default, and both have bitten
        # every project that left them off.
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(
        _database_url(),
        poolclass=NullPool,
        # Harmless on a direct connection, and saves anyone who points this at
        # a transaction-mode pooler anyway.
        connect_args={"statement_cache_size": 0},
    )

    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await engine.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
