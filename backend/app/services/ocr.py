"""Turning a photo of a textbook page into vocabulary rows.

This is not classic OCR. A textbook vocab page is a *table* — kanji+furigana,
furigana alone, English — and the thing that makes the import useful is
keeping those three columns apart. Raw text extraction throws that structure
away and leaves you re-deriving it with regexes. So the page goes to a
vision-capable model with a schema attached, and comes back as rows.

Two decisions worth knowing about:

**The model is asked to flag its own uncertainty.** A reading like 辛い is
genuinely ambiguous (からい / つらい) and no amount of prompting fixes that,
because the page itself does not say. Rather than guess and be quietly wrong,
the model marks the row `ambiguous` and lists the candidates; the review
screen makes the user choose. A confident wrong reading is far worse here than
an admitted unknown, because it goes straight into an SRS and gets rehearsed.

**Nothing here writes to the database.** This module extracts and classifies;
the caller decides what to persist. That keeps it testable without Postgres
and keeps the vendor call in one place.
"""

from __future__ import annotations

import base64
import logging

import anthropic
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.schemas import DetectedItem

logger = logging.getLogger(__name__)


class VisionUnavailable(RuntimeError):
    """No ANTHROPIC_API_KEY, so photo import is switched off."""


class ExtractionFailed(RuntimeError):
    """The page could not be read. The message is safe to show a user."""


# -- what we ask the model for --------------------------------------------
# Kept separate from `schemas.DetectedItem`: this is the extraction contract,
# and it deliberately has no `key`, `selected` or `duplicate` — those are ours
# to decide, not the model's.


class ExtractedRow(BaseModel):
    kanji_furigana: str = Field(
        description=(
            "The word itself, as printed, e.g. 食べる or お嬢さん or ボール. "
            "Never empty. Exclude any leading bracketed particle — those go in "
            "`usage_context` — but keep a trailing （する） or （な） if the page "
            "prints one."
        )
    )
    furigana_only: str = Field(
        description=(
            "The reading in kana only, e.g. たべる. Empty string if the page "
            "does not give one. For a katakana word this is usually the word "
            "itself repeated, which is fine."
        )
    )
    english: str = Field(
        description=(
            "The English meaning exactly as printed, semicolons and all: "
            "'to save; to help [vt.]'. Keep parenthesised qualifiers such as "
            "'(polite)' or '(=すみません)'. Empty string where the page prints "
            "no meaning, as in an example-sentence list — never your own "
            "translation."
        )
    )
    usage_context: str = Field(
        default="",
        description=(
            "The bracketed particle or object a word is printed with, without "
            "the brackets: '〜が' for [〜が]苦手な, '病気を' for [病気を]治す, "
            "'人に' for [人に]あやまる. Empty when the page prints none. This is "
            "grammatical information the entry loses if it is folded into the "
            "word."
        )
    )
    ambiguous: bool = Field(
        description=(
            "True when the kanji has more than one plausible reading and the page "
            "does not disambiguate. Prefer flagging over guessing."
        )
    )
    reading_choices: list[str] = Field(
        default_factory=list,
        description="When ambiguous, every plausible reading. Otherwise empty.",
    )


class ExtractedPage(BaseModel):
    rows: list[ExtractedRow]


