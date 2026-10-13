"""Add English translations and explanations to waiting practice questions.

Questions generated before 2026-10-13 have no `translation` or `explanations`,
so answering one shows no English and no reasons. This asks the model for
them, in batches, for questions in unconsumed bundles.

    .venv/Scripts/python scripts/backfill_explanations.py [--dry-run] [--redo]

`--redo` rewrites them even where they exist.
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
from app.services.lessons import backfill_explanations  # noqa: E402

# Explanations run long; smaller batches keep each call well under its limit.
BATCH = 12


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
            todo = [q for q in rows if redo or not (q.payload or {}).get("translation")]
            print(f"{len(rows)} waiting questions, {len(todo)} to explain")

            written = 0
            for start in range(0, len(todo), BATCH):
                chunk = todo[start : start + BATCH]
                added = await backfill_explanations(
                    [{"id": q.id, "type": q.type, "payload": q.payload} for q in chunk]
                )
                for question in chunk:
                    extra = added.get(question.id)
                    notes = len(extra.get("explanations", [])) if extra else 0
                    print(f"  #{question.id}: translation={bool(extra)} explanations={notes}")
                    if extra and not dry_run:
                        question.payload = {**question.payload, **extra}
                        flag_modified(question, "payload")
                        written += 1
            if dry_run:
                await session.rollback()
                print("dry run: nothing written")
            else:
                print(f"wrote English to {written} questions")
    finally:
        await dispose_engine()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--redo", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.dry_run, args.redo))
