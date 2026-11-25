"""How a WaniKani failure reaches the phone.

The phone retries a 5xx and sets a 4xx aside, so the status chosen here decides
whether a lesson WaniKani refuses is retried silently forever or shows up on
the phone with the reason. Before this, every refusal other than 401 and 422
arrived as a bare 502 -- retried forever, with nothing saying what WaniKani
had answered.
"""

from __future__ import annotations

import httpx2 as httpx
import pytest

from app.api.deps import optional_db_session, wanikani_client
from app.config import get_settings
from app.main import create_app
from app.wanikani.client import WaniKaniError


class Refusing:
    def __init__(self, error: WaniKaniError):
        self.error = error

    async def start_assignment(self, assignment_id: int, **kwargs):
        raise self.error


@pytest.fixture
def call_start(monkeypatch):
    monkeypatch.setenv("API_KEY", "")
    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("DATABASE_URL", "")
    get_settings.cache_clear()

    async def run(error: WaniKaniError) -> httpx.Response:
        app = create_app()

        async def _client():
            return Refusing(error)

        async def _no_db():
            yield None

        app.dependency_overrides[wanikani_client] = _client
        app.dependency_overrides[optional_db_session] = _no_db
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.put("/api/assignments/42/start")

    yield run
    get_settings.cache_clear()


async def test_a_wanikani_refusal_is_a_409_with_its_reason(call_start):
    response = await call_start(
        WaniKaniError(
            "WaniKani returned 403 for PUT /assignments/42/start",
            status_code=403,
            body={"error": "Forbidden", "code": 403},
        )
    )
    assert response.status_code == 409
    body = response.json()
    assert body["wanikaniStatus"] == 403
    assert body["wanikani"] == {"error": "Forbidden", "code": 403}
    assert "403" in body["detail"]


@pytest.mark.parametrize("status", [500, 503, 429, None])
async def test_a_failure_that_may_pass_stays_a_502(call_start, status):
    response = await call_start(WaniKaniError("WaniKani server error", status_code=status))
    assert response.status_code == 502
    assert response.json()["wanikaniStatus"] == status