EXTRACTION_SYSTEM = """\
You read photographs of Japanese textbook vocabulary lists and return the \
entries as structured rows.

# What to extract

Every vocabulary entry on the page. They appear in three layouts:

1. Grouped under part-of-speech headings (Nouns, い-adjectives, な-adjectives), \
   three columns: reading in kana, then the word, then the English meaning.
2. A ruled table with a word column, a reading column, and a meaning column, \
   often alongside reference columns you should ignore.
3. A numbered list, often headed 覚える単語と例文, where each line is a word \
   followed by a full Japanese example sentence.

**In layout 3, take the word and discard the sentence.** The word is the entry; \
the sentence is an illustration of it and is not wanted. These entries usually \
print no reading and no English — leave both empty rather than supplying your \
own. A blank field is honest and the reviewer can fill it; an invented meaning \
looks identical to a printed one and gets rehearsed as fact.

One photo often catches more than one of these layouts at once. Return the \
entries from all of them.

Transcribe what is printed. Do not translate, expand, or improve the English: \
if the page says "to eat", the meaning is "to eat", not "to consume (food)". \
Keep semicolons, and keep parenthesised qualifiers like "(polite)", "[vt.]" \
and "(=すみません)" as part of the meaning.

# What to skip

**Example sentences themselves.** Never return one as an entry, and never fold \
one into a meaning.

Also skip, wherever they appear:

- page numbers, running heads, lesson titles, and section tabs
- audio-track markers such as "K22-07 [J-E]" or "5.Tango_L1-2"
- the 行 (line number) column, and the ◆ / ◇ new-kanji markers
- asterisks and their footnotes
- faint mirrored text showing through from the reverse of the page — these are \
  thin pages and the back side is often legible. It is never an entry.
- anything in the margins belonging to the facing page. One photo often catches \
  the edge of a different list; entries not part of the main table are not yours \
  to return.

# Details that matter

**Bracketed particles.** A word printed as [〜が]苦手な, [病気を]治す or \
[人に]あやまる carries its particle in brackets. Put the word in \
`kanji_furigana` and the bracket's contents in `usage_context`, without the \
brackets. Folding the bracket into the word makes the entry wrong.

**Trailing （する） and （な）** are printed as part of the entry — 決心（する）, \
簡単な. Keep them on the word exactly as printed. Where the reading column \
carries the suffix and the word column does not (しんぱい（な） against 心配), \
transcribe each column as it is printed rather than making them agree.

**Ambiguous readings.** Where a word's reading is genuinely ambiguous from the \
page alone — 辛い is からい or つらい, 入る is はいる or いる — set `ambiguous` \
and list every plausible reading in `reading_choices`. A confident wrong \
reading is worse than an admitted unknown here: these rows go into a \
spaced-repetition system and get rehearsed until they stick.

**Rotation.** Photographs of books are often rotated ninety degrees. Read the \
page whichever way up it is.

If the photo contains no vocabulary list at all, return an empty list of rows.\
"""


def _client(settings: Settings) -> anthropic.AsyncAnthropic:
    if not settings.has_vision:
        raise VisionUnavailable(
            "ANTHROPIC_API_KEY is not configured, so photo import is disabled."
        )
    return anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key.get_secret_value(),
        # Bounded on purpose — see `vision_timeout_seconds`. The SDK's default
        # is ten minutes, which on Lambda is ten minutes of billed waiting and
        # long past the point the client has stopped watching.
        timeout=settings.vision_timeout_seconds,
    )


