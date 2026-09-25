"""Organising imported words: editing and merging sets, folders, and the
flashcard filters.

The routes run with the repository faked out, because the database tests only
run where TEST_DATABASE_URL is set; the due-card query is checked by compiling
the statement the repository really executes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import httpx2 as httpx
import pytest
from sqlalchemy.dialects import postgresql

from app.api.deps import db_session
from app.db import repository as repo
from app.main import create_app
from app.schemas import VocabSet

NOW = datetime(2026, 9, 25, tzinfo=timezone.utc)
USER = SimpleNamespace(id=1)


def _async(value):
    async def inner(*_args, **_kwargs):
        return value

    return inner


class FakeSession:
    async def flush(self):
        return None

    async def execute(self, _statement):
        return None

    async def delete(self, _row):
        return None


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(repo, "get_default_user", _async(USER))
    app = create_app()

    async def session_override():
        yield FakeSession()

    app.dependency_overrides[db_session] = session_override
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _set_row(set_id: int, **extra):
    return SimpleNamespace(id=set_id, user_id=USER.id, name=f"Set {set_id}", **extra)


async def test_a_partial_edit_touches_only_the_fields_sent(client, monkeypatch):
    seen = {}

    async def fake_update(_session, row, *, name, folder_id, jlpt_level, fields):
        seen.update(fields=fields, folder_id=folder_id, jlpt_level=jlpt_level)
        return row

    monkeypatch.setattr(repo, "get_vocab_set", _async(_set_row(7)))
    monkeypatch.setattr(repo, "update_vocab_set", fake_update)
    monkeypatch.setattr(
        repo, "list_vocab_sets", _async([VocabSet(id=7, name="Set 7", created_at=NOW)])
    )

    async with client:
        response = await client.patch("/api/vocab-sets/7", json={"folderId": None})

    assert response.status_code == 200
    # Sent as null: cleared. Not sent at all: left alone.
    assert seen["fields"] == {"folder_id"}
    assert seen["folder_id"] is None


async def test_filing_into_someone_elses_folder_is_a_404(client, monkeypatch):
    monkeypatch.setattr(repo, "get_vocab_set", _async(_set_row(7)))
    monkeypatch.setattr(repo, "get_vocab_folder", _async(SimpleNamespace(id=3, user_id=99)))

    async with client:
        response = await client.patch("/api/vocab-sets/7", json={"folderId": 3})

    assert response.status_code == 404


async def test_a_jlpt_tag_outside_n1_to_n5_is_rejected(client, monkeypatch):
    monkeypatch.setattr(repo, "get_vocab_set", _async(_set_row(7)))

    async with client:
        response = await client.patch("/api/vocab-sets/7", json={"jlptLevel": 6})

    assert response.status_code == 422


async def test_a_set_cannot_be_merged_into_itself(client):
    async with client:
        response = await client.post("/api/vocab-sets/7/merge", json={"intoSetId": 7})

    assert response.status_code == 422


async def test_the_due_filters_reach_the_repository(client, monkeypatch):
    seen = {}

    async def fake_due(_session, _user_id, **kwargs):
        seen.update(kwargs)
        return []

    monkeypatch.setattr(repo, "get_due_flashcards", fake_due)

    async with client:
        response = await client.get("/api/flashcards/due?folder_id=4&jlpt=3")

    assert response.status_code == 200
    assert seen["folder_id"] == 4 and seen["jlpt_level"] == 3 and seen["set_id"] is None


async def test_the_due_query_scopes_by_folder_and_tier():
    class CapturingSession:
        statement = None

        async def execute(self, statement):
            self.statement = statement
            return SimpleNamespace(all=lambda: [])

    session = CapturingSession()
    await repo.get_due_flashcards(session, 1, folder_id=4, jlpt_level=3, now=NOW)
    sql = str(session.statement.compile(dialect=postgresql.dialect()))

    assert "vocab_sets.folder_id" in sql
    # A tier matches the word's own tag or a tagged set it belongs to.
    assert "vocab_items.jlpt_level" in sql and "vocab_sets.jlpt_level" in sql


async def test_an_automatic_group_name_never_collides(monkeypatch):
    taken = {"Import Sep 25", "Import Sep 25 (2)"}

    async def by_name(_session, *, user_id, name):
        return object() if name in taken else None

    monkeypatch.setattr(repo, "get_vocab_set_by_name", by_name)

    assert await repo.unique_set_name(None, user_id=1, name="Import Sep 25") == "Import Sep 25 (3)"
    assert await repo.unique_set_name(None, user_id=1, name="Lesson 1") == "Lesson 1"
