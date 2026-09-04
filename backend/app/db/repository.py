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
    SrsState,
    StudyProgress,
    SyncMeta,
    User,
    VocabAnswer,
    VocabItem,
    VocabReviewLog,
    VocabSet,
    VocabSetItem,
    VocabSource,
)
from app.db.models import (
    Subject as SubjectRow,
)
from app.schemas import Assignment, DetectedItem, Flashcard, Subject
from app.schemas import VocabItem as VocabItemOut
from app.schemas import VocabSet as VocabSetOut

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
    set_id: int | None = None,
    position: int = 0,
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
        set_id=set_id,
        position=position,
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


# -- sets ------------------------------------------------------------------


async def create_vocab_set(
    session: AsyncSession, *, user_id: int, name: str, description: str | None = None
) -> VocabSet:
    row = VocabSet(user_id=user_id, name=name, description=description)
    session.add(row)
    await session.flush()
    return row


async def get_vocab_set(session: AsyncSession, set_id: int) -> VocabSet | None:
    return await session.get(VocabSet, set_id)


async def get_vocab_set_by_name(
    session: AsyncSession, *, user_id: int, name: str
) -> VocabSet | None:
    result = await session.execute(
        select(VocabSet).where(VocabSet.user_id == user_id, VocabSet.name == name)
    )
    return result.scalar_one_or_none()


async def list_vocab_sets(session: AsyncSession, user_id: int) -> list[VocabSetOut]:
    """Sets with their counts, in one pass.

    The page counts are what make a multi-page import legible while it runs:
    "5 pages, 2 still reading" is the honest state, and it comes from the
    sources' own statuses rather than a progress field that could drift.
    """
    items = dict(
        (
            await session.execute(
                select(VocabSetItem.set_id, func.count())
                .group_by(VocabSetItem.set_id)
            )
        ).all()
    )
    pages: dict[int, dict[str, int]] = {}
    rows = await session.execute(
        select(VocabSource.set_id, VocabSource.status, func.count())
        .where(VocabSource.set_id.is_not(None))
        .group_by(VocabSource.set_id, VocabSource.status)
    )
    for set_id, status, count in rows.all():
        bucket = pages.setdefault(set_id, {"total": 0, "pending": 0, "failed": 0})
        bucket["total"] += count
        if status == "pending":
            bucket["pending"] += count
        elif status == "failed":
            bucket["failed"] += count

    result = await session.execute(
        select(VocabSet)
        .where(VocabSet.user_id == user_id)
        .order_by(VocabSet.created_at.desc())
    )
    out = []
    for row in result.scalars():
        page = pages.get(row.id, {"total": 0, "pending": 0, "failed": 0})
        out.append(
            VocabSetOut(
                id=row.id,
                name=row.name,
                description=row.description,
                created_at=row.created_at,
                item_count=items.get(row.id, 0),
                page_count=page["total"],
                pages_pending=page["pending"],
                pages_failed=page["failed"],
            )
        )
    return out


async def list_vocab_set_items(session: AsyncSession, set_id: int) -> list[VocabItemOut]:
    """The words in one set, oldest membership first.

    Ordered by when the word joined the set rather than by id: a set is filled
    page by page, so membership order is the order the pages were read, which is
    the order the textbook prints them. Sorting by `vocab_items.id` would
    instead interleave anything that was already in the deck from another
    import.
    """
    result = await session.execute(
        select(VocabItem)
        .join(VocabSetItem, VocabSetItem.vocab_item_id == VocabItem.id)
        .where(VocabSetItem.set_id == set_id)
        .order_by(VocabSetItem.added_at, VocabItem.id)
    )
    return [_to_vocab_item(row) for row in result.scalars()]


# -- flashcards ------------------------------------------------------------

# Both skills are created up front rather than production being unlocked by
# recognition. They are independent ladders by design, and gating one on the
# other would be reintroducing WaniKani's staging into a system deliberately
# kept separate from it.
SKILL_TYPES = ("recognition", "production")


