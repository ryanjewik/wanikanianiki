"""Mapping and derived-value logic.

These are the calculations WaniKani does not do for us, and the ones most
likely to be quietly wrong — the numbers still look plausible when the logic
is broken, which is exactly why they are pinned here.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.schemas import Assignment, Counted, Subject
from app.wanikani.mapping import (
    build_level_progress,
    build_stage_spread,
    build_streak,
    count_available_now,
    next_available_at,
    parse_subject,
    stage_bucket,
)


def make_assignment(subject_id: int, srs_stage: int, *, started=True, passed=False) -> Assignment:
    now = datetime.now(timezone.utc)
    return Assignment(
        id=1_000_000 + subject_id,
        subject_id=subject_id,
        subject_type="kanji",
        srs_stage=srs_stage,
        unlocked_at=now,
        started_at=now if started else None,
        passed_at=now if passed else None,
        available_at=now,
        burned_at=None,
    )


def make_subject(subject_id: int, type_: str, level: int) -> Subject:
    return Subject(id=subject_id, type=type_, characters="X", level=level, slug="x")


def test_stage_bucket_maps_nine_stages_onto_five():
    assert [stage_bucket(s) for s in range(1, 10)] == [0, 0, 1, 1, 2, 2, 3, 3, 4]


def test_stage_spread_excludes_unstarted_assignments():
    """Stage 0 items are lessons, not active items — they belong in the lesson
    count, not the spread."""
    assignments = [
        make_assignment(1, 0, started=False),
        make_assignment(2, 1),
        make_assignment(3, 2),
        make_assignment(4, 6),
    ]
    assert build_stage_spread(assignments) == [2, 0, 1, 0, 0]


def test_level_progress_totals_come_from_subjects_not_assignments():
    """Regression: counting totals off assignments only counts *unlocked*
    items, so a level with 35 kanji reported 7 and crept upward as things
    unlocked."""
    level_subjects = [make_subject(i, "kanji", 2) for i in range(1, 36)]
    level_subjects += [make_subject(100 + i, "radical", 2) for i in range(33)]

    # Only three of the 35 kanji are even unlocked, and one has passed.
    assignments = [
        make_assignment(1, 5, passed=True),
        make_assignment(2, 2),
        make_assignment(3, 1),
    ]

    progress = build_level_progress(2, assignments, level_subjects, [])

    assert progress.kanji == Counted(passed=1, total=35)
    assert progress.radicals == Counted(passed=0, total=33)


def test_level_progress_ignores_other_levels():
    level_subjects = [make_subject(1, "kanji", 2), make_subject(2, "kanji", 3)]
    assignments = [make_assignment(1, 5, passed=True), make_assignment(2, 5, passed=True)]

    progress = build_level_progress(2, assignments, level_subjects, [])
    assert progress.kanji == Counted(passed=1, total=1)


def test_kanji_remaining_uses_ninety_percent_rule():
    """WaniKani gates level-up on 90% of the level's kanji reaching stage 5."""
    level_subjects = [make_subject(i, "kanji", 1) for i in range(1, 11)]  # 10 kanji
    passed = [make_assignment(i, 5, passed=True) for i in range(1, 8)]  # 7 passed

    progress = build_level_progress(1, passed, level_subjects, [])
    # ceil(10 * 0.9) == 9 required, 7 done -> 2 to go.
    assert progress.kanji_remaining_to_level_up == 2


def test_count_available_now_ignores_future_slots():
    """`/summary` reviews is a 24-hour forecast; summing it all would report
    tomorrow's workload as though it were waiting now."""
    now = datetime.now(timezone.utc)
    slots = [
        {"available_at": (now - timedelta(hours=1)).isoformat(), "subject_ids": [1, 2, 3]},
        {"available_at": (now + timedelta(hours=1)).isoformat(), "subject_ids": [4, 5]},
        {"available_at": (now + timedelta(hours=2)).isoformat(), "subject_ids": []},
    ]
    assert count_available_now(slots) == 3


def test_next_available_at_skips_empty_slots():
    now = datetime.now(timezone.utc)
    slots = [
        {"available_at": (now + timedelta(hours=1)).isoformat(), "subject_ids": []},
        {"available_at": (now + timedelta(hours=2)).isoformat(), "subject_ids": [9]},
    ]
    result = next_available_at(slots)
    assert result is not None and result.hour == (now + timedelta(hours=2)).hour


def test_streak_counts_back_and_today_does_not_break_it():
    """An unstarted today should not zero out a live streak."""
    today = date(2026, 8, 23)
    days = {today - timedelta(days=n) for n in range(1, 5)}  # yesterday .. -4

    streak = build_streak(days, today=today)

    assert streak.days == 4
    assert len(streak.week) == 7
    assert streak.week[-1].is_today and streak.week[-1].label == "Today"
    assert streak.week[-1].intensity == 0.0


def test_streak_includes_today_when_already_studied():
    today = date(2026, 8, 23)
    days = {today - timedelta(days=n) for n in range(0, 3)}
    assert build_streak(days, today=today).days == 3


def test_streak_is_zero_when_gap_is_older_than_yesterday():
    today = date(2026, 8, 23)
    days = {today - timedelta(days=5)}
    assert build_streak(days, today=today).days == 0


def test_kana_vocabulary_folds_into_vocabulary():
    """WaniKani has four subject types; the design system has three colours."""
    resource = {
        "id": 9001,
        "object": "kana_vocabulary",
        "data": {
            "level": 2,
            "slug": "ラーメン",
            "characters": "ラーメン",
            "meanings": [{"meaning": "Ramen", "primary": True, "accepted_answer": True}],
            # Kana vocabulary readings carry no `type` field.
            "readings": [{"reading": "ラーメン", "primary": True, "accepted_answer": True}],
        },
    }
    subject = parse_subject(resource)
    assert subject.type == "vocabulary"
    assert subject.readings[0].type == "vocabulary"


def test_radical_without_glyph_uses_character_image():
    """A few radicals have no Unicode codepoint and ship artwork instead."""
    resource = {
        "id": 8888,
        "object": "radical",
        "data": {
            "level": 1,
            "slug": "gun",
            "characters": None,
            "character_images": [
                {"url": "https://example.com/gun.png", "content_type": "image/png"},
                {"url": "https://example.com/gun.svg", "content_type": "image/svg+xml"},
            ],
            "meanings": [{"meaning": "Gun", "primary": True, "accepted_answer": True}],
        },
    }
    subject = parse_subject(resource)
    assert subject.characters is None
    # SVG is preferred over the PNG regardless of order.
    assert subject.character_image_url.endswith(".svg")
