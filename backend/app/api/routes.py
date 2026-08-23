"""HTTP surface.

Paths match what the React Native client already calls in `src/data/api.ts`.

Every route works with or without a database. With one, reads are served from
Postgres and WaniKani is only touched by the sync worker; without one, reads
fall through to WaniKani directly. That means a bare token and no infrastructure
is enough to run the whole read side locally.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import db_session, optional_db_session, settings_dep, wanikani_client
from app.config import Settings
from app.db import repository as repo
from app.schemas import (
    Assignment,
    DashboardSummary,
    ReviewRequest,
    ReviewResult,
    Subject,
    SyncResult,
)
from app.services import sync as sync_service
from app.wanikani.client import WaniKaniClient, WaniKaniError, WaniKaniValidationError
from app.wanikani.mapping import (
    build_level_progress,
    build_stage_spread,
    build_streak,
    count_available_now,
    next_available_at,
    parse_assignment,
    parse_subject,
    parse_user,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health", tags=["ops"])
async def health(
    settings: Settings = Depends(settings_dep),
    session: AsyncSession | None = Depends(optional_db_session),
) -> dict:
    """Liveness plus enough detail to tell *why* something is degraded."""
    payload: dict = {
        "status": "ok",
        "environment": settings.environment,
        "database": "configured" if settings.has_database else "absent",
        "wanikani_revision": settings.wanikani_revision,
    }
    if session is not None:
        try:
            payload["counts"] = await repo.table_counts(session)
        except Exception as exc:  # pragma: no cover - surfaced, not raised
            payload["status"] = "degraded"
            payload["database_error"] = str(exc)
    return payload


# -- reads -----------------------------------------------------------------


@router.get("/api/dashboard", response_model=DashboardSummary, tags=["read"])
async def get_dashboard(
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession | None = Depends(optional_db_session),
) -> DashboardSummary:
    """Everything the home screen needs, in one payload.

    Lesson and review counts come from `/summary` rather than by paging
    `/assignments` — it is one request and it is precomputed upstream.
    """
    summary = await client.get_summary()
    user_summary = parse_user(await client.get_user())

    lesson_count = count_available_now(summary.get("lessons", []))
    review_count = count_available_now(summary.get("reviews", []))
    next_reviews = next_available_at(summary.get("reviews", []))

    # Two different scopes here, and conflating them is a trap:
    #   * `assignments` must be EVERY assignment on the account — the stage
    #     spread charts all active items, and most of them belong to levels
    #     the user has already passed.
    #   * `level_subjects` must be every subject the *current* level contains,
    #     including still-locked ones, because that is the denominator in
    #     "9 / 18 kanji".
    if session is not None and (user := await repo.get_default_user(session)) is not None:
        assignments = await repo.get_assignments(session, user.id)
        level_subjects = await repo.get_subjects_by_level(session, user_summary.level)
        review_days = await repo.get_review_days(session)
        last_synced_at = await repo.get_last_synced_at(session)

        # The cache only holds this level's content once a backfill has run.
        if not level_subjects:
            level_subjects = [
                parse_subject(r)
                for r in await client.get_subjects(levels=[user_summary.level])
            ]
    else:
        assignments = [parse_assignment(r) for r in await client.get_assignments()]
        level_subjects = [
            parse_subject(r) for r in await client.get_subjects(levels=[user_summary.level])
        ]
        # Without a database there is no review log, so no streak to derive.
        review_days = set()
        last_synced_at = None

    level_progressions = await client.get_level_progressions()

    return DashboardSummary(
        user=user_summary,
        lesson_count=lesson_count,
        review_count=review_count,
        streak=build_streak(review_days),
        level_progress=build_level_progress(
            user_summary.level, assignments, level_subjects, level_progressions
        ),
        stage_spread=build_stage_spread(assignments),
        last_synced_at=last_synced_at,
        next_reviews_at=next_reviews,
    )


@router.get("/api/assignments", response_model=list[Assignment], tags=["read"])
async def get_assignments(
    updated_after: datetime | None = Query(None, alias="updated_after"),
    immediately_available_for_lessons: bool = False,
    immediately_available_for_review: bool = False,
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession | None = Depends(optional_db_session),
) -> list[Assignment]:
    """Assignments, optionally filtered.

    `updated_after` is what makes the client's poll a cheap diff. When it is
    supplied the request always goes upstream, since the cache cannot answer
    "what changed since X" for records it has not seen yet.
    """
    wants_live = (
        updated_after is not None
        or immediately_available_for_lessons
        or immediately_available_for_review
    )

    if session is not None and not wants_live:
        user = await repo.get_default_user(session)
        if user is not None:
            return await repo.get_assignments(session, user.id)

    raw = await client.get_assignments(
        updated_after=updated_after.isoformat() if updated_after else None,
        immediately_available_for_lessons=immediately_available_for_lessons or None,
        immediately_available_for_review=immediately_available_for_review or None,
    )
    return [parse_assignment(r) for r in raw]


@router.get("/api/subjects", response_model=list[Subject], tags=["read"])
async def get_subjects(
    ids: str | None = Query(None, description="Comma-separated subject ids"),
    level: int | None = Query(None, ge=1, le=60),
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession | None = Depends(optional_db_session),
) -> list[Subject]:
    """Subject content.

    Served from cache whenever possible — this content essentially never
    changes, so a cache miss is the only reason to spend a WaniKani request.
    """
    id_list = _parse_ids(ids)

    if session is not None:
        if id_list:
            cached = await repo.get_subjects_by_ids(session, id_list)
            if len(cached) == len(set(id_list)):
                return cached
        elif level is not None:
            cached = await repo.get_subjects_by_level(session, level)
            if cached:
                return cached

    raw = await client.get_subjects(
        ids=id_list or None, levels=[level] if level is not None else None
    )
    return [parse_subject(r) for r in raw]


# -- writes ----------------------------------------------------------------
# The only two calls that change anything on WaniKani's side.


@router.put(
    "/api/assignments/{assignment_id}/start",
    response_model=Assignment,
    tags=["write"],
)
async def start_assignment(
    assignment_id: int,
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession | None = Depends(optional_db_session),
) -> Assignment:
    """Finish a lesson: move the item into the SRS at stage 1.

    A 422 here almost always means the client's queue was stale — the item was
    already started, or sits above the subscription's level ceiling.
    """
    try:
        raw = await client.start_assignment(assignment_id)
    except WaniKaniValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "WaniKani refused to start this assignment",
                "hint": "It may already be started, or be above your subscription level.",
                "wanikani": exc.body,
            },
        ) from exc

    assignment = parse_assignment({"id": assignment_id, "data": raw})

    if session is not None and (user := await repo.get_default_user(session)) is not None:
        await repo.upsert_assignments(session, user.id, [assignment])

    return assignment


@router.post("/api/reviews", response_model=ReviewResult, tags=["write"])
async def submit_review(
    payload: ReviewRequest,
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession | None = Depends(optional_db_session),
) -> ReviewResult:
    """Submit one answered review.

    Only incorrect counts go up — WaniKani derives the new SRS stage itself.
    The response carries `resources_updated.assignment`, which is the single
    authoritative source for the recomputed stage and the real next-review
    time; the client should replace its optimistic guess with it.
    """
    review = payload.review

    try:
        raw = await client.create_review(
            assignment_id=review.assignment_id,
            incorrect_meaning_answers=review.incorrect_meaning_answers,
            incorrect_reading_answers=review.incorrect_reading_answers,
            created_at=review.created_at.isoformat() if review.created_at else None,
        )
    except WaniKaniValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "WaniKani rejected this review",
                "hint": (
                    "The item is probably not due yet, or created_at predates "
                    "the assignment's available_at."
                ),
                "wanikani": exc.body,
            },
        ) from exc

    review_data = raw["data"]
    updated = raw.get("resources_updated") or {}
    raw_assignment = updated.get("assignment")

    if raw_assignment is None:  # pragma: no cover - WaniKani always sends it
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="WaniKani accepted the review but returned no updated assignment",
        )

    assignment = parse_assignment(raw_assignment)

    if session is not None and (user := await repo.get_default_user(session)) is not None:
        await repo.upsert_assignments(session, user.id, [assignment])

        # WaniKani no longer persists reviews (its response returns id 0), so
        # this log is the only durable record — and the streak depends on it.
        progress = await repo.get_progress_by_assignment(
            session, user.id, assignment.id
        )
        if progress is not None:
            await repo.log_review(
                session,
                study_progress_id=progress.id,
                incorrect_meaning=review.incorrect_meaning_answers,
                incorrect_reading=review.incorrect_reading_answers,
                starting_srs_stage=review_data.get("starting_srs_stage"),
                ending_srs_stage=review_data.get("ending_srs_stage"),
                created_at=review.created_at,
            )

    return ReviewResult(
        assignment=assignment,
        starting_srs_stage=review_data.get("starting_srs_stage", 0),
        ending_srs_stage=review_data.get("ending_srs_stage", 0),
    )


# -- sync ------------------------------------------------------------------


@router.post("/api/sync", response_model=SyncResult, tags=["ops"])
async def trigger_sync(
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession = Depends(db_session),
) -> SyncResult:
    """Run a sync pass now.

    The same code the scheduled worker runs. Exposed so the client's
    pull-to-refresh can force a pass on app open, which is when staleness is
    actually visible.
    """
    try:
        return await sync_service.sync_all(session, client)
    except WaniKaniError as exc:
        logger.exception("Sync failed")
        return SyncResult(
            ok=False,
            assignments_updated=0,
            subjects_updated=0,
            last_synced_at=await repo.get_last_synced_at(session),
            detail=str(exc),
        )


@router.post("/api/sync/backfill", response_model=SyncResult, tags=["ops"])
async def backfill(
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession = Depends(db_session),
) -> SyncResult:
    """One-time content pull for every level the account can see.

    Run once at setup so lessons and reviews work offline from first launch.
    Capped at `subscription.max_level_granted`; on a free account that is 3.
    """
    user_summary = parse_user(await client.get_user())
    max_level = min(user_summary.max_level_granted, 60)

    written = await sync_service.backfill_subjects_for_level_range(
        session, client, max_level=max_level
    )
    return SyncResult(
        ok=True,
        assignments_updated=0,
        subjects_updated=written,
        last_synced_at=datetime.now(timezone.utc),
        detail=f"Backfilled levels 1–{max_level}",
    )


def _parse_ids(raw: str | None) -> list[int]:
    if not raw:
        return []
    out: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid subject id: {part!r}",
            ) from exc
    return out
