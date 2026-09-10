"""Lesson generation — the parts that hold without a network or a database.

The two agents are mocked. What is worth testing here is not that a model
writes good Japanese, which no unit test can assert, but the machinery around
it: the structural gate that rejects a draft before it costs a verifier call,
and the rule that nothing unverified is ever bundled.
"""

from __future__ import annotations

import anthropic
import pytest

from app.config import get_settings
from app.services.lessons import (
    DraftQuestion,
    Verdict,
    _structurally_sound,
    prune_for_variety,
    to_payload,
    variety_note,
    verify_draft,
)


def draft(**overrides) -> DraftQuestion:
    base = dict(
        type="multiple_choice",
        prompt="What does 免許 mean?",
        choices=["licence", "permission", "ticket", "receipt"],
        answer="licence",
        vocab_item_ids=[1],
        rationale="免許 is a licence; the others are different words.",
    )
    base.update(overrides)
    return DraftQuestion(**base)


KNOWN = {1, 2, 3}


# -- the structural gate ---------------------------------------------------


def test_a_well_formed_draft_passes():
    assert _structurally_sound(draft(), KNOWN) is None


def test_an_invented_vocab_id_is_caught_before_the_verifier():
    """The failure that matters most: a question pointing at a word that does
    not exist would write SRS state nowhere."""
    reason = _structurally_sound(draft(vocab_item_ids=[99]), KNOWN)
    assert reason is not None and "99" in reason


def test_a_draft_naming_no_words_is_rejected():
    assert _structurally_sound(draft(vocab_item_ids=[]), KNOWN) is not None


def test_multiple_choice_needs_four_choices():
    reason = _structurally_sound(draft(choices=["a", "b"]), KNOWN)
    assert reason is not None and "expected 4" in reason


def test_duplicate_choices_are_rejected():
    assert _structurally_sound(
        draft(choices=["licence", "licence", "ticket", "receipt"]), KNOWN
    ) is not None


def test_the_answer_must_be_among_the_choices():
    reason = _structurally_sound(draft(answer="passport"), KNOWN)
    assert reason is not None and "not among the choices" in reason


def test_a_recall_question_carries_no_choices():
    assert _structurally_sound(draft(type="recall", choices=["a"]), KNOWN) is not None
    assert _structurally_sound(draft(type="recall", choices=[]), KNOWN) is None


def test_fill_in_blank_needs_exactly_one_gap():
    ok = draft(type="fill_in_blank", choices=[], prompt="毎日 ___ を飲みます。", answer="コーヒー")
    assert _structurally_sound(ok, KNOWN) is None

    none = draft(type="fill_in_blank", choices=[], prompt="no gap here", answer="x")
    assert _structurally_sound(none, KNOWN) is not None

    two = draft(
        type="fill_in_blank", choices=[], prompt="___ と ___ を", answer="x"
    )
    assert _structurally_sound(two, KNOWN) is not None


def test_an_empty_answer_is_rejected():
    assert _structurally_sound(draft(type="recall", choices=[], answer="  "), KNOWN)


# -- the verifier ----------------------------------------------------------


class _StubClient:
    """Stands in for anthropic.AsyncAnthropic."""

    def __init__(self, result):
        self._result = result
        self.messages = self

    async def parse(self, **_kwargs):
        if isinstance(self._result, Exception):
            raise self._result

        class Response:
            parsed_output = self._result

        return Response()


@pytest.mark.asyncio
async def test_a_pass_comes_back_as_a_pass():
    verdict = await verify_draft(draft(), client=_StubClient(Verdict(ok=True)))
    assert verdict.ok


@pytest.mark.asyncio
async def test_an_unreachable_verifier_rejects_rather_than_waves_through():
    """The safety property. Defaulting to 'serve it' the moment the network
    wobbles would delete the only safeguard the module has."""
    client = _StubClient(anthropic.APIConnectionError(request=None))
    verdict = await verify_draft(draft(), client=client)
    assert verdict.ok is False
    assert "unreachable" in verdict.reason


@pytest.mark.asyncio
async def test_no_parsed_output_is_a_rejection():
    verdict = await verify_draft(draft(), client=_StubClient(None))
    assert verdict.ok is False


# -- storage shape ---------------------------------------------------------


def test_payload_keeps_choices_only_where_they_exist():
    assert to_payload(draft())["choices"] == [
        "licence",
        "permission",
        "ticket",
        "receipt",
    ]
    assert "choices" not in to_payload(draft(type="recall", choices=[]))


# -- batch variety ---------------------------------------------------------
# Deliberately Python, not a model: repetition is a property of the batch, and
# the verifier only ever sees one question.


def test_a_varied_batch_survives_untouched():
    batch = [draft(vocab_item_ids=[1]), draft(vocab_item_ids=[2]), draft(vocab_item_ids=[3])]
    kept, dropped = prune_for_variety(batch, max_repeats_per_word=2)
    assert len(kept) == 3
    assert dropped == []


def test_a_word_drilled_too_often_is_thinned_not_erased():
    """The over-used word still appears — just not five times."""
    batch = [draft(vocab_item_ids=[1]) for _ in range(5)]
    kept, dropped = prune_for_variety(batch, max_repeats_per_word=2)
    assert len(kept) == 2
    assert len(dropped) == 3


def test_the_limit_is_per_word_not_per_batch():
    batch = [
        draft(vocab_item_ids=[1]),
        draft(vocab_item_ids=[1]),
        draft(vocab_item_ids=[2]),
        draft(vocab_item_ids=[2]),
    ]
    kept, _ = prune_for_variety(batch, max_repeats_per_word=2)
    assert len(kept) == 4


def test_a_question_testing_several_words_counts_against_each():
    batch = [
        draft(vocab_item_ids=[1, 2]),
        draft(vocab_item_ids=[1, 2]),
        draft(vocab_item_ids=[1]),
    ]
    kept, dropped = prune_for_variety(batch, max_repeats_per_word=2)
    assert len(kept) == 2
    assert len(dropped) == 1


def test_the_variety_note_names_what_the_batch_actually_contained():
    batch = [draft(), draft(), draft(type="recall", choices=[])]
    note = variety_note(batch)
    assert "multiple_choice: 2" in note
    assert "recall: 1" in note


# -- the verifier runs on the cheaper model --------------------------------


def test_verifier_and_generator_are_different_models():
    """The asymmetry is deliberate: verification runs once per question where
    generation runs once per bundle, so it is the call that scales."""
    settings = get_settings()
    assert settings.verifier_model != settings.lesson_model
