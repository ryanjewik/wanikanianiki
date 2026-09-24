"""The API key: required when set, refused when missing outside local.

`/health` is the probe because it is the one route that answers without a
database or WaniKani, so the status seen is the auth check's and nothing else's.
"""

from __future__ import annotations

import httpx2 as httpx
import pytest

from app.config import Settings, get_settings
from app.main import create_app

KEY = "correct-horse-battery-staple"


@pytest.fixture
def make_client(monkeypatch):
    """An app built under the given key and environment."""

    def build(*, api_key: str = "", environment: str = "local") -> httpx.AsyncClient:
        monkeypatch.setenv("API_KEY", api_key)
        monkeypatch.setenv("ENVIRONMENT", environment)
        monkeypatch.setenv("DATABASE_URL", "")
        get_settings.cache_clear()
        app = create_app()
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    yield build
    get_settings.cache_clear()


async def test_local_without_a_key_stays_open(make_client):
    async with make_client() as client:
        assert (await client.get("/health")).status_code == 200


async def test_a_configured_key_is_required(make_client):
    async with make_client(api_key=KEY) as client:
        response = await client.get("/health")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_a_wrong_key_is_refused(make_client):
    async with make_client(api_key=KEY) as client:
        response = await client.get("/health", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


async def test_the_right_key_is_let_through(make_client):
    async with make_client(api_key=KEY) as client:
        response = await client.get("/health", headers={"Authorization": f"Bearer {KEY}"})
    assert response.status_code == 200


async def test_the_key_is_not_accepted_under_another_scheme(make_client):
    async with make_client(api_key=KEY) as client:
        response = await client.get("/health", headers={"Authorization": f"Basic {KEY}"})
    assert response.status_code == 401


async def test_deployed_without_a_key_refuses_rather_than_opens(make_client):
    # The failure this guards: a missing Parameter Store entry on Lambda
    # silently publishing the WaniKani account to anyone with the URL.
    async with make_client(environment="production") as client:
        response = await client.get("/health")
    assert response.status_code == 503


async def test_docs_are_not_served_outside_local(make_client):
    async with make_client(api_key=KEY, environment="production") as client:
        for path in ("/docs", "/openapi.json"):
            assert (await client.get(path)).status_code == 404


def test_a_blank_key_means_no_key():
    # Otherwise `API_KEY=` would configure a key an empty bearer token matches.
    assert Settings(wanikani_apikey="t", api_key="").api_key is None
    assert Settings(wanikani_apikey="t", api_key="   ").api_key is None
