"""Translate raw WaniKani JSON into the app's own schemas.

Kept separate from the client so the client stays a transport concern and this
stays a shape concern. Every function here takes one raw WaniKani *resource*
(the `{id, object, data: {...}}` envelope) and returns a plain model.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.schemas import (
    Assignment,
    Counted,
    DayActivity,
    LevelProgress,
    Meaning,
    Reading,
    StreakSummary,
    Subject,
    UserSummary,
    normalise_subject_type,
)


def parse_assignment(resource: dict[str, Any]) -> Assignment:
    """WaniKani puts the assignment id on the envelope, not in `data`."""
    data = resource["data"]
    return Assignment(
        id=resource["id"],
        subject_id=data["subject_id"],
        subject_type=normalise_subject_type(data["subject_type"]),
        srs_stage=data["srs_stage"],
        unlocked_at=data.get("unlocked_at"),
        started_at=data.get("started_at"),
        passed_at=data.get("passed_at"),
        available_at=data.get("available_at"),
        burned_at=data.get("burned_at"),
    )


def parse_subject(resource: dict[str, Any]) -> Subject:
    """`object` on the envelope carries the type; `data` has no type field."""
    data = resource["data"]

    # Radicals with no Unicode glyph ship artwork instead. Prefer the SVG.
    image_url: str | None = None
    for image in data.get("character_images") or []:
        if image.get("content_type") == "image/svg+xml":
            image_url = image.get("url")
            break
        image_url = image_url or image.get("url")

    return Subject(
        id=resource["id"],
        type=normalise_subject_type(resource["object"]),
        characters=data.get("characters"),
        character_image_url=image_url,
        level=data["level"],
        slug=data.get("slug", ""),
        meanings=[
            Meaning(
                meaning=m["meaning"],
                primary=m["primary"],
                accepted_answer=m["accepted_answer"],
            )
            for m in data.get("meanings", [])
        ],
        readings=[
            Reading(
                reading=r["reading"],
                # Kana vocabulary readings carry no `type`; they are the word.
                type=r.get("type") or "vocabulary",
                primary=r["primary"],
                accepted_answer=r["accepted_answer"],
            )
            for r in data.get("readings", [])
        ],
        meaning_mnemonic=data.get("meaning_mnemonic"),
        reading_mnemonic=data.get("reading_mnemonic"),
        meaning_hint=data.get("meaning_hint"),
        reading_hint=data.get("reading_hint"),
        component_subject_ids=data.get("component_subject_ids", []),
        amalgamation_subject_ids=data.get("amalgamation_subject_ids", []),
    )


def parse_user(data: dict[str, Any]) -> UserSummary:
    subscription = data.get("subscription") or {}
    return UserSummary(
        username=data["username"],
        level=data["level"],
        max_level_granted=subscription.get("max_level_granted", 60),
        subscription_active=subscription.get("active", False),
    )


# -- derived values --------------------------------------------------------
# WaniKani computes none of the below; it only hands over timestamps.


def count_available_now(summary_slots: list[dict[str, Any]]) -> int:
    """Items available *right now* from a `/summary` forecast.

    `reviews` is a 24-hour forecast of hourly slots. Only slots whose
    `available_at` has already passed are actually due — summing the whole
    array would report tomorrow's workload as though it were waiting now.
    """
    now = datetime.now(timezone.utc)
    total = 0
    for slot in summary_slots:
        available_at = _parse_dt(slot.get("available_at"))
        if available_at is not None and available_at <= now:
            total += len(slot.get("subject_ids", []))
    return total


def next_available_at(summary_slots: list[dict[str, Any]]) -> datetime | None:
    """The soonest future slot that actually contains something."""
    now = datetime.now(timezone.utc)
    upcoming = [
        dt
        for slot in summary_slots
        if slot.get("subject_ids")
        and (dt := _parse_dt(slot.get("available_at"))) is not None
        and dt > now
    ]
    return min(upcoming) if upcoming else None


def build_level_progress(
    level: int,
    assignments: list[Assignment],
    level_subjects: list[Subject],
    level_progressions: list[dict[str, Any]],
) -> LevelProgress:
    """Per-type passed/total for the current level, plus pace.

    The denominator comes from `level_subjects` — every subject the level
    contains — not from the assignments. Assignments only exist for *unlocked*
    items, so counting them would report "7 kanji this level" on a level that
    actually has 35, with the number creeping up as things unlocked.

    "Passed" is WaniKani's own definition — `passed_at` is stamped at SRS
    stage 5 — so this adds no new mastery concept.
    """
    counts = {
        "radical": [0, 0],
        "kanji": [0, 0],
        "vocabulary": [0, 0],
    }

    # Totals: everything the level contains, locked or not.
    subject_types: dict[int, str] = {}
    for subject in level_subjects:
        if subject.level != level:
            continue
        counts[subject.type][1] += 1
        subject_types[subject.id] = subject.type

    # Passed: assignments for those subjects that have reached stage 5.
    for assignment in assignments:
        subject_type = subject_types.get(assignment.subject_id)
        if subject_type is None or assignment.passed_at is None:
            continue
        counts[subject_type][0] += 1

    # WaniKani gates level-up on kanji specifically: 90% of the level's kanji
    # must reach stage 5. Radicals and vocabulary do not hold you back.
    kanji_passed, kanji_total = counts["kanji"]
    required = -(-kanji_total * 9 // 10)  # ceil(total * 0.9)
    remaining = max(0, required - kanji_passed)

    return LevelProgress(
        level=level,
        radicals=Counted(passed=counts["radical"][0], total=counts["radical"][1]),
        kanji=Counted(passed=kanji_passed, total=kanji_total),
        vocabulary=Counted(passed=counts["vocabulary"][0], total=counts["vocabulary"][1]),
        kanji_remaining_to_level_up=remaining,
        days_at_level=_days_at_level(level, level_progressions),
    )


def build_stage_spread(assignments: list[Assignment]) -> list[int]:
    """Counts per display bucket.

    WaniKani ships nine stages; the UI groups them into five. Unstarted
    assignments (stage 0) are excluded — they are lessons, not active items.
    """
    spread = [0, 0, 0, 0, 0]
    for assignment in assignments:
        if assignment.started_at is None:
            continue
        spread[stage_bucket(assignment.srs_stage)] += 1
    return spread


def stage_bucket(srs_stage: int) -> int:
    """1-2 early apprentice, 3-4 late apprentice, 5-6 guru, 7-8 master/
    enlightened, 9 burned. Mirrors `stageBucket` in the client's tokens.ts."""
    if srs_stage <= 2:
        return 0
    if srs_stage <= 4:
        return 1
    if srs_stage <= 6:
        return 2
    if srs_stage <= 8:
        return 3
    return 4


