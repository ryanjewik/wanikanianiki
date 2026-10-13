"""Load KANJIDIC2 into kanji_features: stroke count, grade, frequency, old JLPT.

KANJIDIC2 is the Electronic Dictionary Research and Development Group's kanji
file (https://www.edrdg.org/kanjidic/kanjidic2.html), used under its Creative
Commons Attribution-ShareAlike licence. It is the source the ISyE 6740
proposal cites for item features.

    .venv/Scripts/python scripts/import_kanjidic.py path/to/kanjidic2.xml.gz

Takes the .xml or the .xml.gz as downloaded. Idempotent: rows are upserted by
character, so a newer file can be loaded over an older one.
"""

from __future__ import annotations

import argparse
import asyncio
import gzip
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402

from app.db.models import KanjiFeature  # noqa: E402
from app.db.session import dispose_engine, session_scope  # noqa: E402

BATCH = 1000


def _int(element: ET.Element | None) -> int | None:
    try:
        return int(element.text) if element is not None and element.text else None
    except ValueError:
        return None


def parse(path: Path):
    """Yields one row per <character>, streaming: the file is ~13,000 kanji."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as handle:
        for _event, element in ET.iterparse(handle, events=("end",)):
            if element.tag != "character":
                continue
            misc = element.find("misc")
            radical = element.find("radical/rad_value[@rad_type='classical']")
            readings = element.findall("reading_meaning/rmgroup/reading")
            meanings = [
                m.text
                for m in element.findall("reading_meaning/rmgroup/meaning")
                if "m_lang" not in m.attrib and m.text
            ]
            yield {
                "character": element.findtext("literal"),
                # The first stroke count is the accepted one; later ones are
                # common miscounts.
                "stroke_count": _int(misc.find("stroke_count")) if misc is not None else None,
                "grade": _int(misc.find("grade")) if misc is not None else None,
                "frequency": _int(misc.find("freq")) if misc is not None else None,
                "jlpt_old": _int(misc.find("jlpt")) if misc is not None else None,
                "radical": _int(radical),
                "on_readings": [r.text for r in readings if r.get("r_type") == "ja_on" and r.text],
                "kun_readings": [
                    r.text for r in readings if r.get("r_type") == "ja_kun" and r.text
                ],
                "meanings": meanings,
            }
            element.clear()


async def load(path: Path) -> int:
    total = 0
    batch: list[dict] = []
    try:
        async with session_scope() as session:
            for row in parse(path):
                if not row["character"]:
                    continue
                batch.append(row)
                if len(batch) >= BATCH:
                    total += await _upsert(session, batch)
                    batch = []
            if batch:
                total += await _upsert(session, batch)
    finally:
        await dispose_engine()
    return total


async def _upsert(session, rows: list[dict]) -> int:
    statement = pg_insert(KanjiFeature).values(rows)
    statement = statement.on_conflict_do_update(
        index_elements=[KanjiFeature.character],
        set_={c: statement.excluded[c] for c in rows[0] if c != "character"},
    )
    await session.execute(statement)
    return len(rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="kanjidic2.xml or kanjidic2.xml.gz")
    loaded = asyncio.run(load(parser.parse_args().path))
    print(f"loaded {loaded} kanji")
