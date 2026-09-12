"""Seed just enough real-shaped data to exercise lesson generation.

Two problems this solves, and they are different:

**Vocabulary is not actually missing, only unprojected.** `sync` fills
`subjects` and `study_progress`; `vocab_items` — the table questions point at —
stays empty until `project_wanikani_vocabulary` runs. So the vocab half of this
script is not sample data at all: it promotes words the account has genuinely
started into the table the generator reads.

**The imported-vocabulary track is genuinely empty**, and that half *is*
samples: a page of eight textbook words committed through `create_flashcards`,
the same call the confirm route uses, so they get real answers and real SRS
state rather than rows that look right and grade wrong. Without them the quiz
has no cards and the set browser is empty.

**Grammar is genuinely empty too**, and that half is samples as well. Three common N4/N3
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
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.db import repository as repo
from app.db.models import (
    GrammarEntry,
    GrammarExample,
    SrsState,
    VocabAnswer,
    VocabItem,
    VocabReviewLog,
    VocabSet,
    VocabSetItem,
    VocabSource,
)
from app.db.session import dispose_engine, session_scope
from app.schemas import DetectedItem

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


# A page the way an extraction would hand it back: three columns kept apart,
# a couple of usage contexts, one word printed without a reading. Realistic
# enough that the review screen, the grader and the SRS all see their real
# shapes rather than tidy placeholder strings.
SAMPLE_PAGE = [
    ("免許", "めんきょ", "licence; permit", None),
    ("働き始める", "はたらきはじめる", "to start working", None),
    ("決心（する）", "けっしん", "determination; resolve", None),
    ("[〜が]苦手な", "にがてな", "not good at; poor at", "〜が"),
    ("相手", "あいて", "partner; the other person", None),
    ("つまり", "つまり", "in other words; that is to say", None),
    ("なおす", "なおす", "to fix; to cure", "病気を"),
    ("結婚（する）", "けっこん", "marriage", None),
]


async def seed_imported_deck(session, user_id: int) -> int:
    """Give the imported-vocabulary track something to study.

    Goes through `create_flashcards`, the same call the confirm route uses, so
    the seeded rows get the three writes a real import gets — the word, the
    answers that count for it, and an SRS place per skill. Hand-building the
    rows would produce a deck that looks right and grades wrong.

    Without this the quiz screen has no cards, the set browser is empty, and
    `srs_state` has no rows at all — which also means the review pool a lesson
    draws from contains no imported words.
    """
    existing = await session.execute(
        select(VocabSource).where(VocabSource.label == SEED_MARKER)
    )
    if existing.scalars().first() is not None:
        return 0

    source = VocabSource(
        user_id=user_id,
        status="processed",
        label=SEED_MARKER,
        jlpt_level=3,
    )
    session.add(source)
    await session.flush()

    vocab_set = VocabSet(user_id=user_id, name="Sample page")
    session.add(vocab_set)
    await session.flush()

    detected = [
        DetectedItem(
            key=f"seed-{i}",
            kanji_furigana=written,
            furigana_only=reading,
            english=english,
            usage_context=context,
            jlpt_level=3,
            status="ok",
            selected=True,
        )
        for i, (written, reading, english, context) in enumerate(SAMPLE_PAGE)
    ]

    created = await repo.create_flashcards(
        session,
        detected,
        user_id=user_id,
        source_image_id=source.id,
        set_id=vocab_set.id,
    )

    # Backdate half the schedule so the quiz has something due immediately.
    # Everything due "now" is realistic on day one but leaves nothing to test
    # the due-card path with.
    states = await session.execute(
        select(SrsState).where(SrsState.user_id == user_id)
    )
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    for index, state in enumerate(states.scalars()):
        if index % 2 == 0:
            state.due_at = yesterday

    await session.flush()
    return len(created)


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

        cards = await seed_imported_deck(session, user.id)
        print(f"imported deck: added {cards} word(s) with answers and SRS state")

        pools = await repo.get_generation_pools(session, user.id)
        for name, items in pools.items():
            print(f"  pool {name}: {len(items)}")

    await dispose_engine()


async def remove() -> None:
    """Take the seeded samples back out.

    Removes the sample grammar and the sample imported page — everything this
    script invented. **Projected WaniKani vocabulary is left alone**: those are
    real words the account started, promoted into a table they belonged in, not
    samples, and deleting them would only mean running the projection again.
    """
    async with session_scope() as session:
        source = await session.execute(
            select(VocabSource).where(VocabSource.label == SEED_MARKER)
        )
        page = source.scalars().first()
        if page is not None:
            seeded = await session.execute(
                select(VocabItem.id).where(VocabItem.source_image_id == page.id)
            )
            item_ids = list(seeded.scalars())
            if item_ids:
                # Order matters: the schedule and the answers point at the word.
                await session.execute(
                    delete(VocabReviewLog).where(
                        VocabReviewLog.srs_state_id.in_(
                            select(SrsState.id).where(
                                SrsState.vocab_item_id.in_(item_ids)
                            )
                        )
                    )
                )
                await session.execute(
                    delete(SrsState).where(SrsState.vocab_item_id.in_(item_ids))
                )
                await session.execute(
                    delete(VocabAnswer).where(VocabAnswer.vocab_item_id.in_(item_ids))
                )
                await session.execute(
                    delete(VocabSetItem).where(VocabSetItem.vocab_item_id.in_(item_ids))
                )
                await session.execute(
                    delete(VocabItem).where(VocabItem.id.in_(item_ids))
                )
            await session.execute(
                delete(VocabSet).where(
                    VocabSet.user_id == page.user_id, VocabSet.name == "Sample page"
                )
            )
            await session.execute(delete(VocabSource).where(VocabSource.id == page.id))
            print(f"Removed the sample page and {len(item_ids)} word(s).")
        else:
            print("No sample page to remove.")

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
