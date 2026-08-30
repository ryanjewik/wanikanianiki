"""Import to flashcard to schedule, against real SQL.

The loop this exercises is the product: a page becomes words, words become
cards with answers that count, cards come due, an answer moves them. Each step
is checked where it crosses the database, because that is where the pure
scheduling tests stop being able to see.

Skipped unless `TEST_DATABASE_URL` is set.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import httpx2 as httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import db_session
from app.config import Settings, get_settings
from app.db import repository as repo
from app.db.models import Base
from app.main import create_app
from app.schemas import DetectedItem

RAW_URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not RAW_URL, reason="TEST_DATABASE_URL is not set")


def _async_url() -> str:
    return Settings(wanikani_apikey="test", database_url=RAW_URL).database_url


# Rows as they come off a real vocabulary page.
PAGE = [
    DetectedItem(
        key="免許:めんきょ", kanji_furigana="免許", furigana_only="めんきょ",
        english="license", jlpt_level=3,
    ),
    DetectedItem(
        key="相手:あいて", kanji_furigana="相手", furigana_only="あいて",
        english="partner; the other person", jlpt_level=3,
    ),
    DetectedItem(
        key="苦手な:にがてな", kanji_furigana="苦手な", furigana_only="にがてな",
        english="poor at", usage_context="〜が", jlpt_level=3,
    ),
]


@pytest.fixture
async def ctx(monkeypatch):
    monkeypatch.setenv("wanikani_apikey", "test-token")
    monkeypatch.setenv("DATABASE_URL", RAW_URL)
    get_settings.cache_clear()

    engine = create_async_engine(_async_url())
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session = async_sessionmaker(engine, expire_on_commit=False)()
    async with session.begin():
        user = await repo.upsert_user(
            session, wanikani_user_id="uuid-1", username="ryan",
            level=4, max_level_granted=60, subscription_active=False,
        )

    app = create_app()

    async def _override():
        yield session

    app.dependency_overrides[db_session] = _override

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, session, user

    await session.close()
    await engine.dispose()
    get_settings.cache_clear()


# -- creating cards --------------------------------------------------------


async def test_a_word_becomes_two_cards_and_its_answers(ctx):
    """One import is three writes: the word, what counts, and where it sits.

    A word with no answers is unanswerable and a word with no schedule never
    comes up, so all three have to land together.
    """
    _, session, user = ctx
    created = await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    assert len(created) == 3

    cards = await repo.get_due_flashcards(session, user.id)
    # Recognition and production for each word, both due immediately.
    assert len(cards) == 6
    assert {c.skill_type for c in cards} == {"recognition", "production"}


async def test_production_accepts_the_kanji_or_the_reading(ctx):
    """The rule the answers table exists for."""
    _, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    cards = await repo.get_due_flashcards(session, user.id)
    card = next(c for c in cards
                if c.kanji_furigana == "免許" and c.skill_type == "production")

    assert card.prompt == "license"
    assert set(card.accepted_answers) == {"免許", "めんきょ"}


async def test_recognition_accepts_every_gloss_on_the_line(ctx):
    """'partner; the other person' is two answers, and both must count."""
    _, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    cards = await repo.get_due_flashcards(session, user.id)
    card = next(c for c in cards
                if c.kanji_furigana == "相手" and c.skill_type == "recognition")

    assert card.prompt == "相手"
    assert set(card.accepted_answers) == {"partner", "the other person"}


async def test_the_particle_travels_with_the_card(ctx):
    """[〜が]苦手な loses its point if the particle is dropped."""
    _, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    cards = await repo.get_due_flashcards(session, user.id)
    card = next(c for c in cards if c.kanji_furigana == "苦手な")
    assert card.usage_context == "〜が"


async def test_importing_the_same_word_twice_does_not_duplicate_it(ctx):
    _, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()
    again = await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    assert again == []
    assert len(await repo.get_due_flashcards(session, user.id)) == 6


# -- answering -------------------------------------------------------------


async def test_a_correct_answer_schedules_the_card_forward(ctx):
    client, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    cards = await repo.get_due_flashcards(session, user.id)
    card = next(c for c in cards if c.skill_type == "production"
                and c.kanji_furigana == "免許")

    response = await client.post(
        f"/api/flashcards/{card.srs_state_id}/answer",
        json={"answerGiven": "めんきょ"},
    )
    assert response.status_code == 200
    body = response.json()

    assert body["correct"] is True
    assert body["intervalDays"] == 1
    assert body["repetitions"] == 1
    assert body["lapses"] == 0


async def test_a_wrong_answer_is_graded_wrong_and_counted_as_a_lapse(ctx):
    client, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    cards = await repo.get_due_flashcards(session, user.id)
    card = next(c for c in cards if c.skill_type == "recognition"
                and c.kanji_furigana == "免許")

    body = (await client.post(
        f"/api/flashcards/{card.srs_state_id}/answer",
        json={"answerGiven": "passport"},
    )).json()

    assert body["correct"] is False
    assert body["lapses"] == 1
    # And the card says what would have counted.
    assert body["acceptedAnswers"] == ["license"]


async def test_an_answered_card_leaves_the_due_queue(ctx):
    """The point of a schedule is that it stops asking."""
    client, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    before = await repo.get_due_flashcards(session, user.id)
    await client.post(
        f"/api/flashcards/{before[0].srs_state_id}/answer", json={"correct": True}
    )
    await session.commit()

    after = await repo.get_due_flashcards(session, user.id)
    assert len(after) == len(before) - 1

    # It comes back when it is due, not before.
    later = await repo.get_due_flashcards(
        session, user.id, now=datetime.now(timezone.utc) + timedelta(days=2)
    )
    assert len(later) == len(before)


async def test_the_review_is_logged_with_what_was_typed(ctx):
    """Without the input there is no telling a bad grader from a bad schedule."""
    client, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()

    card = (await repo.get_due_flashcards(session, user.id))[0]
    await client.post(
        f"/api/flashcards/{card.srs_state_id}/answer", json={"answerGiven": "ほげ"}
    )
    await session.commit()

    days = await repo.get_vocab_review_days(session)
    assert days == {datetime.now(timezone.utc).date()}


async def test_answering_an_unknown_card_is_a_404(ctx):
    client, _, _ = ctx
    response = await client.post("/api/flashcards/9999/answer", json={"correct": True})
    assert response.status_code == 404


async def test_an_answer_with_neither_field_is_rejected(ctx):
    client, session, user = ctx
    await repo.create_flashcards(session, PAGE, user_id=user.id)
    await session.commit()
    card = (await repo.get_due_flashcards(session, user.id))[0]

    response = await client.post(f"/api/flashcards/{card.srs_state_id}/answer", json={})
    assert response.status_code == 400


# -- sets ------------------------------------------------------------------


async def test_a_set_reports_its_words_and_pages(ctx):
    client, session, user = ctx

    created = (await client.post(
        "/api/vocab-sets", json={"name": "Quartet I · Lesson 1"}
    ))
    assert created.status_code == 201
    set_id = created.json()["id"]

    await repo.create_flashcards(session, PAGE, user_id=user.id, set_id=set_id)
    await session.commit()

    (summary,) = (await client.get("/api/vocab-sets")).json()
    assert summary["name"] == "Quartet I · Lesson 1"
    assert summary["itemCount"] == 3


async def test_two_sets_cannot_share_a_name(ctx):
    client, _, _ = ctx
    await client.post("/api/vocab-sets", json={"name": "Lesson 1"})
    again = await client.post("/api/vocab-sets", json={"name": "Lesson 1"})
    assert again.status_code == 409
