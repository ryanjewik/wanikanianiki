"""Turning a logged pattern into something a question generator can use.

The whole premise of logging grammar in the app is that you type
`～てからでないと` and stop. That is genuinely enough for a model to know the
point — it is a standard N3/N2 pattern and the string is unambiguous — so
asking a person to also supply a meaning they would have to look up would
defeat logging it at all. This module is what makes the short version work: the
pattern goes out, the meaning, formation, register and example sentences come
back.

Three decisions worth knowing about:

**The model is asked to admit what it does not know.** A typo, or a string that
is not a grammar point, must come back as `unrecognised` rather than as a
confidently invented pattern. Same trade as the ambiguous readings in
`services/ocr.py`: an admitted unknown costs one correction, and a fluent
fabrication gets rehearsed into a deck.

**A pattern with several senses says so instead of picking one.** `～ものだ` is
four points wearing one string. Asked about it with no sense named, the model
lists the senses it sees and enriches nothing; the caller puts the choice to the
user. Guessing here is the failure that ends with questions testing a sense the
class never covered.

**Nothing here is trusted on arrival.** The caller writes these fields onto the
row with `enriched` still false — a human confirming them is what flips it, and
`/api/grammar-entries/{id}` will not serve unconfirmed grammar as context. That
is the rule photo import already follows.

Unlike photo import this runs inside the request rather than as a background
task with polling. A page read is a vision call over a photograph and takes tens
of seconds; this is one short structured answer, and the polling machinery in
`ocr.py` — with its process-local cache that breaks the moment extraction and
API are separate functions — is not worth inheriting for a call this size.
"""

from __future__ import annotations

import logging

import anthropic
from pydantic import BaseModel, Field, field_validator

from app.config import Settings, get_settings
from app.db.models import STYLE_MAX_LENGTH

logger = logging.getLogger(__name__)


class EnrichmentUnavailable(RuntimeError):
    """No ANTHROPIC_API_KEY, so enrichment is switched off."""


class EnrichmentFailed(RuntimeError):
    """The pattern could not be enriched. The message is safe to show a user."""


# -- what we ask the model for --------------------------------------------


class EnrichedExample(BaseModel):
    japanese: str = Field(
        description=(
            "One short sentence using the pattern, in plain form unless the "
            "pattern requires otherwise. Keep the surrounding vocabulary "
            "common — the sentence is there to show the grammar, and a rare "
            "word in it tests something else."
        )
    )
    english: str = Field(description="A natural translation of that sentence.")


class EnrichedGrammar(BaseModel):
    unrecognised: bool = Field(
        description=(
            "True when this is not a Japanese grammar point you recognise — a "
            "typo, a stray word, or something you would be guessing at. Say so "
            "rather than inventing an explanation. Everything else may be left "
            "empty when this is true."
        )
    )
    other_senses: list[str] = Field(
        default_factory=list,
        description=(
            "When the pattern has several distinct uses and the request did not "
            "say which, a short label for each — for ～ものだ: ['general truth', "
            "'nostalgic recollection', 'strong advice', 'exclamation']. Leave "
            "empty when the pattern has one use, or when the request already "
            "named the sense. Do not pick one yourself."
        ),
    )
    meaning: str = Field(
        default="",
        description=(
            "What the pattern means, in one line, as a textbook index would "
            "gloss it: 'unless/until you first do X, you cannot Y'."
        ),
    )
    formation: str = Field(
        default="",
        description=(
            "How it attaches, in the notation a textbook uses: "
            "'Vて + からでないと + negative', 'Nの/Aな + わりに'. Name any "
            "constraint on the clause that follows, since that is the part "
            "people get wrong."
        ),
    )
    style: str = Field(
        default="",
        description=(
            f"Register as a short label, at most a handful of words and never "
            f"more than {STYLE_MAX_LENGTH} characters: 'plain', 'polite', "
            f"'written', 'conversational', 'formal written'. Empty if it is "
            f"neutral. This is a label, not a note — qualifications about when "
            f"the register shifts belong in `formation`, not here."
        ),
    )

    @field_validator("style", mode="before")
    @classmethod
    def _clamp_style(cls, value: object) -> object:
        """Trim an over-long register rather than rejecting the whole answer.

        Asking for a short label does not guarantee one, and everything else in
        the response is still worth keeping when the model editorialises in this
        one field. Rejecting would throw away a good meaning and two good
        example sentences over a register string.
        """
        if isinstance(value, str) and len(value) > STYLE_MAX_LENGTH:
            logger.info("Register clamped from %d characters", len(value))
            return value[:STYLE_MAX_LENGTH].rstrip()
        return value

    jlpt_level: int | None = Field(
        default=None,
        description=(
            "The JLPT level this is usually taught at, 5 through 1, or null if "
            "it does not sit on that scale. 1 is the hardest."
        ),
    )
    examples: list[EnrichedExample] = Field(
        default_factory=list,
        description="Two sentences. Empty when unrecognised, or when senses are ambiguous.",
    )