async def extract_page(
    image: bytes,
    media_type: str,
    *,
    jlpt_level: int | None = None,
    settings: Settings | None = None,
    client: anthropic.AsyncAnthropic | None = None,
) -> list[DetectedItem]:
    """Read one page photo into review rows.

    `client` is injectable so tests never reach the network.
    """
    settings = settings or get_settings()
    client = client or _client(settings)

    encoded = base64.standard_b64encode(image).decode("utf-8")

    try:
        response = await client.messages.parse(
            model=settings.vision_model,
            max_tokens=16000,
            system=EXTRACTION_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": encoded,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Extract every vocabulary entry on this page.",
                        },
                    ],
                }
            ],
            output_format=ExtractedPage,
        )
    except anthropic.AuthenticationError as exc:
        raise ExtractionFailed("The configured Anthropic API key was rejected.") from exc
    except anthropic.RateLimitError as exc:
        raise ExtractionFailed("Rate limited while reading the page. Try again shortly.") from exc
    except anthropic.BadRequestError as exc:
        # Usually an image too large, or a media type the API will not take.
        raise ExtractionFailed(f"The image was rejected: {exc.message}") from exc
    except anthropic.APITimeoutError as exc:
        raise ExtractionFailed(
            "Reading the page took too long. Try a tighter crop of just the "
            "vocabulary table."
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise ExtractionFailed("Could not reach the extraction service.") from exc
    except anthropic.APIStatusError as exc:
        raise ExtractionFailed(f"Extraction service error ({exc.status_code}).") from exc

    # A refusal returns HTTP 200 with no parsed output, so it has to be checked
    # explicitly — reading `.parsed_output` first would raise something opaque.
    if response.stop_reason == "refusal":
        raise ExtractionFailed("The extraction service declined to read this image.")

    page = response.parsed_output
    if page is None:  # pragma: no cover - parse() populates this or raises
        raise ExtractionFailed("The extraction service returned no rows.")

    return [_to_detected(row, jlpt_level) for row in page.rows]


def _to_detected(row: ExtractedRow, jlpt_level: int | None) -> DetectedItem:
    ambiguous = row.ambiguous and len(row.reading_choices) > 1

    # Example-sentence lists print the word alone. The entry is still wanted —
    # it is usually the same word the list pages gloss — but it must not import
    # with a blank back, so it arrives deselected and says why.
    needs_meaning = not row.english.strip()

    if ambiguous:
        note = "Pick the reading this page means."
    elif needs_meaning:
        note = "No meaning printed here. Add one, or import it from the word list."
    else:
        note = None

    return DetectedItem(
        # Stable within a page, so the review screen can key a list on it and
        # survive re-renders without the row losing its edits.
        key=f"{row.kanji_furigana}:{row.furigana_only}",
        kanji_furigana=row.kanji_furigana,
        furigana_only=row.furigana_only,
        english=row.english,
        usage_context=row.usage_context or None,
        # The tier the user picked at upload time cascades onto every row.
        jlpt_level=jlpt_level,
        status="ambiguous" if ambiguous else "ok",
        # Anything needing a decision starts deselected: defaulting it on
        # invites blind confirmation of a guess.
        selected=not (ambiguous or needs_meaning),
        reading_choices=row.reading_choices if ambiguous else None,
        note=note,
    )


def mark_duplicates(items: list[DetectedItem], existing: set[str]) -> list[DetectedItem]:
    """Flag rows already in the deck, keyed on the written form.

    Matching on `kanji_furigana` rather than the reading is deliberate: the
    same word photographed twice should collapse, but two different words that
    happen to share a reading (橋 and 箸) must not.
    """
    for item in items:
        if item.kanji_furigana in existing:
            item.status = "duplicate"
            item.selected = False
            item.note = "Already in your deck."
    return items


async def process_source(session, source_id: int, *, settings=None, client=None) -> None:
    """Extract one pending upload, in place.

    Owns the whole state transition: reads the stored image, extracts, marks
    duplicates against the deck, and moves the row to `processed` or `failed`.
    A failure is recorded rather than raised, because the caller is a
    background task or a queue consumer with nobody to hand an exception to —
    the client learns about it by polling and seeing `failed`.

    The extracted rows are deliberately *not* written to `vocab_items` here.
    Nothing enters the deck until the user has reviewed it; this only advances
    the source's status so the review screen can render.
    """
    from app.db import repository as repo
    from app.services import storage

    source = await repo.get_vocab_source(session, source_id)
    if source is None:
        logger.warning("Vision extraction asked for unknown source %s", source_id)
        return

    held = storage.take(source_id)
    if held is None:
        # The buffer is process-local, so this means the upload was handled by
        # a different process than this one — which is exactly the case that
        # needs durable storage. Fail visibly rather than silently doing nothing.
        source.status = "failed"
        _FAILURES[source_id] = (
            "The uploaded page is no longer available. Upload it again."
        )
        logger.warning("No buffered image for source %s", source_id)
        return

    image, media_type = held

    try:
        items = await extract_page(
            image,
            media_type,
            jlpt_level=source.jlpt_level,
            settings=settings,
            client=client,
        )
        known = await repo.get_known_written_forms(session)
        _CACHE[source_id] = mark_duplicates(items, known)
        source.status = "processed"
        logger.info("Extracted %d rows from source %s", len(items), source_id)
    except (ExtractionFailed, VisionUnavailable) as exc:
        source.status = "failed"
        _FAILURES[source_id] = str(exc)
        logger.warning("Extraction failed for source %s: %s", source_id, exc)


# Extracted-but-unconfirmed rows, held until the user commits or discards them.
#
# Process-local on purpose. These are a draft the user is still editing, not
# durable state — losing them means re-uploading a photo, not losing anything
# in the deck. Persisting them would mean a table whose rows are meaningless
# the moment the review screen closes. The catch is that it only holds while
# one process serves both the extraction and the poll; the moment `ocr-fn`
# becomes a separate function from `api-fn`, this has to become a JSONB column
# on `vocab_sources`.
_CACHE: dict[int, list[DetectedItem]] = {}
_FAILURES: dict[int, str] = {}


def take_result(source_id: int) -> tuple[list[DetectedItem], str | None]:
    """Read back an extraction, leaving it in place for repeated polls."""
    return _CACHE.get(source_id, []), _FAILURES.get(source_id)


def discard_result(source_id: int) -> None:
    _CACHE.pop(source_id, None)
    _FAILURES.pop(source_id, None)
