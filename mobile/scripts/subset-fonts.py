#!/usr/bin/env python3
"""Subset the Japanese fonts down to what this app can actually render.

The full families are enormous — a single Shippori Mincho weight is 8.5MB, and
the six weights the app loads total ~26MB. Most of that is CJK coverage the app
will never ask for.

The two families are cut very differently, because they do different jobs:

**Zen Kaku Gothic New (sans) carries UI chrome only.** The design reserves
Japanese for the material being studied, so English is the only thing that
appears in sans — plus a handful of fixed glyphs (the `日` in "41日" on the
streak card is the one that actually ships today). Kana is kept anyway as cheap
insurance against future UI copy, and the ~16 kanji that appear in chrome are
listed explicitly. Everything else goes. 2.3MB becomes ~73KB.

**Shippori Mincho (serif) carries the study material**, so it cannot be cut to
a fixed list — the app renders whatever WaniKani returns, and Part 2 will render
whatever a user photographs out of a textbook. Tofu here would be a correctness
bug, not a cosmetic one. It is cut to **JIS X 0208**, the standard set covering
all modern Japanese: 6,356 kanji plus kana and punctuation. That still halves
the file, and nothing a Japanese textbook realistically contains falls outside
it.

The JIS X 0208 set is derived from Python's own `shift_jis` codec rather than a
vendored list, so there is no data file to go stale.

Usage:
    python scripts/subset-fonts.py            # write assets/fonts/
    python scripts/subset-fonts.py --check    # verify only, no writes

Requires `fonttools`:
    pip install fonttools

Sources are the installed @expo-google-fonts packages, which stay in
devDependencies purely so this script can be re-run.

Both families are SIL OFL 1.1. Neither declares a Reserved Font Name, so the
subsets keep the original family names; the licence is copied alongside them,
which OFL requires.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

# The mobile app root (mobile/), not the repo root — the backend lives
# alongside it and has nothing to do with fonts.
APP_ROOT = Path(__file__).resolve().parents[1]
NODE_MODULES = APP_ROOT / "node_modules" / "@expo-google-fonts"
OUT_DIR = APP_ROOT / "assets" / "fonts"

# --- coverage ---------------------------------------------------------------

BASIC_LATIN = set(range(0x20, 0x7F))
LATIN_1 = set(range(0xA0, 0x100))
GENERAL_PUNCT = set(range(0x2000, 0x2070))
FULLWIDTH = set(range(0xFF00, 0xFFF0))
KANA = set(range(0x3040, 0x3100))
CJK_PUNCT = set(range(0x3000, 0x3040))

# Symbols the UI draws as text rather than as SVG. Missing any of these shows a
# box in a button, so they are listed rather than assumed.
UI_SYMBOLS = {
    0x2039, 0x203A,          # ‹ ›  header back chevron, CTA chevron
    0x00B7,                  # ·    separators in metadata lines
    0x2713, 0x2714,          # ✓    review submit, import checkboxes
    0x2717, 0x2718,          # ✗
    0x2605, 0x2606,          # ★ ☆  favourite toggle on item detail
    0x266A,                  # ♪    play-audio button
    0x2190, 0x2192,          # ← →
    0x2013, 0x2014,          # – —
    0x2018, 0x2019,          # ' '  apostrophes in UI copy
    0x201C, 0x201D,          # " "
    0x2026,                  # …
    0x00D7,                  # ×    "seen 6× · level 4"
}

# Kanji that appear in UI chrome. Kept deliberately generous: the nav glyphs,
# the type glyphs, and the few that show up in labels and stats.
UI_KANJI = {ord(c) for c in "日家習写帳部字語私漢次音解終月時人本語学"}

SANS_COVERAGE = BASIC_LATIN | LATIN_1 | GENERAL_PUNCT | UI_SYMBOLS | KANA | CJK_PUNCT | UI_KANJI


def jis_x_0208() -> set[int]:
    """Every codepoint encodable in JIS X 0208, via the stdlib codec.

    `shift_jis` maps exactly JIS X 0208. Note `euc_jp` would be wrong here — it
    also covers JIS X 0212, which nearly doubles the kanji count for no benefit.
    """
    covered: set[int] = set()
    for codepoint in range(0x3000, 0xA000):
        try:
            chr(codepoint).encode("shift_jis")
        except UnicodeEncodeError:
            continue
        covered.add(codepoint)
    return covered


SERIF_COVERAGE = jis_x_0208() | BASIC_LATIN | LATIN_1 | GENERAL_PUNCT | FULLWIDTH | UI_SYMBOLS


# --- what to build ----------------------------------------------------------

FONTS = [
    # (package, weight dir, file stem, coverage)
    ("zen-kaku-gothic-new", "400Regular", "ZenKakuGothicNew_400Regular", "sans"),
    ("zen-kaku-gothic-new", "500Medium", "ZenKakuGothicNew_500Medium", "sans"),
    ("zen-kaku-gothic-new", "700Bold", "ZenKakuGothicNew_700Bold", "sans"),
    ("zen-kaku-gothic-new", "900Black", "ZenKakuGothicNew_900Black", "sans"),
    ("shippori-mincho", "500Medium", "ShipporiMincho_500Medium", "serif"),
    ("shippori-mincho", "700Bold", "ShipporiMincho_700Bold", "serif"),
]

COVERAGE = {"sans": SANS_COVERAGE, "serif": SERIF_COVERAGE}


def subset_one(source: Path, target: Path, unicodes: set[int]) -> tuple[float, float]:
    from fontTools.subset import Options, Subsetter
    from fontTools.ttLib import TTFont

    options = Options()
    # Keep every OpenType feature: Japanese needs them for alternate and
    # vertical forms, and they cost almost nothing next to the glyph outlines.
    options.layout_features = ["*"]
    options.hinting = False
    # Keep .notdef so an unexpected glyph renders as a visible box rather than
    # failing the whole text run.
    options.notdef_outline = True
    options.drop_tables += ["DSIG"]

    font = TTFont(source)
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    target.parent.mkdir(parents=True, exist_ok=True)
    font.save(target)
    font.close()

    return source.stat().st_size / 1e6, target.stat().st_size / 1e6


def verify(target: Path, required: set[int], label: str) -> list[int]:
    """Confirm every requested codepoint that the ORIGINAL had survived.

    Reported as missing only if the source font had it — a font simply not
    covering a codepoint is not a subsetting failure.
    """
    from fontTools.ttLib import TTFont

    font = TTFont(target, lazy=True)
    present: set[int] = set()
    for table in font["cmap"].tables:
        present |= set(table.cmap.keys())
    font.close()
    return sorted(required - present)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify without writing")
    args = parser.parse_args()

    if not NODE_MODULES.exists():
        print(f"error: {NODE_MODULES} not found — run `npm install` first", file=sys.stderr)
        return 1

    print(f"sans coverage:  {len(SANS_COVERAGE):>6} codepoints")
    print(f"serif coverage: {len(SERIF_COVERAGE):>6} codepoints "
          f"({sum(1 for c in SERIF_COVERAGE if 0x4E00 <= c <= 0x9FFF)} kanji)\n")

    total_before = total_after = 0.0
    failures = 0

    for package, weight, stem, kind in FONTS:
        source = NODE_MODULES / package / weight / f"{stem}.ttf"
        target = OUT_DIR / f"{stem}.ttf"

        if not source.exists():
            print(f"  MISSING SOURCE {source}", file=sys.stderr)
            failures += 1
            continue

        if args.check:
            if not target.exists():
                print(f"  {stem:34} NOT BUILT")
                failures += 1
                continue
            before = source.stat().st_size / 1e6
            after = target.stat().st_size / 1e6
        else:
            before, after = subset_one(source, target, COVERAGE[kind])

        # Only hold the subset to what the source could actually supply.
        from fontTools.ttLib import TTFont

        src_font = TTFont(source, lazy=True)
        src_cps: set[int] = set()
        for table in src_font["cmap"].tables:
            src_cps |= set(table.cmap.keys())
        src_font.close()

        expected = COVERAGE[kind] & src_cps
        missing = verify(target, expected, stem)

        total_before += before
        total_after += after
        status = "OK" if not missing else f"MISSING {len(missing)} glyphs"
        if missing:
            failures += 1
        print(f"  {stem:34} {before:6.2f}MB -> {after:6.2f}MB  {status}")

    print(f"\n  {'TOTAL':34} {total_before:6.2f}MB -> {total_after:6.2f}MB "
          f"({(1 - total_after / total_before) * 100:.0f}% smaller)")

    if not args.check:
        # OFL requires the licence to travel with the fonts.
        for package, name in (("shippori-mincho", "ShipporiMincho"),
                              ("zen-kaku-gothic-new", "ZenKakuGothicNew")):
            licence = NODE_MODULES / package / "LICENSE_FONT"
            if licence.exists():
                shutil.copyfile(licence, OUT_DIR / f"OFL-{name}.txt")
        print(f"\n  licences copied to {OUT_DIR.relative_to(APP_ROOT)}/")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
