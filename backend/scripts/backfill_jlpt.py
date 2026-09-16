"""Fill in `subjects.jlpt_level` from the vendored JLPT kanji list.

WaniKani's API does not expose a JLPT tier — it has its own level scale and no
opinion about the exam — which is why the column exists but nothing populates
it. `upsert_subjects` already anticipates this: it deliberately leaves
`jlpt_level` out of its conflict update set so that a sync cannot wipe what this
script writes. Running it is the missing half of that arrangement.

```bash
.venv/Scripts/python scripts/backfill_jlpt.py           # report, change nothing
.venv/Scripts/python scripts/backfill_jlpt.py --write   # apply
```

Idempotent, and safe to re-run after every level-up: new kanji arrive untiered
from the sync and this fills them in.

**Kanji only, by decision.** Vocabulary and radicals keep a null tier. Radicals
are not JLPT items; vocabulary is a deliberate scope choice, since JLPT has
published no official vocabulary list since 2010 and the community ones
disagree. See `app/data/README.md`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from pathlib import Path

from sqlalchemy import select

from app.db.models import Subject
from app.db.session import dispose_engine, session_scope

DATA = Path(__file__).resolve().parent.parent / "app" / "data" / "jlpt_kanji.json"

#: How far our own WaniKani level may sit from the upstream dataset's before it
#: is worth reporting. The two are independently maintained and drift by a
#: level or two routinely; a large gap means they disagree about what the kanji
#: *is*, which is worth a human look.
DRIFT_TOLERANCE = 5


def load() -> tuple[dict[str, int], dict[str, int]]:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    return payload["levels"], payload.get("wanikaniLevels", {})


async def run(write: bool) -> None:
    try:
        levels, wk_levels = load()

        async with session_scope() as session:
            subjects = (
                await session.execute(select(Subject).where(Subject.type == "kanji"))
            ).scalars().all()

            changed = 0
            unmatched: list[str] = []
            drifted: list[str] = []
            tiers: Counter[int] = Counter()

            for subject in subjects:
                character = (subject.characters or "").strip()
                tier = levels.get(character)

                if tier is None:
                    # Either a kanji outside every JLPT list — WaniKani teaches
                    # a few — or one whose character we store differently.
                    # Neither is an error; both are worth counting.
                    if character:
                        unmatched.append(character)
                    continue

                tiers[tier] += 1

                upstream = wk_levels.get(character)
                if upstream is not None and abs(upstream - subject.level) > DRIFT_TOLERANCE:
                    drifted.append(f"{character} (ours L{subject.level}, theirs L{upstream})")

                if subject.jlpt_level != tier:
                    subject.jlpt_level = tier
                    changed += 1

            print(f"{len(subjects)} kanji subjects")
            print(f"  matched   {sum(tiers.values())}")
            print(f"  no tier   {len(unmatched)}")
            for tier in sorted(tiers):
                print(f"    N{tier}: {tiers[tier]}")

            if drifted:
                print(f"\n  WaniKani level disagrees by more than {DRIFT_TOLERANCE}:")
                for line in drifted[:10]:
                    print(f"    {line}")

            if not write:
                print(f"\n{changed} rows would change. Re-run with --write to apply.")
                # Nothing is committed: session_scope commits on a clean exit,
                # so the assignments above have to be thrown away explicitly.
                await session.rollback()
                return

            print(f"\n{changed} rows updated.")
    finally:
        await dispose_engine()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write", action="store_true", help="Apply the changes. Otherwise reports only."
    )
    args = parser.parse_args()

    asyncio.run(run(args.write))
