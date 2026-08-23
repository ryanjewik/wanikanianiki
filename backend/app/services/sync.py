"""Sync service.

Pulls WaniKani state the app did not itself cause: new lessons unlocking on
level-up, level progressions, and any studying done on wanikani.com. WaniKani
has no webhooks, so this is poll-only.

Two properties matter:

* **Incremental.** Every pull passes `updated_after`, so a poll that finds
  nothing costs one request instead of paging the whole account.

* **Serialised.** The 60/min cap is per token, so this must run as a single
  invocation — EventBridge cron into one Lambda with reserved concurrency 1.
  Fanning it out would only manufacture 429s.

The cursor is advanced *only* after a fully successful pass. A partial failure
leaves it where it was, so the next run re-pulls the same window rather than
skipping records that never landed.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import repository as repo
from app.db.models import SYNC_KEY_ASSIGNMENTS, SYNC_KEY_LAST_SYNCED, SYNC_KEY_SUBJECTS
from app.schemas import SyncResult
from app.wanikani.client import WaniKaniClient
from app.wanikani.mapping import parse_assignment, parse_subject, parse_user

logger = logging.getLogger(__name__)


async def sync_all(session: AsyncSession, client: WaniKaniClient) -> SyncResult:
    """One full pass. Safe to run repeatedly; every write is an upsert."""
    started_at = datetime.now(timezone.utc)

    # 1. The user first — level and subscription bound everything below.
    raw_user = await client.get_user()
    user_summary = parse_user(raw_user)
    user = await repo.upsert_user(
        session,
        wanikani_user_id=raw_user["id"],
        username=user_summary.username,
        level=user_summary.level,
        max_level_granted=user_summary.max_level_granted,
        subscription_active=user_summary.subscription_active,
    )

    # 2. Assignments, incrementally.
    assignments_cursor = await repo.get_sync_meta(session, SYNC_KEY_ASSIGNMENTS)
    raw_assignments = await client.get_assignments(updated_after=assignments_cursor)
    assignments = [parse_assignment(r) for r in raw_assignments]
    assignments_written = await repo.upsert_assignments(session, user.id, assignments)

    # 3. Content for anything we now have an assignment for but no subject row.
    #    Subjects are pulled by id rather than by `updated_after` because a
    #    newly *unlocked* subject has not changed — it was always there, we
    #    simply had no reason to cache it before.
    known = await repo.get_known_subject_ids(session)
    missing = sorted({a.subject_id for a in assignments} - known)

    subjects_written = 0
    if missing:
        # Chunked to keep each URL well under any query-length limit; WaniKani
        # pages at 500 (1000 for subjects) regardless.
        for chunk in _chunks(missing, 400):
            raw_subjects = await client.get_subjects(ids=chunk)
            parsed = [parse_subject(r) for r in raw_subjects]
            updated_at = {
                r["id"]: r.get("data_updated_at") for r in raw_subjects
            }
            subjects_written += await repo.upsert_subjects(
                session, parsed, updated_at=_coerce_datetimes(updated_at)
            )

    # 4. Advance cursors only now that everything above succeeded.
    finished_at = datetime.now(timezone.utc)
    await repo.set_sync_meta(session, SYNC_KEY_ASSIGNMENTS, started_at.isoformat())
    await repo.set_sync_meta(session, SYNC_KEY_LAST_SYNCED, finished_at.isoformat())
    if subjects_written:
        await repo.set_sync_meta(session, SYNC_KEY_SUBJECTS, started_at.isoformat())

    logger.info(
        "Sync complete: %d assignments, %d subjects",
        assignments_written,
        subjects_written,
    )

    return SyncResult(
        ok=True,
        assignments_updated=assignments_written,
        subjects_updated=subjects_written,
        last_synced_at=finished_at,
    )


async def backfill_subjects_for_level_range(
    session: AsyncSession, client: WaniKaniClient, *, max_level: int
) -> int:
    """One-time content pull for every level the account can actually see.

    Worth running once at setup so lessons and reviews work offline from the
    first launch, rather than trickling content in as items unlock. Capped at
    `subscription.max_level_granted` — content above it is invisible and
    requesting it just wastes rate-limit budget.
    """
    written = 0
    for level in range(1, max_level + 1):
        raw = await client.get_subjects(levels=[level])
        parsed = [parse_subject(r) for r in raw]
        updated_at = _coerce_datetimes({r["id"]: r.get("data_updated_at") for r in raw})
        written += await repo.upsert_subjects(session, parsed, updated_at=updated_at)
        logger.info("Backfilled level %d: %d subjects", level, len(parsed))
    return written


def _chunks(values: list[int], size: int):
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _coerce_datetimes(mapping: dict[int, object]) -> dict[int, datetime]:
    parsed: dict[int, datetime] = {}
    for key, value in mapping.items():
        if isinstance(value, datetime):
            parsed[key] = value
        elif isinstance(value, str):
            try:
                parsed[key] = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
    return parsed
