"""The Lambda adapter, and the client lifetime it depends on.

The bug these guard against is not visible under uvicorn and does not show up
in any request-level test: Mangum constructs its `LifespanCycle` inside
`__call__`, so a FastAPI lifespan runs startup *and shutdown* on every
invocation rather than once per container. A client built in the lifespan is
therefore rebuilt per request, and a rebuilt client means a fresh
`RateLimiter` with an empty window — each request believing it owns the whole
60/min budget that WaniKani actually meters per token.

So the thing worth asserting is object identity across invocations.
"""

from __future__ import annotations

import os

import pytest
from mangum import Mangum

from app.config import get_settings
from app.main import create_app
from app.wanikani.client import get_client


@pytest.fixture(autouse=True)
def clean_process_state(monkeypatch):
    """Every test starts with no cached settings and no cached client."""
    monkeypatch.setenv("wanikani_apikey", "test-token-not-real")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    get_settings.cache_clear()
    get_client.cache_clear()
    yield
    get_settings.cache_clear()
    get_client.cache_clear()


def _event(path: str = "/health") -> dict:
    """A Function URL request, in payload format 2.0."""
    return {
        "version": "2.0",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {"accept": "application/json", "host": "example.lambda-url.aws"},
        "requestContext": {
            "http": {
                "method": "GET",
                "path": path,
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
            }
        },
        "isBase64Encoded": False,
    }


def test_client_is_cached_on_the_module():
    assert get_client() is get_client()


def test_warm_invocations_share_one_client(monkeypatch):
    """The regression test. Two invocations, one client.

    Without the module-level cache this fails: the lifespan builds a client on
    each invocation and closes it again on the way out.
    """
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "kanji-api")
    get_settings.cache_clear()

    handler = Mangum(create_app(), lifespan="auto")
    before = get_client()

    first = handler(_event(), None)
    second = handler(_event(), None)

    assert first["statusCode"] == 200
    assert second["statusCode"] == 200
    # Survived both invocations, so the rate limiter's window survived too.
    assert get_client() is before


def test_rate_limiter_window_survives_invocations(monkeypatch):
    """The reason identity matters, stated directly."""
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "kanji-api")
    get_settings.cache_clear()

    handler = Mangum(create_app(), lifespan="auto")
    limiter = get_client()._limiter

    # Stand in for requests already spent in this rolling minute.
    limiter._timestamps.extend([1.0, 2.0, 3.0])

    handler(_event(), None)

    assert get_client()._limiter is limiter
    assert len(get_client()._limiter._timestamps) == 3


def test_uvicorn_shutdown_still_closes_the_client():
    """Outside Lambda, shutdown means shutdown.

    The Lambda carve-out must not leak into the long-lived case, where a real
    shutdown should still release the connection pool and the engine.
    """
    assert not get_settings().is_lambda
    assert "AWS_LAMBDA_FUNCTION_NAME" not in os.environ

    from fastapi.testclient import TestClient

    before = get_client()
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200

    # The lifespan cleared the cache on the way out, so the next caller gets a
    # fresh client rather than one whose transport is already closed.
    assert get_client() is not before
