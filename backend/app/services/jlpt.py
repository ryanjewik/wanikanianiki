"""JLPT coverage: how much of each tier the learner actually knows.

Deliberately **not** a readiness score. The exam tests grammar and listening
too, neither of which this app sees, so everything here is framed and named as
*kanji coverage toward a tier* — the design note is explicit about that, and
the difference matters: a bar reading 100% must not be mistaken for "ready to
sit N3".

**There is no `jlpt_reference` table**, which the design note called for. The
reference data is 2,211 rows that change roughly never — the JLPT lists have
been stable since the 2010 reform — so it lives as a vendored JSON file loaded
once into memory instead. A table would need a migration, a seed step, and a
way to notice when the two had drifted apart; the file needs none of those and
is the same data. If the reference ever grows a second source, or has to be
joined against in SQL rather than counted in Python, that trade flips.

Vocabulary is out of scope by decision, not by omission: the upstream dataset
is kanji only, and covering vocabulary would mean vendoring a second list on a
licence nobody has checked. Radicals are not JLPT items at all.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import StudyProgress, Subject

DATA = Path(__file__).resolve().parent.parent / "data" / "jlpt_kanji.json"

#: N5 first. The exam numbers them the other way round — N1 is hardest — but a
#: progress display reads as a ladder you climb, so it is ordered as one.
TIERS = (5, 4, 3, 2, 1)


@lru_cache(maxsize=1)
def tier_of() -> dict[str, int]:
    """Character to JLPT tier, read once per process."""
    return json.loads(DATA.read_text(encoding="utf-8"))["levels"]


@lru_cache(maxsize=1)
def totals() -> dict[int, int]:
    """How many kanji each tier contains — the denominators.

    From the reference list rather than from `subjects`, which holds only what
    this user has synced. Counting the denominator out of our own table would
    make coverage rise as you unlocked kanji and be permanently 100%.
    """
    counts = dict.fromkeys(TIERS, 0)
    for tier in tier_of().values():
        if tier in counts:
            counts[tier] += 1
    return counts


async def coverage(session: AsyncSession, user_id: int) -> list[dict]:
    """Per-tier counts of kanji passed, started, and in the tier overall.

    "Passed" is WaniKani's own `passed_at`, so this adds no new notion of
    mastery — it is the existing one, sliced a different way. "Started" is
    unlocked but not yet passed, which is what makes the bar two-tone and
    stops a tier you are halfway through reading as untouched.
    """
    rows = (
        await session.execute(
            select(Subject.characters, StudyProgress.passed_at)
            .join(StudyProgress, StudyProgress.subject_id == Subject.subject_id)
            .where(
                StudyProgress.user_id == user_id,
                Subject.type == "kanji",
                Subject.characters.is_not(None),
            )
        )
    ).all()

    levels = tier_of()
    passed = dict.fromkeys(TIERS, 0)
    started = dict.fromkeys(TIERS, 0)

    for characters, passed_at in rows:
        tier = levels.get((characters or "").strip())
        if tier is None:
            # A kanji WaniKani teaches that sits on no JLPT list. Real, and
            # correctly counted towards nothing.
            continue
        if passed_at is not None:
            passed[tier] += 1
        else:
            started[tier] += 1

    every = totals()
    return [
        {
            "level": tier,
            "total": every[tier],
            "passed": passed[tier],
            "started": started[tier],
        }
        for tier in TIERS
    ]