def _answers_for(item: DetectedItem) -> list[VocabAnswer]:
    """Every string that should count as right for this word.

    The written form and the reading are both `written`/`reading` answers, which
    is what makes "kanji or furigana, either is fine" true without the grader
    knowing anything special. The meaning is split on semicolons first, because
    "partner; the other person" is two answers and storing it whole makes the
    second one impossible to give.
    """
    from app.services.srs import split_meanings

    answers: list[VocabAnswer] = []

    if item.kanji_furigana.strip():
        answers.append(
            VocabAnswer(kind="written", value=item.kanji_furigana, is_primary=True)
        )
    if item.furigana_only.strip() and item.furigana_only != item.kanji_furigana:
        answers.append(
            VocabAnswer(kind="reading", value=item.furigana_only, is_primary=True)
        )

    for index, meaning in enumerate(split_meanings(item.english)):
        answers.append(
            VocabAnswer(kind="meaning", value=meaning, is_primary=index == 0)
        )
    return answers


async def create_flashcards(
    session: AsyncSession,
    items: Sequence[DetectedItem],
    *,
    user_id: int,
    source_image_id: int | None = None,
    set_id: int | None = None,
) -> list[VocabItemOut]:
    """Commit reviewed rows as studiable cards.

    One call because the three writes are one fact: a word in the deck, the
    answers that count for it, and a place in the schedule for each skill. A
    word with no answers is unanswerable and a word with no SRS state never
    comes up, so a partial write here is a silently broken card.

    Skips words already in the deck rather than raising: the review screen marks
    duplicates, but the deck can move on between extraction and confirm, and a
    late duplicate is not worth failing an import over.
    """
    if not items:
        return []

    existing = await get_known_written_forms(session)

    # Deduplicate the batch itself, not just against the deck. The review
    # screen marks repeats, but it sends back whatever the user confirmed, and
    # a page that lists つまり twice would otherwise insert two rows for one
    # word — each with its own SRS state, so the schedules would diverge and
    # neither would be the word's real progress.
    fresh: list[DetectedItem] = []
    seen: set[str] = set()
    for item in items:
        if item.kanji_furigana in existing or item.kanji_furigana in seen:
            continue
        seen.add(item.kanji_furigana)
        fresh.append(item)

    if not fresh:
        return []

    created: list[VocabItem] = []
    for item in fresh:
        row = VocabItem(
            source="ocr_import",
            kanji_furigana=item.kanji_furigana,
            furigana_only=item.furigana_only,
            english=item.english,
            usage_context=item.usage_context,
            jlpt_level=item.jlpt_level,
            source_image_id=source_image_id,
            is_user_edited=False,
        )
        session.add(row)
        created.append(row)

    await session.flush()

    now = datetime.now(timezone.utc)
    for row, item in zip(created, fresh, strict=True):
        for answer in _answers_for(item):
            answer.vocab_item_id = row.id
            session.add(answer)

        for skill in SKILL_TYPES:
            # Due immediately: a word just imported is a word waiting to be
            # learned, and holding it back would only need a second trigger.
            session.add(
                SrsState(
                    user_id=user_id,
                    vocab_item_id=row.id,
                    skill_type=skill,
                    due_at=now,
                )
            )

        if set_id is not None:
            session.add(VocabSetItem(set_id=set_id, vocab_item_id=row.id))

    await session.flush()
    return [_to_vocab_item(row) for row in created]


async def get_due_flashcards(
    session: AsyncSession, user_id: int, *, limit: int = 100, now: datetime | None = None
) -> list[Flashcard]:
    """Cards due, soonest first, with everything needed to study offline."""
    now = now or datetime.now(timezone.utc)

    result = await session.execute(
        select(SrsState, VocabItem)
        .join(VocabItem, VocabItem.id == SrsState.vocab_item_id)
        .where(SrsState.user_id == user_id, SrsState.due_at <= now)
        .order_by(SrsState.due_at)
        .limit(limit)
    )
    rows = result.all()
    if not rows:
        return []

    item_ids = {item.id for _, item in rows}
    answers = await session.execute(
        select(VocabAnswer).where(
            VocabAnswer.vocab_item_id.in_(item_ids), VocabAnswer.accepted.is_(True)
        )
    )
    by_item: dict[int, list[VocabAnswer]] = {}
    for answer in answers.scalars():
        by_item.setdefault(answer.vocab_item_id, []).append(answer)

    return [
        _to_flashcard(state, item, by_item.get(item.id, [])) for state, item in rows
    ]


