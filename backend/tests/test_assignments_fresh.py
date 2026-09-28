"""A full refresh goes to WaniKani and puts the server's copy right too.

The phone keeps its copy with diffs, and a diff never recovers a change it
missed; `fresh` is the full pull that does. Without it, a lesson done on the
website stayed a lesson in the app, and starting it was refused every time.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx2 as httpx

from app.api.deps import optional_db_session, wanikani_client
from app.db import repository as repo
from app.main import create_app

RAW = {
    "id": 876055250,
    "data": {
        "subject_id": 440,
        "subject_type": "kanji",
        "srs_stage": 1,
        "unlocked_at": "2026-09-20T00:00:00Z",
        "started_at": "2026-09-25T18:52:07Z",
        "passed_at": None,
        "available_at": "2026-09-25T20:00:00Z",
        "burned_at": None,
    },
}


class FakeClient:
    def __init__(self):
        self.calls = []

    async def get_assignments(self, **kwargs):
        self.calls.append(kwargs)
        return [RAW]


async def test_fresh_pulls_everything_live_and_refreshes_the_server_copy(monkeypatch):
    client = FakeClient()
    stored = []

    async def fake_user(_session):
        return SimpleNamespace(id=1)

    async def fake_upsert(_session, user_id, assignments):
        stored.extend(assignments)
        return len(assignments)

    monkeypatch.setattr(repo, "get_default_user", fake_user)
    monkeypatch.setattr(repo, "upsert_assignments", fake_upsert)

    app = create_app()

    async def session_override():
        yield object()

    app.dependency_overrides[optional_db_session] = session_override
    app.dependency_overrides[wanikani_client] = lambda: client

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        response = await http.get("/api/assignments?fresh=true")

    assert response.status_code == 200
    assert [a["id"] for a in response.json()] == [876055250]
    # Every assignment -- no cursor -- and the server's copy updated with them.
    assert client.calls == [
        {
            "updated_after": None,
            "immediately_available_for_lessons": None,
            "immediately_available_for_review": None,
        }
    ]
    assert [a.id for a in stored] == [876055250]
