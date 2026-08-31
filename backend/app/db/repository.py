"""Persistence operations.

All writes are upserts keyed on WaniKani's own ids, so any sync can be replayed
safely — a poll that overlaps a previous one, or a full re-pull after a reset,
converges to the same rows instead of duplicating them.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    SYNC_KEY_LAST_SYNCED,
    ReviewLog,
    StudyProgress,
    SyncMeta,
    User,
    VocabItem,
    VocabSource,
)
from app.db.models import (
    Subject as SubjectRow,
)
from app.schemas import Assignment, DetectedItem, Subject
from app.schemas import VocabItem as VocabItemOut

# -- users -----------------------------------------------------------------


async def upsert_user(
    session: AsyncSession,
    *,
    wanikani_user_id: str,
    username: str,
    level: int,
    max_level_granted: int,
    subscription_active: bool,
) -> User:
    result = await session.execute(
        select(User).where(User.wanikani_user_id == wanikani_user_id)
    )
    user = result.scalar_one_or_none()

    if user is None:
        user = User(wanikani_user_id=wanikani_user_id, username=username)
        session.add(user)

    user.username = username
    user.level = level
    user.max_level_granted = max_level_granted
    user.subscription_active = subscription_active

    await session.flush()
    return user


async def get_default_user(session: AsyncSession) -> User | None:
    """The app is single-user for now, so "the user" is simply the first row."""
    result = await session.execute(select(User).order_by(User.id).limit(1))
    return result.scalar_one_or_none()


# -- subjects --------------------------------------------------------------


async def upsert_subjects(
    session: AsyncSession,
    subjects: Sequence[Subject],
    *,
    updated_at: dict[int, datetime] | None = None,
) -> int:
    if not subjects:
        return 0

    updated_at = updated_at or {}
    rows = [
        {
            "subject_id": s.id,
            "type": s.type,
            "characters": s.characters,
            "character_image_url": s.character_image_url,
            "level": s.level,
            "slug": s.slug,
            "meanings": [m.model_dump(by_alias=False) for m in s.meanings],
            "readings": [r.model_dump(by_alias=False) for r in s.readings],
            "meaning_mnemonic": s.meaning_mnemonic,
            "reading_mnemonic": s.reading_mnemonic,
            "meaning_hint": s.meaning_hint,
            "reading_hint": s.reading_hint,
            "component_subject_ids": s.component_subject_ids,
            "amalgamation_subject_ids": s.amalgamation_subject_ids,
            "data_updated_at": updated_at.get(s.id),
            "synced_at": datetime.now(timezone.utc),
        }
        for s in subjects
    ]

    statement = pg_insert(SubjectRow).values(rows)
    # jlpt_level is intentionally absent from the update set: it comes from a
    # separate seed import, and a WaniKani sync must not wipe it.
    statement = statement.on_conflict_do_update(
        index_elements=[SubjectRow.subject_id],
        set_={
            column: statement.excluded[column]
            for column in (
                "type", "characters", "character_image_url", "level", "slug",
                "meanings", "readings", "meaning_mnemonic", "reading_mnemonic",
                "meaning_hint", "reading_hint", "component_subject_ids",
                "amalgamation_subject_ids", "data_updated_at", "synced_at",
            )
        },
    )
    await session.execute(statement)
    return len(rows)


async def get_subjects_by_ids(session: AsyncSession, ids: Iterable[int]) -> list[Subject]:
    ids = list(ids)
    if not ids:
        return []
    result = await session.execute(
        select(SubjectRow).where(SubjectRow.subject_id.in_(ids))
    )
    return [_to_subject(row) for row in result.scalars()]


async def get_subjects_by_level(session: AsyncSession, level: int) -> list[Subject]:
    result = await session.execute(
        select(SubjectRow).where(SubjectRow.level == level).order_by(SubjectRow.subject_id)
    )
    return [_to_subject(row) for row in result.scalars()]


async def get_known_subject_ids(session: AsyncSession) -> set[int]:
    result = await session.execute(select(SubjectRow.subject_id))
    return set(result.scalars())


def _to_subject(row: SubjectRow) -> Subject:
    return Subject(
        id=row.subject_id,
        type=row.type,
        characters=row.characters,
        character_image_url=row.character_image_url,
        level=row.level,
        slug=row.slug,
        meanings=row.meanings or [],
        readings=row.readings or [],
        meaning_mnemonic=row.meaning_mnemonic,
        reading_mnemonic=row.reading_mnemonic,
        meaning_hint=row.meaning_hint,
        reading_hint=row.reading_hint,
        component_subject_ids=row.component_subject_ids or [],
        amalgamation_subject_ids=row.amalgamation_subject_ids or [],
        jlpt_level=row.jlpt_level,
    )


# -- assignments -----------------------------------------------------------


async def upsert_assignments(
    session: AsyncSession, user_id: int, assignments: Sequence[Assignment]
) -> int:
    if not assignments:
        return 0

    rows = [
        {
            "user_id": user_id,
            "subject_id": a.subject_id,
            "assignment_id": a.id,
            "subject_type": a.subject_type,
            "srs_stage": a.srs_stage,
            "unlocked_at": a.unlocked_at,
            "started_at": a.started_at,
            "passed_at": a.passed_at,
            "available_at": a.available_at,
            "burned_at": a.burned_at,
            "synced_at": datetime.now(timezone.utc),
        }
        for a in assignments
    ]

    statement = pg_insert(StudyProgress).values(rows)
    statement = statement.on_conflict_do_update(
        constraint="uq_progress_user_assignment",
        set_={
            column: statement.excluded[column]
            for column in (
                "subject_id", "subject_type", "srs_stage", "unlocked_at",
                "started_at", "passed_at", "available_at", "burned_at", "synced_at",
            )
        },
    )
    await session.execute(statement)
    return len(rows)


async def get_assignments(session: AsyncSession, user_id: int) -> list[Assignment]:
    result = await session.execute(
        select(StudyProgress).where(StudyProgress.user_id == user_id)
    )
    return [_to_assignment(row) for row in result.scalars()]


async def get_lesson_queue(
    session: AsyncSession, user_id: int, limit: int = 100
) -> list[Assignment]:
    """Unlocked but never started."""
    result = await session.execute(
        select(StudyProgress)
        .where(
            StudyProgress.user_id == user_id,
            StudyProgress.started_at.is_(None),
            StudyProgress.unlocked_at.is_not(None),
        )
        .order_by(StudyProgress.unlocked_at)
        .limit(limit)
    )
    return [_to_assignment(row) for row in result.scalars()]


async def get_review_queue(
    session: AsyncSession, user_id: int, limit: int = 500
) -> list[Assignment]:
    """Due now — `available_at` has already passed."""
    result = await session.execute(
        select(StudyProgress)
        .where(
            StudyProgress.user_id == user_id,
            StudyProgress.available_at.is_not(None),
            StudyProgress.available_at <= datetime.now(timezone.utc),
        )
        .order_by(StudyProgress.available_at)
        .limit(limit)
    )
    return [_to_assignment(row) for row in result.scalars()]


async def get_progress_by_assignment(
    session: AsyncSession, user_id: int, assignment_id: int
) -> StudyProgress | None:
    result = await session.execute(
        select(StudyProgress).where(
            StudyProgress.user_id == user_id,
            StudyProgress.assignment_id == assignment_id,
        )
    )
    return result.scalar_one_or_none()


def _to_assignment(row: StudyProgress) -> Assignment:
    return Assignment(
        id=row.assignment_id,
        subject_id=row.subject_id,
        subject_type=row.subject_type,
        srs_stage=row.srs_stage,
        unlocked_at=row.unlocked_at,
        started_at=row.started_at,
        passed_at=row.passed_at,
        available_at=row.available_at,
        burned_at=row.burned_at,
    )


# -- review log ------------------------------------------------------------


async def log_review(
    session: AsyncSession,
    *,
    study_progress_id: int,
    incorrect_meaning: int,
    incorrect_reading: int,
    starting_srs_stage: int | None,
    ending_srs_stage: int | None,
    created_at: datetime | None = None,
) -> None:
    session.add(
        ReviewLog(
            study_progress_id=study_progress_id,
            incorrect_meaning=incorrect_meaning,
            incorrect_reading=incorrect_reading,
            starting_srs_stage=starting_srs_stage,
            ending_srs_stage=ending_srs_stage,
            created_at=created_at or datetime.now(timezone.utc),
        )
    )


async def get_review_days(session: AsyncSession, limit_days: int = 400) -> set[date]:
    """Distinct dates with at least one answered review — the streak source.

    Grouped in SQL rather than pulling every row, since this is called on every
    dashboard load and the log grows without bound.
    """
    result = await session.execute(
        select(func.date(ReviewLog.created_at))
        .group_by(func.date(ReviewLog.created_at))
        .order_by(func.date(ReviewLog.created_at).desc())
        .limit(limit_days)
    )
    days: set[date] = set()
    for value in result.scalars():
        if isinstance(value, date):
            days.add(value)
        elif isinstance(value, str):
            days.add(date.fromisoformat(value))
    return days


# -- sync cursors ----------------------------------------------------------


async def get_sync_meta(session: AsyncSession, key: str) -> str | None:
    result = await session.execute(select(SyncMeta.value).where(SyncMeta.key == key))
    return result.scalar_one_or_none()


async def set_sync_meta(session: AsyncSession, key: str, value: str) -> None:
    statement = pg_insert(SyncMeta).values(key=key, value=value)
    statement = statement.on_conflict_do_update(
        index_elements=[SyncMeta.key],
        set_={"value": statement.excluded.value, "updated_at": func.now()},
    )
    await session.execute(statement)


async def get_last_synced_at(session: AsyncSession) -> datetime | None:
    raw = await get_sync_meta(session, SYNC_KEY_LAST_SYNCED)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


# -- photo import ----------------------------------------------------------


async def create_vocab_source(
    session: AsyncSession,
    *,
    user_id: int,
    image_uri: str | None = None,
    jlpt_level: int | None = None,
    label: str | None = None,
) -> VocabSource:
    """Record the upload before anything has been read from it.

    The row exists in `pending` from the moment the bytes land, which is what
    lets the client poll for a result instead of holding a request open for the
    length of a vision call.
    """
    row = VocabSource(
        user_id=user_id,
        image_uri=image_uri,
        jlpt_level=jlpt_level,
        label=label,
        status="pending",
    )
    session.add(row)
    await session.flush()
    return row


async def get_vocab_source(session: AsyncSession, source_id: int) -> VocabSource | None:
    return await session.get(VocabSource, source_id)


async def set_vocab_source_status(
    session: AsyncSession, source_id: int, status: str
) -> None:
    source = await session.get(VocabSource, source_id)
    if source is not None:
        source.status = status


async def get_known_written_forms(session: AsyncSession) -> set[str]:
    """Every word already in the deck, for duplicate detection.

    Keyed on the written form rather than the reading, so 橋 and 箸 stay
    distinct even though they read the same.
    """
    result = await session.execute(select(VocabItem.kanji_furigana))
    return set(result.scalars())


async def insert_vocab_items(
    session: AsyncSession,
    items: Sequence[DetectedItem],
    *,
    source_image_id: int | None = None,
) -> list[VocabItemOut]:
    """Commit reviewed rows into the deck.

    Skips anything already present rather than raising: the review screen marks
    duplicates, but the deck can have moved on between extraction and confirm,
    and a late duplicate is not worth failing the whole import over.
    """
    if not items:
        return []

    existing = await get_known_written_forms(session)
    rows = [
        VocabItem(
            source="ocr_import",
            kanji_furigana=item.kanji_furigana,
            furigana_only=item.furigana_only,
            english=item.english,
            usage_context=item.usage_context,
            jlpt_level=item.jlpt_level,
            source_image_id=source_image_id,
            is_user_edited=False,
        )
        for item in items
        if item.kanji_furigana not in existing
    ]
    if not rows:
        return []

    session.add_all(rows)
    await session.flush()
    return [_to_vocab_item(row) for row in rows]


async def get_vocab_items(
    session: AsyncSession, *, source_image_id: int | None = None
) -> list[VocabItemOut]:
    statement = select(VocabItem)
    if source_image_id is not None:
        statement = statement.where(VocabItem.source_image_id == source_image_id)
    result = await session.execute(statement.order_by(VocabItem.id))
    return [_to_vocab_item(row) for row in result.scalars()]


def _to_vocab_item(row: VocabItem) -> VocabItemOut:
    return VocabItemOut(
        id=row.id,
        source=row.source,
        wanikani_subject_id=row.wanikani_subject_id,
        kanji_furigana=row.kanji_furigana,
        furigana_only=row.furigana_only,
        english=row.english,
        usage_context=row.usage_context,
        source_image_id=row.source_image_id,
        is_user_edited=row.is_user_edited,
        jlpt_level=row.jlpt_level,
        updated_at=row.updated_at,
    )


async def table_counts(session: AsyncSession) -> dict[str, Any]:
    """Cheap introspection for the health endpoint."""
    subjects = await session.scalar(select(func.count()).select_from(SubjectRow))
    progress = await session.scalar(select(func.count()).select_from(StudyProgress))
    vocab = await session.scalar(select(func.count()).select_from(VocabItem))
    return {
        "subjects": subjects or 0,
        "study_progress": progress or 0,
        "vocab_items": vocab or 0,
    }
