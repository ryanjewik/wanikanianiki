"""Repository against a real Postgres.

The other tests mock the transport and never touch a database. This one is the
opposite: no network, but real SQL, so it catches the class of bug the unit
tests structurally cannot — a column the ORM fills in that the schema has no
default for, an upsert whose conflict target does not match a real constraint,
a JSONB round trip that does not survive.

**Skipped unless `TEST_DATABASE_URL` is set.** That is deliberately a different
variable from `DATABASE_URL`: this module drops and recreates every table, and
it must not be able to find a real database by accident.

    TEST_DATABASE_URL=postgresql://postgres@localhost:5432/kanji_test \
      python -m pytest tests/test_repository_integration.py
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.db import repository as repo
from app.db.models import Base
from app.schemas import Assignment, Meaning, Reading, Subject
from app.wanikani.mapping import build_streak

RAW_URL = os.environ.get("TEST_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not RAW_URL, reason="TEST_DATABASE_URL is not set"
)


def _async_url() -> str:
    """Reuse the app's own driver rewriting rather than duplicating it."""
    return Settings(wanikani_apikey="test", database_url=RAW_URL).database_url


@pytest.fixture
async def session():
    engine = create_async_engine(_async_url())
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
        await s.commit()

    await engine.dispose()


def _subject(subject_id: int = 440) -> Subject:
    return Subject(
        id=subject_id,
        type="kanji",
        characters="一",
        level=1,
        slug="one",
        meanings=[Meaning(meaning="one", primary=True, accepted_answer=True)],
        readings=[
            Reading(reading="いち", type="onyomi", primary=True, accepted_answer=True)
        ],
    )


def _assignment(assignment_id: int = 90001, subject_id: int = 440) -> Assignment:
    now = datetime.now(timezone.utc)
    return Assignment(
        id=assignment_id,
        subject_id=subject_id,
        subject_type="kanji",
        srs_stage=1,
        unlocked_at=now,
        started_at=now,
        available_at=now,
    )


async def test_subject_round_trip_preserves_jsonb(session):
    await repo.upsert_subjects(session, [_subject()])
    (loaded,) = await repo.get_subjects_by_ids(session, [440])

    assert loaded.characters == "一"
    assert loaded.meanings[0].meaning == "one"
    assert loaded.readings[0].reading == "いち"
    # Defaulted JSONB lists come back as lists, not None.
    assert loaded.component_subject_ids == []


async def test_upserts_are_idempotent(session):
    user = await repo.upsert_user(
        session,
        wanikani_user_id="uuid-1",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=True,
    )
    await repo.upsert_subjects(session, [_subject()])

    await repo.upsert_assignments(session, user.id, [_assignment()])
    await repo.upsert_assignments(session, user.id, [_assignment()])

    # The unique constraint is on (user_id, assignment_id), so a second sync of
    # the same assignment must update rather than duplicate.
    assert len(await repo.get_assignments(session, user.id)) == 1


async def test_review_log_drives_the_streak(session):
    user = await repo.upsert_user(
        session,
        wanikani_user_id="uuid-1",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=False,
    )
    await repo.upsert_subjects(session, [_subject()])
    await repo.upsert_assignments(session, user.id, [_assignment()])

    progress = await repo.get_progress_by_assignment(session, user.id, 90001)
    assert progress is not None

    await repo.log_review(
        session,
        study_progress_id=progress.id,
        incorrect_meaning=1,
        incorrect_reading=0,
        starting_srs_stage=1,
        ending_srs_stage=2,
    )

    days = await repo.get_review_days(session)
    assert days == {datetime.now(timezone.utc).date()}


async def test_sync_meta_upserts_in_place(session):
    await repo.set_sync_meta(session, "last_synced_at", "2026-01-01T00:00:00+00:00")
    await repo.set_sync_meta(session, "last_synced_at", "2026-02-02T00:00:00+00:00")

    value = await repo.get_sync_meta(session, "last_synced_at")
    assert value.startswith("2026-02-02")


async def test_queues_split_started_from_unstarted(session):
    user = await repo.upsert_user(
        session,
        wanikani_user_id="uuid-1",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=False,
    )
    await repo.upsert_subjects(session, [_subject(440), _subject(441)])

    started = _assignment(90001, 440)

    # An assignment that has not been started yet carries no `available_at` —
    # WaniKani only schedules a first review once the lesson is finished. Both
    # queue queries lean on that, so the fixture has to reflect it.
    unstarted = _assignment(90002, 441)
    unstarted.started_at = None
    unstarted.available_at = None
    unstarted.srs_stage = 0

    await repo.upsert_assignments(session, user.id, [started, unstarted])

    review_ids = {a.id for a in await repo.get_review_queue(session, user.id)}
    lesson_ids = {a.id for a in await repo.get_lesson_queue(session, user.id)}

    assert review_ids == {90001}
    assert lesson_ids == {90002}


