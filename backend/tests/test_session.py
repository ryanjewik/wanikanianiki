"""Engine construction.

The interesting question is not pooling but prepared statements: a
transaction-mode pooler reassigns server-side sessions between transactions, so
a statement prepared on one is missing from the next. Getting that wrong fails
at runtime, on the second query, only against a real pooler — which is exactly
the failure a unit test should be catching instead.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.db.session import create_engine_for_environment, uses_transaction_pooler

SUPABASE_TRANSACTION = "postgresql://u:p@aws-0-us-east-2.pooler.supabase.com:6543/postgres"
SUPABASE_SESSION = "postgresql://u:p@aws-0-us-east-2.pooler.supabase.com:5432/postgres"
SUPABASE_DIRECT = "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres"
NEON_POOLED = "postgresql://u:p@ep-cool-name-123-pooler.us-east-2.aws.neon.tech/db"
NEON_DIRECT = "postgresql://u:p@ep-cool-name-123.us-east-2.aws.neon.tech/db"
LOCAL = "postgresql://postgres:postgres@localhost:5432/postgres"


@pytest.mark.parametrize(
    "url",
    [SUPABASE_TRANSACTION, NEON_POOLED, LOCAL + "?pgbouncer=true"],
)
def test_transaction_poolers_are_recognised(url: str) -> None:
    assert uses_transaction_pooler(url) is True


@pytest.mark.parametrize(
    "url",
    [SUPABASE_SESSION, SUPABASE_DIRECT, NEON_DIRECT, LOCAL],
)
def test_session_mode_and_direct_endpoints_are_not(url: str) -> None:
    """Session mode holds one backend per client connection, so caching is safe.

    Supabase puts both modes on the same hostname and separates them by port,
    so a host-substring check would wrongly flag this one.
    """
    assert uses_transaction_pooler(url) is False


def _connect_kwargs(url: str, *, lambda_env: bool, monkeypatch) -> dict:
    """Capture what we hand `create_async_engine`.

    SQLAlchemy folds `connect_args` into a closure the pool calls, rather than
    storing it on the engine or dialect, so the merged dict is not readable
    back off a built engine. Recording the call is the honest way to assert on
    it — and `test_the_keys_are_real` below checks the other half, that the
    dialect actually consumes these names.
    """
    recorded: dict = {}

    def recorder(url_arg, **kwargs):
        recorded["url"] = url_arg
        recorded.update(kwargs)
        return object()

    monkeypatch.setattr("app.db.session.create_async_engine", recorder)
    if lambda_env:
        monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "kanji-workshop-api")
    else:
        monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)

    create_engine_for_environment(Settings(database_url=url))
    return recorded


@pytest.mark.parametrize("lambda_env", [False, True])
def test_pooler_url_disables_both_statement_caches(
    lambda_env: bool, monkeypatch
) -> None:
    """Both caches, under either runtime.

    Turning off only asyncpg's leaves SQLAlchemy's adapter cache to hand a
    stale statement to a fresh server-side session, so the bug survives. The
    `lambda_env=False` case is the one that was broken: uvicorn on a laptop
    pointed at the pooler got no protection at all.
    """
    args = _connect_kwargs(
        SUPABASE_TRANSACTION, lambda_env=lambda_env, monkeypatch=monkeypatch
    )["connect_args"]

    assert args["statement_cache_size"] == 0
    assert args["prepared_statement_cache_size"] == 0
    assert callable(args["prepared_statement_name_func"])


@pytest.mark.parametrize("lambda_env", [False, True])
def test_pooler_statement_names_are_unique(lambda_env: bool, monkeypatch) -> None:
    """Numeric names collide across client connections behind one pooler."""
    args = _connect_kwargs(
        SUPABASE_TRANSACTION, lambda_env=lambda_env, monkeypatch=monkeypatch
    )["connect_args"]

    name_func = args["prepared_statement_name_func"]
    assert name_func() != name_func()


def test_direct_url_keeps_the_caches(monkeypatch) -> None:
    """A direct connection owns its backend, so caching is a straight win."""
    args = _connect_kwargs(
        SUPABASE_DIRECT, lambda_env=False, monkeypatch=monkeypatch
    )["connect_args"]

    assert args == {}


def test_pool_choice_follows_the_runtime_not_the_url(monkeypatch) -> None:
    """The two axes stay independent: a direct URL on Lambda still wants NullPool."""
    from sqlalchemy.pool import NullPool

    on_lambda = _connect_kwargs(
        SUPABASE_DIRECT, lambda_env=True, monkeypatch=monkeypatch
    )
    assert on_lambda["poolclass"] is NullPool

    local = _connect_kwargs(SUPABASE_DIRECT, lambda_env=False, monkeypatch=monkeypatch)
    assert "poolclass" not in local
    assert local["pool_pre_ping"] is True


def test_the_keys_are_real() -> None:
    """Guard against a silent rename in the dialect.

    Every one of these is only ever read by name out of a kwargs dict, so a
    typo or an upstream rename would not raise — it would just quietly restore
    the caching we are trying to disable. Assert the consumers exist.
    """
    import inspect

    from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi

    source = inspect.getsource(AsyncAdapt_asyncpg_dbapi.connect)
    assert "prepared_statement_cache_size" in source
    assert "prepared_statement_name_func" in source

    import asyncpg

    assert "statement_cache_size" in inspect.signature(asyncpg.connect).parameters
