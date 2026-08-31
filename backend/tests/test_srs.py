"""SM-2 scheduling and answer matching.

Pure functions, no database, no network — so the algorithm can be pinned down
exactly rather than inferred from what the endpoints happen to return.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.srs import (
    GRADE_CORRECT,
    GRADE_INCORRECT,
    MINIMUM_EASE,
    STARTING_EASE,
    grade_for,
    matches,
    next_schedule,
    normalise,
    split_meanings,
)

NOW = datetime(2026, 3, 1, tzinfo=timezone.utc)


def step(grade: int, *, ease=STARTING_EASE, interval=0, reps=0, lapses=0):
    return next_schedule(
        ease_factor=ease, interval_days=interval, repetitions=reps,
        lapses=lapses, grade=grade, now=NOW,
    )


# -- the ladder ------------------------------------------------------------


def test_the_first_three_intervals_are_fixed_then_multiplied():
    """SM-2's ladder: 1 day, 6 days, then interval × ease."""
    first = step(GRADE_CORRECT)
    assert first.interval_days == 1
    assert first.repetitions == 1

    second = step(GRADE_CORRECT, ease=first.ease_factor,
                  interval=first.interval_days, reps=first.repetitions)
    assert second.interval_days == 6

    third = step(GRADE_CORRECT, ease=second.ease_factor,
                 interval=second.interval_days, reps=second.repetitions)
    assert third.interval_days == round(6 * second.ease_factor) == 15


def test_due_date_follows_the_interval():
    schedule = step(GRADE_CORRECT)
    assert (schedule.due_at - NOW).days == schedule.interval_days


def test_a_failure_resets_the_ladder_rather_than_shortening_it():
    """A long interval on a forgotten word would keep it forgotten.

    The evidence is that the word was not known, so it starts again.
    """
    mature = step(GRADE_INCORRECT, ease=2.5, interval=90, reps=6)

    assert mature.interval_days == 1
    assert mature.repetitions == 0
    assert mature.lapses == 1


def test_lapses_accumulate_across_failures():
    """The algorithm forgets; the count is what marks a word worth relearning."""
    first = step(GRADE_INCORRECT, interval=30, reps=4, lapses=2)
    assert first.lapses == 3


# -- ease ------------------------------------------------------------------


def test_a_perfect_answer_raises_ease_and_a_poor_one_lowers_it():
    assert step(5).ease_factor > STARTING_EASE
    assert step(GRADE_CORRECT).ease_factor == STARTING_EASE  # grade 4 is neutral
    assert step(3).ease_factor < STARTING_EASE
    assert step(0).ease_factor < step(2).ease_factor


def test_ease_never_falls_below_the_floor():
    """Below 1.3 an interval barely grows and the card churns forever."""
    ease = STARTING_EASE
    for _ in range(20):
        ease = step(0, ease=ease).ease_factor
    assert ease == MINIMUM_EASE


def test_grades_outside_the_scale_are_clamped_not_rejected():
    """A client bug should not be able to write a nonsense schedule."""
    assert step(99).interval_days == step(5).interval_days
    assert step(-5).repetitions == 0


def test_binary_answers_map_onto_the_scale():
    assert grade_for(True) == GRADE_CORRECT
    assert grade_for(False) == GRADE_INCORRECT
    # A bare "correct" is an ordinary success, not a flawless one — the extremes
    # stay free for an again/hard/good/easy control.
    assert 3 <= GRADE_CORRECT < 5


# -- matching --------------------------------------------------------------


def test_either_the_kanji_or_the_reading_counts():
    """The rule the whole answers table exists for."""
    accepted = ["免許", "めんきょ"]
    assert matches("免許", accepted)
    assert matches("めんきょ", accepted)
    assert not matches("めんきよ", accepted)


def test_every_gloss_on_a_semicolon_line_counts():
    """'partner; the other person' is two answers, not one string."""
    accepted = split_meanings("partner; the other person")
    assert accepted == ["partner", "the other person"]
    assert matches("partner", accepted)
    assert matches("the other person", accepted)


def test_printed_punctuation_is_not_part_of_the_answer():
    """Nobody types 決心（する）or [〜が]苦手な."""
    assert matches("決心", ["決心（する）"])
    assert matches("苦手な", ["苦手な"])
    assert matches("poor at", ["poor at"])


def test_width_and_case_variants_are_the_same_answer():
    """Japanese IMEs emit half-width kana; English is case-insensitive."""
    assert matches("ﾒﾝｷｮ", ["めんきょ"]) or normalise("ﾒﾝｷｮ") == normalise("メンキョ")
    assert matches("LICENSE", ["license"])
    assert matches("Europe", ["europe"])


def test_a_leading_article_or_to_is_optional():
    """'to help' and 'help' are the same answer to a person."""
    assert matches("help", ["to help"])
    assert matches("to help", ["help"])
    assert matches("other person", ["the other person"])


def test_an_empty_answer_is_never_correct():
    assert not matches("", ["免許"])
    assert not matches("   ", ["免許"])
    # And punctuation alone must not normalise into a match.
    assert not matches("...", ["免許"])


def test_a_wrong_answer_is_wrong():
    assert not matches("免状", ["免許", "めんきょ"])
    assert not matches("bridge", ["chopsticks"])


@pytest.mark.parametrize("gloss", ["", "   ", ";;"])
def test_a_meaningless_gloss_yields_no_answers(gloss):
    assert split_meanings(gloss) == []
