"""SM-2 scheduling, and answer matching.

Two pure pieces, both deliberately free of the database so they can be tested
exhaustively and reasoned about on their own.

**This schedules imported vocabulary only.** WaniKani items keep WaniKani's
stage, mirrored through `study_progress` and never recomputed here. Two systems
that never touch cannot disagree about the same word.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# SM-2's floor. Below this a card's interval barely grows and it may as well be
# in a relearning queue; the original algorithm clamps here for that reason.
MINIMUM_EASE = 1.3
STARTING_EASE = 2.5

# The quality threshold SM-2 treats as a pass.
PASSING_GRADE = 3

# What a plain right/wrong maps onto. Not 5 and 0: a bare "correct" is an
# ordinary success, not a flawless one, and reserving the extremes leaves room
# for an again/hard/good/easy control later without re-tuning everything.
GRADE_CORRECT = 4
GRADE_INCORRECT = 2


@dataclass(frozen=True)
class Schedule:
    """The state a review produces. Nothing here reads or writes anything."""

    ease_factor: float
    interval_days: int
    repetitions: int
    lapses: int
    due_at: datetime


def next_schedule(
    *,
    ease_factor: float,
    interval_days: int,
    repetitions: int,
    lapses: int,
    grade: int,
    now: datetime | None = None,
) -> Schedule:
    """One SM-2 step.

    The ladder for a passing answer is 1 day, then 6, then multiplied by the
    card's ease from there. A failing answer resets the ladder rather than
    shortening it: the evidence is that the word was not known, and continuing
    from a long interval would keep it that way.

    Ease moves on every answer, by SM-2's formula. It falls faster the worse
    the answer, so a card repeatedly half-remembered drifts toward showing up
    often, which is the behaviour you want.
    """
    now = now or datetime.now(timezone.utc)
    grade = max(0, min(5, grade))

    if grade >= PASSING_GRADE:
        if repetitions == 0:
            interval = 1
        elif repetitions == 1:
            interval = 6
        else:
            interval = max(1, round(interval_days * ease_factor))
        repetitions += 1
    else:
        # Back to the start of the ladder, and remembered as a lapse. Due again
        # tomorrow rather than in minutes: this is a vocabulary deck, not a
        # cramming session, and same-day re-asks mostly test short-term memory.
        repetitions = 0
        interval = 1
        lapses += 1

    # SM-2's ease adjustment, verbatim. At grade 4 it is unchanged; at 5 it
    # rises; below 4 it falls, and steeply at 0.
    ease = ease_factor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    ease = max(MINIMUM_EASE, ease)

    return Schedule(
        ease_factor=round(ease, 4),
        interval_days=interval,
        repetitions=repetitions,
        lapses=lapses,
        due_at=now + timedelta(days=interval),
    )


def grade_for(correct: bool) -> int:
    """Map a plain right/wrong onto SM-2's 0-5 scale."""
    return GRADE_CORRECT if correct else GRADE_INCORRECT


# -- answer matching -------------------------------------------------------


def normalise(value: str) -> str:
    """Fold away everything that is not the answer.

    Japanese input arrives with width and composition variants that are the
    same character to a reader — ﾒﾝｷｮ against めんきょ, ａ against a — so NFKC
    first. Then the punctuation a textbook prints around a word but nobody
    types: 決心（する）is answered "決心", and [〜が]苦手な is answered "苦手な".

    English gets case and article folding, because "the other person" and
    "other person" are the same answer and marking one wrong teaches nothing.
    """
    value = unicodedata.normalize("NFKC", value).strip().lower()
    # Bracketed or parenthesised qualifiers: (polite), （する）, [vt.]
    value = re.sub(r"[（(\[][^）)\]]*[）)\]]", "", value)
    # Textbook placeholders and separators that are not part of the answer.
    value = value.replace("〜", "").replace("~", "")
    value = re.sub(r"^(to|a|an|the)\s+", "", value)
    value = re.sub(r"[\s.,!?;:・…'\"’]+", "", value)
    return value


def matches(given: str, accepted: list[str]) -> bool:
    """Whether a typed answer counts.

    Any accepted value matching is enough — that is the whole point of storing
    them separately. A card asking for the Japanese passes both the written form
    and the reading, so 免許 and めんきょ are both right; one asking for the
    meaning passes every gloss the page printed, so "partner" is right even
    though the line read "partner; the other person".
    """
    if not given.strip():
        return False
    needle = normalise(given)
    if not needle:
        return False
    return any(needle == normalise(value) for value in accepted if value.strip())


def split_meanings(english: str) -> list[str]:
    """A printed gloss into the answers it actually contains.

    Textbooks separate alternatives with semicolons — "to save; to help [vt.]",
    "partner; the other person". Kept whole, the second half of every such line
    is an answer a person can never give correctly.
    """
    parts = [part.strip() for part in re.split(r"[;；]", english)]
    return [part for part in parts if part]
