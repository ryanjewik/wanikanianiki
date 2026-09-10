"""Seed just enough real-shaped data to exercise lesson generation.

Two problems this solves, and they are different:

**Vocabulary is not actually missing, only unprojected.** `sync` fills
`subjects` and `study_progress`; `vocab_items` — the table questions point at —
stays empty until `project_wanikani_vocabulary` runs. So the vocab half of this
script is not sample data at all: it promotes words the account has genuinely
started into the table the generator reads.

**Grammar is genuinely empty**, and that half *is* samples. Three common N4/N3
patterns, written the way enrichment would leave them and marked `enriched` so
they are eligible as generation context. They are labelled in `source` so they
can be found and removed again.

```bash
.venv/Scripts/python scripts/seed_lesson_samples.py          # add
.venv/Scripts/python scripts/seed_lesson_samples.py --remove # take the grammar back out
```

Reads `.env` like everything else. Idempotent: running it twice adds nothing.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import date, timedelta

from sqlalchemy import delete, select

from app.db import repository as repo
from app.db.models import GrammarEntry, GrammarExample
from app.db.session import dispose_engine, session_scope

# Stamped on every seeded row so `--remove` can find exactly these and nothing
# a person actually logged.
SEED_MARKER = "seed:lesson-samples"


SAMPLE_GRAMMAR = [
    {
        "pattern": "～てから",
        "meaning": "after doing X, then Y — the order matters",
        "formation": "Vて + から + clause",
        "style": "plain",
        "jlpt_level": 5,
        "examples": [
            ("宿題をしてから、ゲームをします。", "After I do my homework, I play games."),
            ("手を洗ってから食べてください。", "Please wash your hands before eating."),
        ],
    },
    {
        "pattern": "～ことができる",
        "meaning": "can do X; to be able to do X",
        "formation": "Vdict + ことができる",
        "style": "polite",
        "jlpt_level": 4,
        "examples": [
            ("日本語を話すことができます。", "I can speak Japanese."),
            ("ここで写真を撮ることができません。", "You cannot take photos here."),
        ],
    },
    {
        "pattern": "～ながら",
        "meaning": "while doing X, also do Y — two actions by one subject",
        "formation": "Vます-stem + ながら",
        "style": "plain",
        "jlpt_level": 4,
        "examples": [
            ("音楽を聞きながら勉強します。", "I study while listening to music."),
            ("歩きながら本を読まないでください。", "Please don't read while walking."),
        ],
    },
]


async def seed() -> None:
    async with session_scope() as session:
        user = await repo.get_default_user(session)
        if user is None:
            print("No user yet — run a sync first, then this.")
            return

        projected = await repo.project_wanikani_vocabulary(session, user.id)
        print(f"vocab_items: projected {projected} started WaniKani word(s)")

        existing = await session.execute(
            select(GrammarEntry.pattern).where(GrammarEntry.source == SEED_MARKER)
        )
        already = set(existing.scalars())

        added = 0
        for offset, sample in enumerate(SAMPLE_GRAMMAR):
            if sample["pattern"] in already:
                continue

            entry = GrammarEntry(
                user_id=user.id,
                pattern=sample["pattern"],
                meaning=sample["meaning"],
                formation=sample["formation"],
                style=sample["style"],
                jlpt_level=sample["jlpt_level"],
                source=SEED_MARKER,
                # Staggered so they do not all land on one calendar day, which
                # is what a week of real logging looks like.
                learned_on=date.today() - timedelta(days=offset * 2),
                # Marked confirmed on purpose: only enriched entries are
                # eligible as generation context, and the point of seeding is
                # to make grammar-aware questions reachable.
                enriched=True,
            )
            session.add(entry)
            await session.flush()

            for japanese, english in sample["examples"]:
                session.add(
                    GrammarExample(
                        grammar_entry_id=entry.id,
                        japanese=japanese,
                        english=english,
                        is_user_supplied=False,
                    )
                )
            added += 1

        print(f"grammar_entries: added {added} sample pattern(s)")

        pools = await repo.get_generation_pools(session, user.id)
        for name, items in pools.items():
            print(f"  pool {name}: {len(items)}")

    await dispose_engine()


async def remove() -> None:
    """Take the seeded grammar back out. Projected vocabulary is left alone —
    those are real words the account started, not samples."""
    async with session_scope() as session:
        entries = await session.execute(
            select(GrammarEntry.id).where(GrammarEntry.source == SEED_MARKER)
        )
        ids = list(entries.scalars())
        if not ids:
            print("Nothing seeded to remove.")
            return

        await session.execute(
            delete(GrammarExample).where(GrammarExample.grammar_entry_id.in_(ids))
        )
        await session.execute(delete(GrammarEntry).where(GrammarEntry.id.in_(ids)))
        print(f"Removed {len(ids)} seeded grammar entr(ies).")

    await dispose_engine()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remove", action="store_true", help="Delete seeded grammar.")
    args = parser.parse_args()

    asyncio.run(remove() if args.remove else seed())