async def test_review_days_are_bucketed_in_the_users_zone(session):
    """An evening session belongs to that evening, not to UTC's tomorrow.

    Real SQL rather than a unit test on purpose: the conversion happens in
    Postgres, and whether `timezone(name, timestamptz)` lands where we think is
    exactly the thing a mock would fake rather than verify.
    """
    user = await repo.upsert_user(
        session,
        wanikani_user_id="uuid-tz",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=False,
    )
    await repo.upsert_subjects(session, [_subject()])
    await repo.upsert_assignments(session, user.id, [_assignment()])
    progress = await repo.get_progress_by_assignment(session, user.id, 90001)
    assert progress is not None

    # 18:30 on the 3rd in Los Angeles; already the 4th in UTC.
    await repo.log_review(
        session,
        study_progress_id=progress.id,
        incorrect_meaning=0,
        incorrect_reading=0,
        starting_srs_stage=1,
        ending_srs_stage=2,
        created_at=datetime(2026, 9, 4, 1, 30, tzinfo=timezone.utc),
    )

    assert await repo.get_review_days(session, "UTC") == {date(2026, 9, 4)}
    assert await repo.get_review_days(session, "America/Los_Angeles") == {
        date(2026, 9, 3)
    }
    # An unusable zone is ignored rather than raising mid-dashboard.
    assert await repo.get_review_days(session, "Mars/Olympus_Mons") == {
        date(2026, 9, 4)
    }


async def test_two_evenings_running_are_two_days_not_one(session):
    """The failure the streak actually shows: consecutive evenings, one UTC day.

    Both sessions fall on 2026-09-04 in UTC, so a UTC-bucketed streak sees a
    single day with a gap behind it. In the user's own zone they are the 3rd and
    the 4th — an unbroken two-day run.
    """
    user = await repo.upsert_user(
        session,
        wanikani_user_id="uuid-tz2",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=False,
    )
    await repo.upsert_subjects(session, [_subject()])
    await repo.upsert_assignments(session, user.id, [_assignment()])
    progress = await repo.get_progress_by_assignment(session, user.id, 90001)
    assert progress is not None

    for moment in (
        datetime(2026, 9, 4, 1, 30, tzinfo=timezone.utc),   # 18:30 on the 3rd, PDT
        datetime(2026, 9, 4, 20, 0, tzinfo=timezone.utc),   # 13:00 on the 4th, PDT
    ):
        await repo.log_review(
            session,
            study_progress_id=progress.id,
            incorrect_meaning=0,
            incorrect_reading=0,
            starting_srs_stage=1,
            ending_srs_stage=2,
            created_at=moment,
        )

    assert await repo.get_review_days(session, "UTC") == {date(2026, 9, 4)}

    local = await repo.get_review_days(session, "America/Los_Angeles")
    assert local == {date(2026, 9, 3), date(2026, 9, 4)}
    assert build_streak(local, today=date(2026, 9, 4)).days == 2


async def test_the_device_zone_is_adopted_and_persisted(session):
    """Reported per request, so a move between zones corrects itself."""
    user = await repo.upsert_user(
        session,
        wanikani_user_id="uuid-adopt",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=False,
    )
    # Every account starts where the old behaviour left it.
    assert user.timezone == "UTC"

    assert await repo.adopt_timezone(session, user, "America/Los_Angeles") == (
        "America/Los_Angeles"
    )
    await session.flush()
    session.expire(user)
    assert (await repo.get_default_user(session)).timezone == "America/Los_Angeles"

    # Moving is just the next report.
    assert await repo.adopt_timezone(session, user, "Asia/Tokyo") == "Asia/Tokyo"


async def test_an_unusable_zone_never_clobbers_a_good_one(session):
    """A client that cannot name its zone should not reset one that was right."""
    user = await repo.upsert_user(
        session,
        wanikani_user_id="uuid-keep",
        username="ryan",
        level=4,
        max_level_granted=60,
        subscription_active=False,
    )
    await repo.adopt_timezone(session, user, "Asia/Tokyo")

    for junk in (None, "", "Mars/Olympus_Mons"):
        assert await repo.adopt_timezone(session, user, junk) == "Asia/Tokyo"
