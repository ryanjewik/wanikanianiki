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

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import db_session, optional_db_session, settings_dep, wanikani_client
from app.config import Settings
from app.db import repository as repo
from app.schemas import (
    Assignment,
    ConfirmImportRequest,
    DashboardSummary,
    Flashcard,
    FlashcardAnswer,
    FlashcardOutcome,
    ReviewRequest,
    ReviewResult,
    Subject,
    SyncResult,
    VocabItem,
    VocabSet,
    VocabSetCreate,
    VocabSourceResult,
)
from app.services import ocr as ocr_service
from app.services import srs, storage
from app.services import sync as sync_service
from app.services.dates import timezone_name, today_in
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
    tz: str | None = Query(
        None,
        description="IANA zone name from the device, e.g. America/Los_Angeles.",
    ),
    client: WaniKaniClient = Depends(wanikani_client),
    session: AsyncSession | None = Depends(optional_db_session),
) -> DashboardSummary:
    """Everything the home screen needs, in one payload.

    Lesson and review counts come from `/summary` rather than by paging
    `/assignments` — it is one request and it is precomputed upstream.

    `tz` decides where the study day starts. The phone reports it rather than
    the user configuring it anywhere, because the phone already knows and a
    settings screen nobody visits is a setting that stays wrong. An unrecognised
    or absent value leaves whatever the account already had.
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
        zone = await repo.adopt_timezone(session, user, tz)

        assignments = await repo.get_assignments(session, user.id)
        level_subjects = await repo.get_subjects_by_level(session, user_summary.level)
        # Both sides of the union share one zone, and the streak counts back
        # from that same calendar's today.
        review_days = await repo.get_review_days(session, zone)
        review_days |= await repo.get_vocab_review_days(session, zone)
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
        zone = timezone_name(tz)

    level_progressions = await client.get_level_progressions()

    return DashboardSummary(
        user=user_summary,
        lesson_count=lesson_count,
        review_count=review_count,
        streak=build_streak(review_days, today_in(zone)),
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


# -- photo import ----------------------------------------------------------
# The vision call takes far longer than a request should, so the upload only
# records the page and returns; the client polls the GET below until the rows
# appear. `vocab_sources.status` is the state machine that makes that work.


@router.post(
    "/api/vocab-sources",
    response_model=VocabSourceResult,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["import"],
)
async def upload_vocab_source(
    background: BackgroundTasks,
    image: UploadFile = File(...),
    jlpt_level: int | None = Form(None),
    label: str | None = Form(None),
    set_id: int | None = Form(None),
    position: int = Form(0),
    settings: Settings = Depends(settings_dep),
    session: AsyncSession = Depends(db_session),
) -> VocabSourceResult:
    """Accept a page photo and start reading it.

    Returns `202` with a `sourceId` and `pending` immediately; the extraction
    runs after the response is sent.

    Not a platform limit — a Lambda Function URL will hold a request for up to
    fifteen minutes. It is that a phone should not be asked to. A minute-long
    connection on mobile data dies to a network switch, and both iOS and
    Android suspend a backgrounded app mid-request. Waiting synchronously would
    also bill a Lambda for a minute of doing nothing, which is the opposite of
    why any of this is serverless.
    """
    if not settings.has_vision:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "Photo import is not configured",
                "hint": "Set ANTHROPIC_API_KEY to enable page extraction.",
            },
        )

    data = await image.read()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file was empty"
        )

    try:
        media_type = storage.check_media_type(image.content_type or "")
    except storage.UnsupportedImageType as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc)
        ) from exc

    user = await repo.get_default_user(session)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "No user on record yet",
                "hint": "Run POST /api/sync once so the account is known.",
            },
        )

    if set_id is not None and await repo.get_vocab_set(session, set_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Unknown set"
        )

    source = await repo.create_vocab_source(
        session,
        user_id=user.id,
        jlpt_level=jlpt_level,
        label=label,
        set_id=set_id,
        position=position,
    )
    source_id = source.id

    # The bytes are wanted once, by the extraction, and nothing reads them
    # afterwards — the review screen shows the device's own copy of the photo.
    # So they are buffered in memory rather than written anywhere. See
    # `services/storage.py` for what changes when `ocr-fn` becomes separate.
    storage.hold(source_id, data, media_type)

    # Commit before scheduling, not after. The extraction runs in its own
    # session — it has to, since the request's is closed by then — and that
    # session can only see committed rows. Leaving this to the dependency's
    # teardown makes the handoff depend on whether FastAPI exits `yield`
    # dependencies before or after background tasks, which is not a detail to
    # build on.
    await session.commit()

    # Runs after the response is flushed. Under Lambda this becomes an SQS
    # message and `ocr_handler` picks it up instead — same service function.
    background.add_task(_run_extraction, source_id)

    return VocabSourceResult(source_id=source_id, status="pending", items=[])


async def _run_extraction(source_id: int) -> None:
    """Own transaction: the request's session is closed by the time this runs."""
    from app.db.session import session_scope

    async with session_scope() as session:
        await ocr_service.process_source(session, source_id)