ENRICHMENT_SYSTEM = """\
You explain Japanese grammar points for a learner's private study deck. You are \
given a pattern as it would be written in a textbook index, and you return what \
that entry would say.

# What matters

**Admit an unknown.** If the string is not a grammar point you recognise — a \
typo, a fragment, an ordinary word — set `unrecognised` and stop. Do not \
reconstruct what you think was meant. A wrong explanation here is studied and \
rehearsed; a flagged one costs a correction.

**Do not choose between senses.** Several patterns carry more than one \
unrelated meaning. ～ものだ is a general truth, a nostalgic recollection, a \
strong piece of advice, or an exclamation, depending on use. ～わけ is not one \
pattern at all. When the request does not name a sense and the pattern has \
several, list them in `other_senses`, leave the rest empty, and return. When the \
request *does* name a sense, explain only that one.

**Explain the constraint.** Most of these patterns are got wrong on what has to \
follow them, not on what they mean: ～てからでないと needs a negative or an \
impossibility after it; ～ばかりに carries an unwelcome result. Put that in \
`formation` where it will be read.

# The example sentences

Two, short, using common vocabulary. They are there to show the grammar, so a \
rare word in them tests the wrong thing. Prefer everyday situations over \
textbook artificiality, and vary the two — one statement and one question, or \
two different tenses, teaches more than a matched pair.

If the learner supplied their own sentence, treat it as the authority on which \
sense and register are meant, and write yours to match it.
"""


def _client(settings: Settings) -> anthropic.AsyncAnthropic:
    if not settings.has_anthropic:
        raise EnrichmentUnavailable(
            "ANTHROPIC_API_KEY is not configured, so grammar enrichment is disabled."
        )
    headers = {}
    if settings.anthropic_workspace_id:
        headers["anthropic-workspace-id"] = settings.anthropic_workspace_id

    return anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key.get_secret_value(),
        # Bounded for the same reason the vision client is: the SDK's default is
        # ten minutes, and the phone is holding this request open.
        timeout=settings.grammar_timeout_seconds,
        default_headers=headers or None,
    )


def _prompt(
    pattern: str,
    *,
    sense_label: str = "",
    source: str | None = None,
    note: str | None = None,
    user_example: str | None = None,
) -> str:
    """What we actually ask, assembled from whatever context the entry carries.

    Each piece is included only when present. An empty heading is worse than a
    missing one — it invites the model to fill it.
    """
    parts = [f"Pattern: {pattern}"]
    if sense_label:
        parts.append(f"Sense to explain: {sense_label}")
    if source:
        parts.append(f"Met in: {source}")
    if note:
        parts.append(f"The learner's note: {note}")
    if user_example:
        parts.append(f"The learner's own example sentence: {user_example}")
    return "\n".join(parts)


async def enrich(
    pattern: str,
    *,
    sense_label: str = "",
    source: str | None = None,
    note: str | None = None,
    user_example: str | None = None,
    settings: Settings | None = None,
    client: anthropic.AsyncAnthropic | None = None,
) -> EnrichedGrammar:
    """Explain one pattern.

    `client` is injectable so tests never reach the network.
    """
    settings = settings or get_settings()
    client = client or _client(settings)

    try:
        response = await client.messages.parse(
            model=settings.grammar_model,
            max_tokens=16000,
            system=ENRICHMENT_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": _prompt(
                        pattern,
                        sense_label=sense_label,
                        source=source,
                        note=note,
                        user_example=user_example,
                    ),
                }
            ],
            output_format=EnrichedGrammar,
        )
    except anthropic.AuthenticationError as exc:
        raise EnrichmentFailed("The configured Anthropic API key was rejected.") from exc
    except anthropic.RateLimitError as exc:
        raise EnrichmentFailed(
            "Rate limited while looking that up. Try again shortly."
        ) from exc
    except anthropic.BadRequestError as exc:
        message = str(getattr(exc, "message", exc))
        if "anthropic-workspace-id" in message:
            raise EnrichmentFailed(
                "This API key is identity-linked, so the request has to name a "
                "workspace. Set ANTHROPIC_WORKSPACE_ID in backend/.env — the id "
                "is in the Anthropic console URL, "
                "platform.claude.com/workspaces/<id>/..."
            ) from exc
        raise EnrichmentFailed(f"The request was rejected: {message}") from exc
    except anthropic.APITimeoutError as exc:
        raise EnrichmentFailed("Looking that up took too long. Try again.") from exc
    except anthropic.APIConnectionError as exc:
        raise EnrichmentFailed("Could not reach the enrichment service.") from exc
    except anthropic.APIStatusError as exc:
        raise EnrichmentFailed(f"Enrichment service error ({exc.status_code}).") from exc

    # A refusal is HTTP 200 with no parsed output, so it is checked before
    # reading — going at `.parsed_output` first raises something opaque.
    if response.stop_reason == "refusal":
        raise EnrichmentFailed("The enrichment service declined that request.")

    result = response.parsed_output
    if result is None:  # pragma: no cover - parse() populates this or raises
        raise EnrichmentFailed("The enrichment service returned nothing.")

    return result
