"""Run real page photos through the real extractor, and time it.

Every test of the extraction injects a fake client, which proves the pipeline
handles the shapes but says nothing about whether the model reads a sideways
photo with show-through. This is the other half: one command, real API, real
pages, and the wall-clock number that `VISION_TIMEOUT_SECONDS` is currently
only guessing at.

    python scripts/extract_page.py ../vocab_samples/*.jpg

Reads `backend/.env` like everything else, so no arguments beyond the images.
Writes nothing to the database — it prints what an import *would* produce, so
it is safe to run against a live deck.
"""

from __future__ import annotations

import argparse
import asyncio
import glob
import logging
import mimetypes
import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.services.ocr import ExtractionFailed, VisionUnavailable, extract_page  # noqa: E402
from app.services.storage import SUPPORTED_MEDIA_TYPES  # noqa: E402


def _expand(patterns: list[str]) -> list[Path]:
    """Expand wildcards here rather than relying on the shell.

    A Unix shell expands `*.jpg` before the program is started; PowerShell and
    cmd hand the literal string through instead, so the same command line that
    works on macOS reports one nonexistent file on Windows. Doing it here means
    one usage example is correct everywhere.
    """
    paths: list[Path] = []
    for pattern in patterns:
        if any(char in pattern for char in "*?["):
            matched = sorted(glob.glob(pattern))
            if not matched:
                print(f"!! {pattern} matched no files")
            paths.extend(Path(m) for m in matched)
        else:
            paths.append(Path(pattern))
    return paths


def _media_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed in SUPPORTED_MEDIA_TYPES:
        return guessed
    # A phone photo with an odd extension is still a JPEG.
    return "image/jpeg"


async def run(paths: list[Path], jlpt: int | None) -> int:
    settings = get_settings()
    if not settings.has_vision:
        print(
            "ANTHROPIC_API_KEY is not set in backend/.env, so extraction is off.",
            file=sys.stderr,
        )
        return 2

    # The service logs how many entries it skipped for having no meaning,
    # which is the difference between "the page was read badly" and "the page
    # was a sentence list".
    logging.basicConfig(level=logging.INFO, format="   %(message)s")

    print(f"model: {settings.vision_model}   timeout: {settings.vision_timeout_seconds}s\n")

    slowest = 0.0
    failures = 0

    for path in paths:
        if not path.is_file():
            print(f"!! {path} does not exist")
            failures += 1
            continue

        size_mb = path.stat().st_size / 1_000_000
        print(f"── {path.name}  ({size_mb:.1f} MB)")

        started = time.monotonic()
        try:
            items = await extract_page(
                path.read_bytes(), _media_type(path), jlpt_level=jlpt, settings=settings
            )
        except (ExtractionFailed, VisionUnavailable) as exc:
            print(f"   FAILED after {time.monotonic() - started:.1f}s: {exc}\n")
            failures += 1
            continue

        elapsed = time.monotonic() - started
        slowest = max(slowest, elapsed)

        ambiguous = [i for i in items if i.status == "ambiguous"]
        with_particle = [i for i in items if i.usage_context]

        print(f"   {len(items)} rows in {elapsed:.1f}s")
        print(f"   {len(ambiguous)} ambiguous · {len(with_particle)} with a particle")
        for item in items:
            particle = f"[{item.usage_context}]" if item.usage_context else ""
            flag = {"ambiguous": "?", "duplicate": "="}.get(item.status, " ")
            print(
                f"   {flag} {particle}{item.kanji_furigana:<12} "
                f"{item.furigana_only:<14} {item.english}"
            )
            if item.reading_choices:
                print(f"       readings: {' / '.join(item.reading_choices)}")
        print()

    if slowest:
        headroom = settings.vision_timeout_seconds / slowest
        print(f"slowest page: {slowest:.1f}s  ({headroom:.1f}x under the timeout)")
        if headroom < 2:
            print("   ^ tight. Consider raising VISION_TIMEOUT_SECONDS,")
            print("     and the app's poll window with it.")

    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+")
    parser.add_argument(
        "--jlpt", type=int, default=None, help="tier to stamp on every row"
    )
    args = parser.parse_args()

    paths = _expand(args.images)
    if not paths:
        print("No images to read.", file=sys.stderr)
        return 2
    return asyncio.run(run(paths, args.jlpt))


if __name__ == "__main__":
    raise SystemExit(main())
