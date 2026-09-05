"""The enrichment response model.

Split from `test_grammar_routes.py` because none of this needs a database — it
is the Pydantic model the Anthropic call is parsed into, not a route. The
failure it guards against was nevertheless a 500 from
`POST /api/grammar-entries/{id}/enrich`, so start there if these break.
"""

from __future__ import annotations

from app.db import models
from app.services import grammar as grammar_service


def test_an_over_long_register_is_trimmed_not_rejected():
    """A verbose register must not cost us the rest of a good answer.

    Measured against the live model, `～てからでないと` came back with a 54-character
    register — 'neutral; slightly formal in writing, ～てからでなければ more so' —
    while the column held 32. Rejecting the response would have thrown away a
    correct meaning, a correct formation and two usable example sentences over
    the one field nobody reads closely.
    """
    verbose = "x" * (models.STYLE_MAX_LENGTH + 40)
    parsed = grammar_service.EnrichedGrammar(
        unrecognised=False,
        other_senses=[],
        meaning="kept",
        formation="kept",
        style=verbose,
        jlpt_level=3,
        examples=[],
    )
    assert len(parsed.style) == models.STYLE_MAX_LENGTH
    assert parsed.meaning == "kept"


def test_a_register_that_fits_is_left_alone():
    """The clamp must not touch the ordinary case."""
    parsed = grammar_service.EnrichedGrammar(
        unrecognised=False,
        other_senses=[],
        meaning="m",
        formation="f",
        style="formal, written or speeches",
        jlpt_level=2,
        examples=[],
    )
    assert parsed.style == "formal, written or speeches"
