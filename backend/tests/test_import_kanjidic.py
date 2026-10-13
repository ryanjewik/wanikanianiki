"""The KANJIDIC2 parser: the fields the memory models use, from the real format."""

from __future__ import annotations

import gzip
import importlib.util
from pathlib import Path

SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<kanjidic2>
<character>
<literal>山</literal>
<radical><rad_value rad_type="classical">46</rad_value></radical>
<misc><grade>1</grade><stroke_count>3</stroke_count><stroke_count>4</stroke_count>
<freq>131</freq><jlpt>4</jlpt></misc>
<reading_meaning><rmgroup>
<reading r_type="ja_on">サン</reading><reading r_type="ja_kun">やま</reading>
<meaning>mountain</meaning><meaning m_lang="fr">montagne</meaning>
</rmgroup></reading_meaning>
</character>
<character>
<literal>々</literal>
<misc><stroke_count>3</stroke_count></misc>
</character>
</kanjidic2>
"""


def _module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "import_kanjidic.py"
    spec = importlib.util.spec_from_file_location("import_kanjidic", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_parse_reads_strokes_grade_frequency_and_jlpt(tmp_path):
    path = tmp_path / "kanjidic2.xml.gz"
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write(SAMPLE)

    rows = list(_module().parse(path))

    mountain = rows[0]
    assert mountain["character"] == "山"
    # The first stroke count is the accepted one; the rest are miscounts.
    assert mountain["stroke_count"] == 3
    assert (mountain["grade"], mountain["frequency"], mountain["jlpt_old"]) == (1, 131, 4)
    assert mountain["radical"] == 46
    assert mountain["on_readings"] == ["サン"] and mountain["kun_readings"] == ["やま"]
    # English meanings only.
    assert mountain["meanings"] == ["mountain"]
    # Missing fields are None, not errors.
    assert rows[1]["grade"] is None and rows[1]["stroke_count"] == 3
