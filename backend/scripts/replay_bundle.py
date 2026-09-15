"""Hand an already-played lesson bundle back to the queue, for testing the screen.

`claim_next_bundle` marks a bundle consumed on the way out, which is right in
production — a session started and abandoned still burned its questions, and
serving the same lesson twice is indistinguishable from the generator having
repeated itself. It is wrong when the thing being tested is the screen rather
than the content, because it means every UI change costs a generation run.

This flips `consumed` back. Nothing else: the questions were never deleted, so
a replayed bundle is byte-for-byte the lesson that was played before.

```bash
.venv/Scripts/python scripts/replay_bundle.py            # list what exists
.venv/Scripts/python scripts/replay_bundle.py --last     # replay the most recent
.venv/Scripts/python scripts/replay_bundle.py --id 3     # replay one by id
```

**Answering a replayed bundle moves real schedules again.** `answer_question`
has no already-answered guard — by design, since a question can legitimately
appear in more than one bundle — so every pass advances SM-2 for each
non-WaniKani word the questions point at. For a handful of test runs that is
noise in the deck rather than damage, and WaniKani-owned words are untouched
either way, but it is the reason this is a script you have to run and not a
button in the app.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import func, select

from app.db import repository as repo
from app.db.models import LessonBundle, LessonBundleQuestion
from app.db.session import dispose_engine, session_scope


async def _bundles(session, user_id: int) -> list[tuple[int, bool, int]]:
    """Every bundle for the user, with the number of questions in it."""
    rows = await session.execute(
        select(
            LessonBundle.id,
            LessonBundle.consumed,
            func.count(LessonBundleQuestion.question_id),
        )
        .outerjoin(LessonBundleQuestion, LessonBundleQuestion.bundle_id == LessonBundle.id)
        .where(LessonBundle.user_id == user_id)
        .group_by(LessonBundle.id, LessonBundle.consumed)
        .order_by(LessonBundle.generated_at)
    )
    return [(bid, consumed, count) for bid, consumed, count in rows]


async def run(bundle_id: int | None, last: bool) -> None:
    try:
        await _run(bundle_id, last)
    finally:
        # The branches below all return early, and an undisposed pool is left
        # to interpreter exit — which on Windows prints a wall of "Event loop
        # is closed" after the output that matters.
        await dispose_engine()


async def _run(bundle_id: int | None, last: bool) -> None:
    async with session_scope() as session:
        user = await repo.get_default_user(session)
        if user is None:
            print("No user synced yet — run a sync first.")
            return

        rows = await _bundles(session, user.id)
        if not rows:
            print("No bundles have ever been generated.")
            return

        if bundle_id is None and not last:
            waiting = sum(1 for _, consumed, _ in rows if not consumed)
            print(f"{len(rows)} bundles, {waiting} waiting to be served:\n")
            for bid, consumed, count in rows:
                state = "played" if consumed else "WAITING"
                print(f"  id={bid:<4} {state:<8} {count} questions")
            if waiting == 0:
                print("\nNothing left to serve. Replay one with --last or --id <n>.")
            return

        target = bundle_id
        if last:
            # The most recently generated consumed bundle — the one just played,
            # which is almost always the one worth looking at again.
            played = [bid for bid, consumed, _ in rows if consumed]
            if not played:
                print("Nothing has been played yet; the queue already has bundles.")
                return
            target = played[-1]

        bundle = await session.get(LessonBundle, target)
        if bundle is None or bundle.user_id != user.id:
            print(f"No bundle with id {target}.")
            return

        if not bundle.consumed:
            print(f"Bundle {target} is already waiting to be served.")
            return

        bundle.consumed = False
        bundle.consumed_at = None
        await session.flush()
        print(f"Bundle {target} is back in the queue. Open Study → Practice questions.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", type=int, help="Bundle id to put back in the queue.")
    parser.add_argument(
        "--last", action="store_true", help="Put the most recently played bundle back."
    )
    args = parser.parse_args()

    asyncio.run(run(args.id, args.last))