@router.get(
    "/api/vocab-sources/{source_id}",
    response_model=VocabSourceResult,
    tags=["import"],
)
async def get_vocab_source(
    source_id: int,
    session: AsyncSession = Depends(db_session),
) -> VocabSourceResult:
    """What the client polls. Rows appear once `status` reaches `processed`."""
    source = await repo.get_vocab_source(session, source_id)
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown source")

    items, failure = ocr_service.take_result(source_id)
    return VocabSourceResult(
        source_id=source_id,
        status=source.status,
        items=items,
        detail=failure,
    )


@router.post(
    "/api/vocab-sources/{source_id}/confirm",
    response_model=list[VocabItem],
    tags=["import"],
)
async def confirm_vocab_source(
    source_id: int,
    payload: ConfirmImportRequest,
    session: AsyncSession = Depends(db_session),
) -> list[VocabItem]:
    """Commit the rows the user kept.

    The client sends back the corrected rows rather than a list of ids, because
    the user may have fixed a reading or picked between ambiguous ones — the
    edited text is the point, not the original extraction.
    """
    source = await repo.get_vocab_source(session, source_id)
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown source")

    user = await repo.get_default_user(session)
    keep = [item for item in payload.items if item.selected and item.status != "duplicate"]
    created = await repo.create_flashcards(
        session,
        keep,
        user_id=user.id,
        source_image_id=source_id,
        # Words inherit the set the page was photographed into, so a five-page
        # import lands as one named group without the user tagging anything.
        set_id=source.set_id,
    )

    # The draft has served its purpose; holding it would leak for every import.
    ocr_service.discard_result(source_id)
    storage.discard(source_id)
    return created


# -- sets ------------------------------------------------------------------


@router.post(
    "/api/vocab-sets",
    response_model=VocabSet,
    status_code=status.HTTP_201_CREATED,
    tags=["import"],
)
async def create_vocab_set(
    payload: VocabSetCreate,
    session: AsyncSession = Depends(db_session),
) -> VocabSet:
    """Name a group before photographing into it."""
    user = await repo.get_default_user(session)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "No user on record yet",
                "hint": "Run POST /api/sync once so the account is known.",
            },
        )

    if await repo.get_vocab_set_by_name(session, user_id=user.id, name=payload.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A set called {payload.name!r} already exists",
        )

    row = await repo.create_vocab_set(
        session, user_id=user.id, name=payload.name, description=payload.description
    )
    return VocabSet(
        id=row.id,
        name=row.name,
        description=row.description,
        created_at=row.created_at,
    )


