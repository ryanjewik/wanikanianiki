"""The photo-import endpoints, end to end against real SQL.

Covers the contract `mobile/src/data/api.ts` is written against: upload
returns immediately with a source id, the client polls until the rows appear,
and confirm commits only what the user kept.

Skipped unless `TEST_DATABASE_URL` is set — see
`tests/test_repository_integration.py` for why that is a separate variable.
"""

from __future__ import annotations

import os
from types import SimpleNamespace

import httpx2 as httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import db_session
from app.config import Settings, get_settings
from app.db import repository as repo
from app.db.models import Base
from app.main import create_app
from app.services import ocr as ocr_service
from app.services.ocr import ExtractedPage, ExtractedRow

RAW_URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not RAW_URL, reason="TEST_DATABASE_URL is not set")

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _async_url() -> str:
    return Settings(wanikani_apikey="test", database_url=RAW_URL).database_url


class FakeMessages:
    def __init__(self, rows):
        self._rows = rows

    async def parse(self, **kwargs):
        return SimpleNamespace(
            stop_reason="end_turn", parsed_output=ExtractedPage(rows=self._rows)
        )


@pytest.fixture
async def client(monkeypatch):
    """The app over an in-process ASGI transport.

    Not starlette's `TestClient`: that drives the app from a worker thread on
    its own event loop, and an asyncpg connection belongs to the loop that
    opened it — so the session built here would be unusable inside a request.
    An `ASGITransport` keeps the test, the app, and the database on one loop.
    """
    monkeypatch.setenv("wanikani_apikey", "test-token")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", RAW_URL)
    get_settings.cache_clear()

    engine = create_async_engine(_async_url())
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # One session for the whole test, so writes made by a background task are
    # visible to the next request without depending on transaction timing.
    session = async_sessionmaker(engine, expire_on_commit=False)()
    async with session.begin():
        await repo.upsert_user(
            session, wanikani_user_id="uuid-1", username="ryan",
            level=4, max_level_granted=60, subscription_active=False,
        )

    app = create_app()

    async def _session_override():
        yield session

    app.dependency_overrides[db_session] = _session_override

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c

    await session.close()
    await engine.dispose()
    # The background task builds its own engine off the app's session factory;
    # dispose it too or its connections outlive the test's event loop.
    from app.db.session import dispose_engine

    await dispose_engine()
    get_settings.cache_clear()
    ocr_service._CACHE.clear()
    ocr_service._FAILURES.clear()


def _stub_extraction(monkeypatch, rows):
    """Replace only the vendor client; the rest of the pipeline runs for real."""
    monkeypatch.setattr(
        ocr_service,
        "_client",
        lambda settings: SimpleNamespace(messages=FakeMessages(rows)),
    )


ROWS = [
    ExtractedRow(kanji_furigana="食べる", furigana_only="たべる",
                 english="to eat", ambiguous=False),
    ExtractedRow(kanji_furigana="辛い", furigana_only="", english="spicy; painful",
                 ambiguous=True, reading_choices=["からい", "つらい"]),
]


async def test_upload_returns_immediately_then_rows_appear(client, monkeypatch):
    _stub_extraction(monkeypatch, ROWS)

    upload = await client.post(
        "/api/vocab-sources",
        files={"image": ("page.png", PNG, "image/png")},
        data={"jlpt_level": "5"},
    )

    # 202, not 200: the work has been accepted, not finished.
    assert upload.status_code == 202
    body = upload.json()
    source_id = body["sourceId"]
    assert body["status"] == "pending"
    assert body["items"] == []

    # TestClient runs background tasks before returning, so by now it is done.
    poll = await client.get(f"/api/vocab-sources/{source_id}")
    assert poll.status_code == 200
    result = poll.json()
    assert result["status"] == "processed"

    kanji = {item["kanjiFurigana"] for item in result["items"]}
    assert kanji == {"食べる", "辛い"}

    ambiguous = next(i for i in result["items"] if i["kanjiFurigana"] == "辛い")
    assert ambiguous["status"] == "ambiguous"
    assert ambiguous["selected"] is False
    assert ambiguous["readingChoices"] == ["からい", "つらい"]
    # The upload-time tier reached the rows.
    assert all(i["jlptLevel"] == 5 for i in result["items"])


async def test_confirm_commits_only_the_kept_rows(client, monkeypatch):
    _stub_extraction(monkeypatch, ROWS)

    source_id = (
        await client.post(
            "/api/vocab-sources", files={"image": ("p.png", PNG, "image/png")}
        )
    ).json()["sourceId"]
    items = (await client.get(f"/api/vocab-sources/{source_id}")).json()["items"]

    # The user resolves the ambiguous reading and keeps both rows.
    for item in items:
        item["selected"] = True
        if item["status"] == "ambiguous":
            item["furiganaOnly"] = "からい"
            item["status"] = "ok"

    confirmed = await client.post(
        f"/api/vocab-sources/{source_id}/confirm", json={"items": items}
    )
    assert confirmed.status_code == 200

    created = confirmed.json()
    assert len(created) == 2
    assert all(row["source"] == "ocr_import" for row in created)
    assert all(row["sourceImageId"] == source_id for row in created)
    # The user's correction is what was stored, not the model's blank.
    spicy = next(r for r in created if r["kanjiFurigana"] == "辛い")
    assert spicy["furiganaOnly"] == "からい"


