"""Page extraction, without the network.

The vendor call is injected, so these cover the part that is actually ours:
how a model's answer becomes review rows, and what happens when the call goes
wrong. Everything the extraction promises the review screen — ambiguous rows
arriving deselected, duplicates flagged, failures surfacing as a message
rather than a stack trace — is asserted here.
"""

from __future__ import annotations

from types import SimpleNamespace

import anthropic
import httpx2 as httpx
import pytest

from app.config import Settings
from app.schemas import DetectedItem
from app.services.ocr import (
    ExtractedPage,
    ExtractedRow,
    ExtractionFailed,
    VisionUnavailable,
    extract_page,
    mark_duplicates,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def settings(**overrides) -> Settings:
    defaults = {"wanikani_apikey": "test-token", "anthropic_api_key": "test-key"}
    defaults.update(overrides)
    return Settings(**defaults)


class FakeMessages:
    def __init__(self, result=None, error=None):
        self._result = result
        self._error = error
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._result


def fake_client(rows=None, *, stop_reason="end_turn", error=None):
    result = SimpleNamespace(
        stop_reason=stop_reason,
        parsed_output=ExtractedPage(rows=rows or []) if rows is not None else None,
    )
    return SimpleNamespace(messages=FakeMessages(result=result, error=error))


def _response(status_code: int) -> httpx.Response:
    return httpx.Response(status_code, request=httpx.Request("POST", "https://api.anthropic.com"))


# -- the happy path --------------------------------------------------------


async def test_rows_become_review_items():
    client = fake_client([
        ExtractedRow(
            kanji_furigana="食べる", furigana_only="たべる",
            english="to eat", ambiguous=False,
        )
    ])

    items = await extract_page(PNG, "image/png", jlpt_level=5,
                               settings=settings(), client=client)

    assert len(items) == 1
    item = items[0]
    assert item.kanji_furigana == "食べる"
    assert item.furigana_only == "たべる"
    assert item.status == "ok"
    assert item.selected is True
    # The tier picked at upload cascades onto every extracted row.
    assert item.jlpt_level == 5


async def test_image_is_sent_as_base64_with_its_media_type():
    client = fake_client([])
    await extract_page(PNG, "image/png", settings=settings(), client=client)

    content = client.messages.calls[0]["messages"][0]["content"]
    image_block = next(b for b in content if b["type"] == "image")
    assert image_block["source"]["media_type"] == "image/png"
    assert image_block["source"]["type"] == "base64"
    # Base64, not raw bytes — sending bytes silently fails to serialise.
    assert isinstance(image_block["source"]["data"], str)


async def test_model_comes_from_settings_not_a_literal():
    client = fake_client([])
    await extract_page(PNG, "image/png",
                       settings=settings(vision_model="claude-opus-5"), client=client)
    assert client.messages.calls[0]["model"] == "claude-opus-5"


# -- the part that matters most --------------------------------------------


async def test_ambiguous_readings_arrive_deselected_with_choices():
    """A guessed reading goes into an SRS and gets rehearsed wrong.

    So an ambiguous row must not import by default — it needs a decision
    first, and defaulting it on invites blind confirmation.
    """
    client = fake_client([
        ExtractedRow(
            kanji_furigana="辛い", furigana_only="", english="spicy; painful",
            ambiguous=True, reading_choices=["からい", "つらい"],
        )
    ])

    (item,) = await extract_page(PNG, "image/png", settings=settings(), client=client)

    assert item.status == "ambiguous"
    assert item.selected is False
    assert item.reading_choices == ["からい", "つらい"]
    assert item.note


async def test_ambiguous_needs_more_than_one_candidate():
    """`ambiguous` with a single choice is not a real ambiguity."""
    client = fake_client([
        ExtractedRow(
            kanji_furigana="水", furigana_only="みず", english="water",
            ambiguous=True, reading_choices=["みず"],
        )
    ])

    (item,) = await extract_page(PNG, "image/png", settings=settings(), client=client)

    assert item.status == "ok"
    assert item.selected is True


def test_duplicates_match_on_the_written_form():
    """橋 and 箸 read the same and are different words.

    Matching on the reading would collapse them into one deck entry.
    """
    items = [
        DetectedItem(key="a", kanji_furigana="橋", furigana_only="はし", english="bridge"),
        DetectedItem(key="b", kanji_furigana="箸", furigana_only="はし", english="chopsticks"),
    ]

    marked = mark_duplicates(items, existing={"橋"})

    assert marked[0].status == "duplicate"
    assert marked[0].selected is False
    assert marked[1].status == "ok"
    assert marked[1].selected is True


# -- failure modes ---------------------------------------------------------


async def test_no_api_key_is_a_distinct_error():
    """Not a failure to read the page — the feature is simply off."""
    with pytest.raises(VisionUnavailable):
        await extract_page(PNG, "image/png",
                           settings=settings(anthropic_api_key=None))


async def test_refusal_surfaces_as_a_readable_failure():
    """A refusal is HTTP 200 with no parsed output, so it needs its own check."""
    client = fake_client([], stop_reason="refusal")

    with pytest.raises(ExtractionFailed, match="declined"):
        await extract_page(PNG, "image/png", settings=settings(), client=client)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (anthropic.AuthenticationError(
            "bad key", response=_response(401), body=None), "key was rejected"),
        (anthropic.RateLimitError(
            "slow down", response=_response(429), body=None), "Rate limited"),
        (anthropic.BadRequestError(
            "too big", response=_response(400), body=None), "rejected"),
        (anthropic.APIConnectionError(
            request=httpx.Request("POST", "https://api.anthropic.com")), "Could not reach"),
    ],
)
async def test_vendor_errors_become_messages_a_user_can_read(error, expected):
    """None of these should reach the client as a 500 with a stack trace."""
    client = fake_client(error=error)

    with pytest.raises(ExtractionFailed, match=expected):
        await extract_page(PNG, "image/png", settings=settings(), client=client)