def build_streak(review_days: set[object], today: object | None = None) -> StreakSummary:
    """Streak and the seven-day strip from the set of days that saw activity.

    `review_days` is a set of `date` objects. Today counts as "not yet done"
    rather than breaking the streak — the strip renders it as an outline.

    `today` should be the caller's *local* date — `services.dates.today_in()`
    computes it. The days in `review_days` are bucketed by the user's zone, so a
    "today" taken from the server's clock would be compared against a calendar
    it does not share: near midnight that reads the strip off by a day. UTC
    remains the fallback only because a caller that passes nothing has no zone
    to offer either.
    """
    from datetime import date as date_cls

    current = today if isinstance(today, date_cls) else datetime.now(timezone.utc).date()
    days: set[date_cls] = {d for d in review_days if isinstance(d, date_cls)}

    # Count back from yesterday, so an unstarted today does not zero it out.
    streak = 0
    cursor = current if current in days else current - timedelta(days=1)
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)

    best = _longest_run(days)

    week: list[DayActivity] = []
    for offset in range(6, -1, -1):
        day = current - timedelta(days=offset)
        is_today = offset == 0
        week.append(
            DayActivity(
                label="Today" if is_today else day.strftime("%a"),
                intensity=1.0 if day in days else 0.0,
                is_today=is_today,
            )
        )

    return StreakSummary(days=streak, best=max(best, streak), week=week)


# -- internals -------------------------------------------------------------


def _days_at_level(level: int, level_progressions: list[dict[str, Any]]) -> int:
    for progression in level_progressions:
        data = progression.get("data", progression)
        if data.get("level") != level:
            continue
        started = _parse_dt(data.get("started_at") or data.get("unlocked_at"))
        if started is None:
            return 0
        return max(0, (datetime.now(timezone.utc) - started).days)
    return 0


def _longest_run(days: set[object]) -> int:
    from datetime import date as date_cls

    typed = sorted(d for d in days if isinstance(d, date_cls))
    if not typed:
        return 0

    best = run = 1
    for previous, current in zip(typed, typed[1:], strict=False):
        run = run + 1 if (current - previous).days == 1 else 1
        best = max(best, run)
    return best


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        # WaniKani emits ISO8601 with a trailing Z, which fromisoformat only
        # learned to parse in 3.11.
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
