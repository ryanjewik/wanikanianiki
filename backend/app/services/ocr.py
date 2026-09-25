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
import time

import anthropic
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.schemas import DetectedItem

logger = logging.getLogger(__name__)


class VisionUnavailable(RuntimeError):
    """No ANTHROPIC_API_KEY, so photo import is switched off."""


class ExtractionFailed(RuntimeError):
    """The page could not be read. The message is safe to show a user."""


# What a phone camera actually produces, and what the vision API accepts.
SUPPORTED_MEDIA_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif"}
)


class UnsupportedImageType(ValueError):
    """The upload was not an image the vision API accepts."""


def check_media_type(media_type: str) -> str:
    """Reject at the door, before a row is written or the model is called."""
    if media_type not in SUPPORTED_MEDIA_TYPES:
        raise UnsupportedImageType(
            f"{media_type!r} is not a supported image type "
            f"({', '.join(sorted(SUPPORTED_MEDIA_TYPES))})"
        )
    return media_type


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
            "'(polite)' or '(=すみません)'. Never your own translation — an "
            "entry whose meaning is not printed should not be returned at all."
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
the sentence is an illustration of it and is not wanted.

**Skip any entry that prints no English meaning.** Layout 3 usually gives none, \
because it repeats words the list pages already gloss — and a card with a blank \
back cannot be studied. Never fill the gap with your own translation: an \
invented meaning is indistinguishable from a printed one once it is in a deck, \
and it gets rehearsed as fact. If the meaning is not on the page, the entry is \
not on the page.

