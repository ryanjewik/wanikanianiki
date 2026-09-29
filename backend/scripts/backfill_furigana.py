"""Add readings to waiting practice questions that were generated without any.

Questions written before the generator could return furigana (fixed
2026-09-28) have none, so the reading toggle is greyed out on them -- and
bundles are handed out oldest first, so those are the ones a learner meets.
This asks the model for their readings, filters them exactly as new questions
are filtered (never the word being asked for), and writes them into the
payload. Only questions in unconsumed bundles, and only ones with no readings.

    .venv/Scripts/python scripts/backfill_furigana.py [--dry-run] [--redo]

`--redo` re-annotates every waiting question, not only the bare ones -- for
after the filter rules change (2026-09-29: the answer choice is now glossed
like the others, where leaving it bare had marked it).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm.attributes import flag_modified  # noqa: E402

from app.db.models import LessonBundle, LessonBundleQuestion, Question  # noqa: E402
from app.db.session import dispose_engine, session_scope  # noqa: E402
from app.services.lessons import backfill_readings  # noqa: E402


async def main(dry_run: bool, redo: bool) -> None:
    try:
        async with session_scope() as session:
            rows = (
                await session.execute(
                    select(Question)
                    .join(LessonBundleQuestion, LessonBundleQuestion.question_id == Question.id)
                    .join(LessonBundle, LessonBundle.id == LessonBundleQuestion.bundle_id)
                    .where(LessonBundle.consumed.is_(False))
                )
            ).scalars().all()
            bare = [q for q in rows if redo or not (q.payload or {}).get("furigana")]
            print(f"{len(rows)} waiting questions, {len(bare)} to annotate")
            if not bare:
                return

            readings = await backfill_readings(
                [{"id": q.id, "type": q.type, "payload": q.payload} for q in bare]
            )
            for question in bare:
                found = readings.get(question.id)
                print(f"  #{question.id}: {len(found) if found else 0} readings")
                if found and not dry_run:
                    question.payload = {**question.payload, "furigana": found}
                    flag_modified(question, "payload")
            if dry_run:
                await session.rollback()
                print("dry run: nothing written")
            else:
                print(f"wrote readings to {len(readings)} questions")
    finally:
        await dispose_engine()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--redo", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.dry_run, args.redo))