async def test_deselected_rows_are_not_imported(client, monkeypatch):
    _stub_extraction(monkeypatch, ROWS)

    source_id = (
        await client.post(
            "/api/vocab-sources", files={"image": ("p.png", PNG, "image/png")}
        )
    ).json()["sourceId"]
    items = (await client.get(f"/api/vocab-sources/{source_id}")).json()["items"]

    created = (
        await client.post(
            f"/api/vocab-sources/{source_id}/confirm", json={"items": items}
        )
    ).json()

    # Only the unambiguous row was selected by default.
    assert [row["kanjiFurigana"] for row in created] == ["食べる"]


async def test_reimporting_the_same_page_marks_duplicates(client, monkeypatch):
    _stub_extraction(monkeypatch, ROWS)

    first = (
        await client.post(
            "/api/vocab-sources", files={"image": ("p.png", PNG, "image/png")}
        )
    ).json()["sourceId"]
    items = (await client.get(f"/api/vocab-sources/{first}")).json()["items"]
    await client.post(f"/api/vocab-sources/{first}/confirm", json={"items": items})

    second = (
        await client.post(
            "/api/vocab-sources", files={"image": ("p.png", PNG, "image/png")}
        )
    ).json()["sourceId"]
    again = (await client.get(f"/api/vocab-sources/{second}")).json()["items"]

    eat = next(i for i in again if i["kanjiFurigana"] == "食べる")
    assert eat["status"] == "duplicate"
    assert eat["selected"] is False


async def test_a_non_image_upload_is_rejected(client):
    response = await client.post(
        "/api/vocab-sources",
        files={"image": ("notes.txt", b"just text", "text/plain")},
    )
    assert response.status_code == 415


async def test_an_empty_upload_is_rejected(client):
    response = await client.post(
        "/api/vocab-sources", files={"image": ("p.png", b"", "image/png")}
    )
    assert response.status_code == 400


async def test_polling_an_unknown_source_is_a_404(client):
    assert (await client.get("/api/vocab-sources/9999")).status_code == 404


async def test_a_lost_buffer_fails_rather_than_hanging_on_pending(client, monkeypatch):
    """The image buffer is process-local.

    If the extraction runs somewhere the bytes are not — which is exactly what
    happens the day `ocr-fn` becomes its own function — the row must fail
    visibly, not sit on `pending` while the app polls forever.
    """
    _stub_extraction(monkeypatch, ROWS)
    from app.services import storage

    # Drop the bytes between upload and extraction. monkeypatch restores it.
    monkeypatch.setattr(storage, "hold", lambda *a, **k: None)

    source_id = (
        await client.post(
            "/api/vocab-sources", files={"image": ("p.png", PNG, "image/png")}
        )
    ).json()["sourceId"]

    result = (await client.get(f"/api/vocab-sources/{source_id}")).json()
    assert result["status"] == "failed"
    assert "Upload it again" in result["detail"]


async def test_extraction_failure_is_reported_not_raised(client, monkeypatch):
    """A vendor failure must reach the client as `failed`, not a 500."""
    def _boom(settings):
        raise ocr_service.ExtractionFailed("The image was rejected: too large")

    monkeypatch.setattr(ocr_service, "_client", _boom)

    source_id = (
        await client.post(
            "/api/vocab-sources", files={"image": ("p.png", PNG, "image/png")}
        )
    ).json()["sourceId"]

    result = (await client.get(f"/api/vocab-sources/{source_id}")).json()
    assert result["status"] == "failed"
    assert "too large" in result["detail"]
    assert result["items"] == []


async def test_set_items_lists_what_was_imported_into_the_set(client, monkeypatch):
    """A page photographed into a set is browsable as that set's words."""
    _stub_extraction(monkeypatch, ROWS)

    set_id = (
        await client.post("/api/vocab-sets", json={"name": "Quartet I, Lesson 1"})
    ).json()["id"]

    source_id = (
        await client.post(
            "/api/vocab-sources",
            files={"image": ("p.png", PNG, "image/png")},
            data={"set_id": str(set_id)},
        )
    ).json()["sourceId"]
    items = (await client.get(f"/api/vocab-sources/{source_id}")).json()["items"]
    for item in items:
        item["selected"] = True
        if item["status"] == "ambiguous":
            item["furiganaOnly"] = "からい"
            item["status"] = "ok"
    await client.post(f"/api/vocab-sources/{source_id}/confirm", json={"items": items})

    listed = await client.get(f"/api/vocab-sets/{set_id}/items")
    assert listed.status_code == 200
    assert [row["kanjiFurigana"] for row in listed.json()] == ["食べる", "辛い"]

    # The set list's own count agrees with the rows the browser gets.
    sets = (await client.get("/api/vocab-sets")).json()
    assert next(s for s in sets if s["id"] == set_id)["itemCount"] == 2


async def test_set_items_is_empty_for_a_set_nothing_was_imported_into(client):
    set_id = (
        await client.post("/api/vocab-sets", json={"name": "Empty"})
    ).json()["id"]

    listed = await client.get(f"/api/vocab-sets/{set_id}/items")
    assert listed.status_code == 200
    assert listed.json() == []


async def test_set_items_404s_for_an_unknown_set(client):
    assert (await client.get("/api/vocab-sets/9999/items")).status_code == 404