A missing *reading* is fine and the entry still counts — plenty of words are \
printed without one.

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
    headers = {}
    if settings.anthropic_workspace_id:
        headers["anthropic-workspace-id"] = settings.anthropic_workspace_id

    return anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key.get_secret_value(),
        # Bounded on purpose — see `vision_timeout_seconds`. The SDK's default
        # is ten minutes, which on Lambda is ten minutes of billed waiting and
        # long past the point the client has stopped watching.
        timeout=settings.vision_timeout_seconds,
        # One attempt. The SDK's default of two retries also fires on a
        # timeout, and the same page re-sent takes as long again — three full
        # windows back to back is past the Lambda's own limit. A quick failure
        # goes back to the phone instead, where re-uploading is one tap.
        max_retries=0,
        default_headers=headers or None,
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
        message = str(getattr(exc, "message", exc))
        if "anthropic-workspace-id" in message:
            raise ExtractionFailed(
                "This API key is identity-linked, so the request has to name a "
                "workspace. Set ANTHROPIC_WORKSPACE_ID in backend/.env — the id "
                "is in the Anthropic console URL, "
                "platform.claude.com/workspaces/<id>/..."
            ) from exc
        # Otherwise usually an image too large, or a media type it will not take.
        raise ExtractionFailed(f"The image was rejected: {message}") from exc
    except anthropic.APITimeoutError as exc:
        raise ExtractionFailed(
            "Reading the page took too long. Try a tighter crop of just the "
            "vocabulary table."
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise ExtractionFailed("Could not reach the extraction service.") from exc
    except anthropic.APIStatusError as exc:
        # No SDK retries, so an overload reaches here rather than being
        # absorbed. It is the one failure a retry a moment later usually fixes.
        if exc.status_code == 529 or exc.status_code >= 500:
            raise ExtractionFailed(
                "The extraction service is busy. Try again in a moment."
            ) from exc
        raise ExtractionFailed(f"Extraction service error ({exc.status_code}).") from exc

    # A refusal returns HTTP 200 with no parsed output, so it has to be checked
    # explicitly — reading `.parsed_output` first would raise something opaque.
    if response.stop_reason == "refusal":
        raise ExtractionFailed("The extraction service declined to read this image.")

    page = response.parsed_output
    if page is None:  # pragma: no cover - parse() populates this or raises
        raise ExtractionFailed("The extraction service returned no rows.")

    # Enforced here as well as asked for in the prompt. An entry with no
    # meaning is a card with a blank back, and the model returning one anyway
    # is likelier than the reviewer noticing every time.
    usable = [row for row in page.rows if row.english.strip()]
    if dropped := len(page.rows) - len(usable):
        logger.info(
            "Skipped %d of %d entries with no printed meaning", dropped, len(page.rows)
        )

    return [_to_detected(row, jlpt_level, index) for index, row in enumerate(usable)]


def _to_detected(
    row: ExtractedRow, jlpt_level: int | None, index: int = 0
) -> DetectedItem:
    ambiguous = row.ambiguous and len(row.reading_choices) > 1
    return DetectedItem(
        # Unique within the page, and stable across re-renders. The position
        # is in it because a word can legitimately appear twice on one page —
        # つまり is printed in both the word list and the sentence list — and
        # keying on the text alone made the review screen toggle both rows at
        # once.
        key=f"{index}:{row.kanji_furigana}",
        kanji_furigana=row.kanji_furigana,
        furigana_only=row.furigana_only,
        english=row.english,
        usage_context=row.usage_context or None,
        # The tier the user picked at upload time cascades onto every row.
        jlpt_level=jlpt_level,
        status="ambiguous" if ambiguous else "ok",
        # An ambiguous row starts deselected: it needs a decision before it is
        # worth importing, and defaulting it on invites blind confirmation.
        selected=not ambiguous,
        reading_choices=row.reading_choices if ambiguous else None,
        note="Pick the reading this page means." if ambiguous else None,
    )


def mark_duplicates(items: list[DetectedItem], existing: set[str]) -> list[DetectedItem]:
    """Flag rows already in the deck, and repeats within the page itself.

    Matching on `kanji_furigana` rather than the reading is deliberate: the
    same word photographed twice should collapse, but two different words that
    happen to share a reading (橋 and 箸) must not.

    A page really can list a word twice — a 単語リスト and a 覚える単語 section
    on one spread both carry つまり, one with its meaning and one without. Only
    the fullest of those is worth importing, so the others are marked rather
    than left looking like separate words to add.
    """
    best = _fullest_by_word(items)

    for item in items:
        if item.kanji_furigana in existing:
            item.status = "duplicate"
            item.selected = False
            item.note = "Already in your deck."
        elif best.get(item.kanji_furigana) is not item:
            item.status = "duplicate"
            item.selected = False
            item.note = "Listed twice on this page."
    return items


def _fullest_by_word(items: list[DetectedItem]) -> dict[str, DetectedItem]:
    """The row to keep for each written form.

    Prefers the one carrying the most — a meaning first, since a row without
    one imports a card with a blank back, then a reading. Where a word appears
    in a word list and again in a sentence list, this is what keeps the glossed
    copy rather than whichever the model happened to return first.
    """
    best: dict[str, DetectedItem] = {}
    for item in items:
        current = best.get(item.kanji_furigana)
        if current is None or _completeness(item) > _completeness(current):
            best[item.kanji_furigana] = item
    return best


def _completeness(item: DetectedItem) -> tuple[int, int, int]:
    return (
        1 if item.english.strip() else 0,
        1 if item.furigana_only.strip() else 0,
        1 if item.usage_context else 0,
    )


async def read_source(
    session,
    source,
    image: bytes,
    media_type: str,
    *,
    settings: Settings | None = None,
    client: anthropic.AsyncAnthropic | None = None,
) -> tuple[list[DetectedItem], str | None]:
    """Read one uploaded page and hand the rows straight back.

    Returns `(rows, None)` on success or `([], reason)` on failure, and moves
    `source.status` to `processed` or `failed` to match. A failure is returned
    rather than raised so the caller can still commit the status change.

    Nothing is kept afterwards — not the photo, not the rows. The rows are a
    draft the phone holds while the user reviews them, and it sends back the
    ones it keeps on confirm. Keeping either here is what broke the moment two
    requests could land in different Lambda containers.
    """
    from app.db import repository as repo

    started = time.monotonic()
    try:
        items = await extract_page(
            image,
            media_type,
            jlpt_level=source.jlpt_level,
            settings=settings,
            client=client,
        )
    except (ExtractionFailed, VisionUnavailable) as exc:
        source.status = "failed"
        logger.warning(
            "Extraction failed for source %s after %.1fs: %s",
            source.id, time.monotonic() - started, exc,
        )
        return [], str(exc)

    # Logged so the timeouts can be set from real pages rather than guessed.
    logger.info(
        "Extracted %d rows from source %s in %.1fs (%d bytes)",
        len(items), source.id, time.monotonic() - started, len(image),
    )
    known = await repo.get_known_written_forms(session)
    source.status = "processed"
    return mark_duplicates(items, known), None