@router.get("/api/vocab-sets", response_model=list[VocabSet], tags=["import"])
async def list_vocab_sets(
    session: AsyncSession = Depends(db_session),
) -> list[VocabSet]:
    """Sets with their word and page counts.

    The page counts are what make a multi-page import legible while it runs —
    "5 pages, 2 still reading" — and they come from the sources' own statuses
    rather than a progress field that could drift out of step.
    """
    user = await repo.get_default_user(session)
    if user is None:
        return []
    return await repo.list_vocab_sets(session, user.id)


@router.get(
    "/api/vocab-sets/{set_id}/items",
    response_model=list[VocabItem],
    tags=["import"],
)
async def list_vocab_set_items(
    set_id: int,
    session: AsyncSession = Depends(db_session),
) -> list[VocabItem]:
    """The words in one set.

    Separate from the set list on purpose: that endpoint answers "what decks do
    I have" and carries counts only, so browsing one deck does not make listing
    all of them proportional to the size of the whole collection.

    Returns the words themselves rather than cards. A word is one row here and
    two `srs_state` rows, and a deck browser shows words; `/api/flashcards/due`
    is the endpoint that deals in cards.
    """
    user = await repo.get_default_user(session)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Unknown set"
        )

    vocab_set = await repo.get_vocab_set(session, set_id)
    # A set belonging to someone else is reported as missing rather than
    # forbidden: which ids exist is not this caller's business either way.
    if vocab_set is None or vocab_set.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Unknown set"
        )

    return await repo.list_vocab_set_items(session, set_id)


# -- studying --------------------------------------------------------------


@router.get("/api/flashcards/due", response_model=list[Flashcard], tags=["study"])
async def get_due_flashcards(
    limit: int = Query(100, ge=1, le=500),
    session: AsyncSession = Depends(db_session),
) -> list[Flashcard]:
    """Imported vocabulary due now — never WaniKani items.

    The two decks stay separate tracks: WaniKani's queue comes from
    `/api/assignments` and is scheduled by WaniKani. Blending them would mean
    one of the two schedulers overruling the other.
    """
    user = await repo.get_default_user(session)
    if user is None:
        return []
    return await repo.get_due_flashcards(session, user.id, limit=limit)


@router.post(
    "/api/flashcards/{srs_state_id}/answer",
    response_model=FlashcardOutcome,
    tags=["study"],
)
async def answer_flashcard(
    srs_state_id: int,
    payload: FlashcardAnswer,
    session: AsyncSession = Depends(db_session),
) -> FlashcardOutcome:
    """Grade an answer and advance the schedule.

    Grading happens here rather than on the device even though the card ships
    with its answers: the phone grades to show a result instantly, and the
    server grades to decide what actually gets written. If they ever disagree,
    the server's answer is the one in the deck.
    """
    state = await repo.get_srs_state(session, srs_state_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown card")

    kinds = ("written", "reading") if state.skill_type == "production" else ("meaning",)
    accepted = await repo.get_accepted_answers(session, state.vocab_item_id, kinds)

    if payload.answer_given is not None:
        correct = srs.matches(payload.answer_given, accepted)
    elif payload.correct is not None:
        correct = payload.correct
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Send either answerGiven or correct",
        )

    grade = payload.grade if payload.grade is not None else srs.grade_for(correct)

    schedule = srs.next_schedule(
        ease_factor=state.ease_factor,
        interval_days=state.interval_days,
        repetitions=state.repetitions,
        lapses=state.lapses,
        grade=grade,
    )
    await repo.record_vocab_review(
        session,
        state,
        correct=correct,
        grade=grade,
        answer_given=payload.answer_given,
        schedule=schedule,
    )

    return FlashcardOutcome(
        correct=correct,
        grade=grade,
        accepted_answers=accepted,
        due_at=schedule.due_at,
        interval_days=schedule.interval_days,
        repetitions=schedule.repetitions,
        lapses=schedule.lapses,
        ease_factor=schedule.ease_factor,
    )


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