# -- the real page shapes --------------------------------------------------
# Rows below are transcribed from the sample pages: a Quartet 会話・文法編
# vocabulary page, a 単語リスト table, and a 覚える単語と例文 list.


async def test_a_bracketed_particle_does_not_end_up_in_the_word():
    """[〜が]苦手な is the word 苦手な plus the particle it takes.

    Folded together it is not a word, and the deck entry is wrong. Split apart
    the flashcard can show the particle where it belongs.
    """
    client = fake_client([
        ExtractedRow(
            kanji_furigana="苦手な", furigana_only="にがてな", english="poor at",
            usage_context="〜が", ambiguous=False,
        ),
        ExtractedRow(
            kanji_furigana="治す", furigana_only="なおす",
            english="to cure; to heal [vt.]", usage_context="病気を", ambiguous=False,
        ),
    ])

    items = await extract_page(PNG, "image/png", settings=settings(), client=client)

    assert [i.kanji_furigana for i in items] == ["苦手な", "治す"]
    assert [i.usage_context for i in items] == ["〜が", "病気を"]


async def test_a_word_with_no_printed_meaning_arrives_deselected():
    """The 覚える単語と例文 list prints the word alone.

    The entry is still wanted — it is usually the same word the list pages
    gloss — but importing it silently would put a card in the deck with a blank
    back.
    """
    client = fake_client([
        ExtractedRow(
            kanji_furigana="言葉", furigana_only="", english="", ambiguous=False,
        )
    ])

    (item,) = await extract_page(PNG, "image/png", settings=settings(), client=client)

    assert item.kanji_furigana == "言葉"
    assert item.selected is False
    assert "No meaning printed" in item.note
    # Not an ambiguous reading — a different problem, and the UI shows it
    # differently.
    assert item.status == "ok"
    assert item.reading_choices is None


async def test_printed_suffixes_are_kept_as_the_page_prints_them():
    """決心（する）and しんぱい（な）against 心配 are printed that way.

    Making the columns agree would be tidying the source rather than reading
    it, and the reviewer can normalise if they want to.
    """
    client = fake_client([
        ExtractedRow(
            kanji_furigana="決心（する）", furigana_only="けっしん（する）",
            english="to make up one's mind; to determine", ambiguous=False,
        ),
        ExtractedRow(
            kanji_furigana="心配", furigana_only="しんぱい（な）",
            english="worried about (〜が)", ambiguous=False,
        ),
    ])

    items = await extract_page(PNG, "image/png", settings=settings(), client=client)

    assert items[0].kanji_furigana == "決心（する）"
    assert items[1].furigana_only == "しんぱい（な）"
    # Qualifiers printed inside the meaning stay in the meaning.
    assert items[1].english == "worried about (〜が)"


async def test_a_katakana_word_reads_as_itself():
    """ボール and ヨーロッパ print the same thing in both columns."""
    client = fake_client([
        ExtractedRow(
            kanji_furigana="ヨーロッパ", furigana_only="ヨーロッパ",
            english="Europe", ambiguous=False,
        )
    ])

    (item,) = await extract_page(PNG, "image/png", settings=settings(), client=client)

    assert item.kanji_furigana == item.furigana_only == "ヨーロッパ"
    assert item.selected is True


def test_the_prompt_names_what_the_sample_pages_actually_contain():
    """Guards the instructions the sample photos showed were needed.

    Each of these is a real hazard on those pages: show-through on thin paper,
    a facing page caught in the margin, audio markers and line-number columns,
    and photos taken sideways.
    """
    from app.services.ocr import EXTRACTION_SYSTEM

    for expected in ("覚える単語と例文", "through", "margins", "行", "rotated"):
        assert expected in EXTRACTION_SYSTEM


async def test_a_timeout_says_what_to_do_about_it():
    """Distinct from a connection failure: the call reached the API and ran."""
    client = fake_client(
        error=anthropic.APITimeoutError(
            request=httpx.Request("POST", "https://api.anthropic.com")
        )
    )

    with pytest.raises(ExtractionFailed, match="took too long"):
        await extract_page(PNG, "image/png", settings=settings(), client=client)


def test_the_vision_client_is_bounded():
    """The SDK default is ten minutes, which on Lambda is billed waiting.

    It also has to stay under the app's polling window, or the client gives up
    on work the server is still doing.
    """
    from app.services.ocr import _client

    built = _client(settings(vision_timeout_seconds=120.0))
    assert built.timeout == 120.0


async def test_an_empty_page_is_not_an_error():
    """A photo with no vocabulary table returns nothing, and that is fine."""
    client = fake_client([])
    assert await extract_page(PNG, "image/png", settings=settings(), client=client) == []
