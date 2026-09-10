"""The two study tracks must never schedule the same word.

This is the rule most likely to be broken by a later change that looks
reasonable in isolation — "answering should always advance something" is an
easy thing to believe. These tests are here to make that change fail loudly.

WaniKani owns the schedule for WaniKani-sourced words. A generated question may
*ask* about one, and that is practice; it must not create or move any local SM-2
state, because two systems with opinions about when 免許 is next due is exactly
the disagreement the split exists to prevent.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.db import repository as repo
from app.db.models import Base, SrsState, VocabItem

RAW_URL = os.environ.get("TEST_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not RAW_URL,
    reason="Needs TEST_DATABASE_URL — this exercises real rows.",
)


@pytest.fixture
async def session():
    """Same shape as the repository integration suite: a real database, dropped
    and recreated, reached only through TEST_DATABASE_URL so a stray
    DATABASE_URL can never be found by accident."""
    engine = create_async_engine(
        Settings(wanikani_apikey="test", database_url=RAW_URL).database_url
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
        await s.commit()

    await engine.dispose()


@pytest.fixture
async def user(session):
    return await repo.upsert_user(
        session,
        wanikani_user_id="uuid-track-split",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=False,
    )


@pytest.mark.asyncio
async def test_a_wanikani_word_is_never_schedulable(session, user):
    """The core rule. A projected WaniKani word has no local schedule, and
    asking about it must not create one."""
    item = VocabItem(
        source="wanikani",
        wanikani_subject_id=8761,
        kanji_furigana="免許",
        furigana_only="めんきょ",
        english="licence",
    )
    session.add(item)
    await session.flush()

    before = await session.execute(select(func.count()).select_from(SrsState))

    states, unscheduled = await repo.schedulable_states(session, user.id, item.id)

    assert states == []
    assert unscheduled is True

    after = await session.execute(select(func.count()).select_from(SrsState))
    assert before.scalar_one() == after.scalar_one(), (
        "schedulable_states created SRS state for a WaniKani word"
    )


@pytest.mark.asyncio
async def test_an_imported_word_with_a_schedule_is_schedulable(session, user):
    """The other half: a confirmed imported word advances normally, and a
    question and a flashcard land on the same rows."""
    item = VocabItem(
        source="ocr_import",
        kanji_furigana="働き始める",
        furigana_only="はたらきはじめる",
        english="to start working",
    )
    session.add(item)
    await session.flush()

    for skill in ("recognition", "production"):
        session.add(
            SrsState(user_id=user.id, vocab_item_id=item.id, skill_type=skill)
        )
    await session.flush()

    states, unscheduled = await repo.schedulable_states(session, user.id, item.id)

    assert unscheduled is False
    assert {s.skill_type for s in states} == {"recognition", "production"}


@pytest.mark.asyncio
async def test_an_unconfirmed_imported_word_gets_no_invented_schedule(session, user):
    """A word with no SRS rows was never confirmed into the deck. Answering a
    question about it must not quietly put it into rotation."""
    item = VocabItem(
        source="ocr_import",
        kanji_furigana="つまり",
        furigana_only="つまり",
        english="in other words",
    )
    session.add(item)
    await session.flush()

    states, unscheduled = await repo.schedulable_states(session, user.id, item.id)

    assert states == []
    assert unscheduled is True


@pytest.mark.asyncio
async def test_a_missing_item_is_unscheduled_rather_than_an_error(session, user):
    """A question pointing at a deleted word should degrade to practice, not
    raise — the bundle it belongs to is still answerable."""
    states, unscheduled = await repo.schedulable_states(session, user.id, 9_999_999)
    assert states == []
    assert unscheduled is True
