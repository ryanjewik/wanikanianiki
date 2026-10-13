"""Recompute history columns on stored answer events from the scheduler logs.

`prev_answered_at`, `elapsed_s`, `prior_correct` and `prior_incorrect` are
filled on insert. Run this after the way they are derived changes (2026-10-13:
from the scheduler logs rather than answer_events alone) to bring rows already
stored up to date. Idempotent.

    .venv/Scripts/python scripts/recompute_answer_history.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import repository as repo  # noqa: E402
from app.db.models import AnswerEvent  # noqa: E402
from app.db.session import dispose_engine, session_scope  # noqa: E402


async def main() -> None:
    try:
        async with session_scope() as session:
            events = (
                await session.execute(select(AnswerEvent).order_by(AnswerEvent.answered_at))
            ).scalars().all()
            changed = 0
            for event in events:
                prev_at, right, wrong = await repo.answer_history(
                    session,
                    event.user_id,
                    srs_state_id=event.srs_state_id,
                    subject_id=event.subject_id,
                    question_kind=event.question_kind,
                    question_id=event.question_id,
                    answered_at=event.answered_at,
                )
                elapsed = int((event.answered_at - prev_at).total_seconds()) if prev_at else None
                if (event.prev_answered_at, event.elapsed_s, event.prior_correct,
                        event.prior_incorrect) != (prev_at, elapsed, right, wrong):
                    event.prev_answered_at = prev_at
                    event.elapsed_s = elapsed
                    event.prior_correct = right
                    event.prior_incorrect = wrong
                    changed += 1
            print(f"{len(events)} events, {changed} updated")
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