def _to_flashcard(
    state: SrsState, item: VocabItem, answers: list[VocabAnswer]
) -> Flashcard:
    """Assemble a card, choosing what goes on the front for this skill.

    Recognition shows the Japanese and wants the meaning; production shows the
    meaning and wants the Japanese — where *either* the written form or the
    reading counts, which is the whole reason answers carry a kind.
    """
    if state.skill_type == "production":
        prompt = item.english
        wanted = {"written", "reading"}
    else:
        prompt = item.kanji_furigana
        wanted = {"meaning"}

    accepted = [a.value for a in answers if a.kind in wanted]

    # A word whose reading was never printed still has its written form; a word
    # with no meaning printed has no recognition answers at all. Fall back to
    # the item's own field rather than shipping a card nothing can answer.
    if not accepted:
        accepted = [item.english] if wanted == {"meaning"} else [item.kanji_furigana]
        accepted = [value for value in accepted if value.strip()]

    return Flashcard(
        srs_state_id=state.id,
        vocab_item_id=item.id,
        skill_type=state.skill_type,
        prompt=prompt,
        accepted_answers=accepted,
        kanji_furigana=item.kanji_furigana,
        furigana_only=item.furigana_only,
        english=item.english,
        usage_context=item.usage_context,
        due_at=state.due_at,
        interval_days=state.interval_days,
        repetitions=state.repetitions,
        lapses=state.lapses,
        ease_factor=state.ease_factor,
    )


async def get_srs_state(session: AsyncSession, srs_state_id: int) -> SrsState | None:
    return await session.get(SrsState, srs_state_id)


async def get_accepted_answers(
    session: AsyncSession, vocab_item_id: int, kinds: Sequence[str]
) -> list[str]:
    result = await session.execute(
        select(VocabAnswer.value).where(
            VocabAnswer.vocab_item_id == vocab_item_id,
            VocabAnswer.kind.in_(kinds),
            VocabAnswer.accepted.is_(True),
        )
    )
    return list(result.scalars())


async def record_vocab_review(
    session: AsyncSession,
    state: SrsState,
    *,
    correct: bool,
    grade: int,
    answer_given: str | None,
    schedule,
) -> None:
    """Advance the schedule and append the history, together.

    The log carries what was typed on purpose: when a grader marks something
    wrong that the user is sure was right, the only way to tell a scheduling
    problem from a matching problem is to see the actual input.
    """
    interval_before = state.interval_days

    state.ease_factor = schedule.ease_factor
    state.interval_days = schedule.interval_days
    state.repetitions = schedule.repetitions
    state.lapses = schedule.lapses
    state.due_at = schedule.due_at
    state.last_reviewed_at = datetime.now(timezone.utc)
    state.reviews_total += 1
    if correct:
        state.reviews_correct += 1

    session.add(
        VocabReviewLog(
            srs_state_id=state.id,
            correct=correct,
            grade=grade,
            answer_given=answer_given,
            interval_before_days=interval_before,
            interval_after_days=schedule.interval_days,
        )
    )


async def get_vocab_review_days(session: AsyncSession) -> set[date]:
    """Days with at least one imported-vocab review.

    The streak is the union of this and `get_review_days` — a day spent on your
    own deck is still a day studied, and the dashboard should not pretend
    otherwise once this side has any history.
    """
    result = await session.execute(
        select(func.date(VocabReviewLog.created_at)).distinct()
    )
    return {row for row in result.scalars() if row is not None}


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
