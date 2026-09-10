"""Generated practice: a question writer, and a verifier that can veto it.

Two agents, and the split is the whole point of the module.

The **generator** is asked for a batch of questions over words the user is
actually studying. It is good at this and wrong often enough to matter — a
plausible distractor that is also a correct answer, a blank whose sentence
admits two fillers, a "correct" index off by one. None of those look wrong in
the payload; they look like questions.

The **verifier** reads each draft back with no memory of having written it and
answers one question: is exactly one of these answers right? It cannot fix a
question, only pass or fail it. That asymmetry is deliberate — a verifier that
edits is a second generator, and it would talk itself into the draft it just
read.

**Nothing unverified is ever served.** `questions.verified` starts false and
only `mark_question_verified` sets it. A wrong answer key is worse than a
missing question: the SRS will rehearse the mistake until the user believes it.

The mix is three pools — review, new, continuing — assembled by the repository
and passed in here already separated. Merging them is the failure this design
is avoiding: right after an import, "new" is enormous, and a generator handed
one list will write a lesson entirely about words learned this morning.

Grammar is optional context, never a requirement. A user with no confirmed
grammar entries gets vocabulary-only questions, which is a complete product.
Only entries a human has confirmed (`enriched`) are ever passed in — the same
rule photo import follows.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Literal

import anthropic
from anthropic import beta_async_tool
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import repository as repo
from app.db.models import QUESTION_TYPES, GrammarEntry, VocabItem

logger = logging.getLogger(__name__)


class GenerationUnavailable(RuntimeError):
    """No ANTHROPIC_API_KEY, so lesson generation is switched off."""


class GenerationFailed(RuntimeError):
    """The batch could not be generated. Safe to log; nobody is waiting."""


QuestionType = Literal[
    "multiple_choice", "fill_in_blank", "sentence_construction", "recall"
]


# -- what we ask the generator for ----------------------------------------


class DraftQuestion(BaseModel):
    type: QuestionType = Field(
        description=(
            "multiple_choice: four options, one right. "
            "fill_in_blank: a sentence with one gap. "
            "sentence_construction: tiles to order into a sentence. "
            "recall: a prompt answered by typing, no options shown."
        )
    )
    prompt: str = Field(
        description=(
            "What the learner reads. For fill_in_blank put the gap as ___ "
            "(three underscores) exactly once."
        )
    )
    choices: list[str] = Field(
        default_factory=list,
        description=(
            "Exactly four for multiple_choice, empty for every other type. "
            "The wrong three must be wrong — a distractor that is also "
            "acceptable makes the question unanswerable, and this is the "
            "single most common way these go bad."
        ),
    )
    answer: str = Field(
        description=(
            "The correct answer as the learner would type or pick it. For "
            "multiple_choice it must match one of `choices` character for "
            "character."
        )
    )
    tiles: list[str] = Field(
        default_factory=list,
        description=(
            "sentence_construction only; empty for every other type. The "
            "sentence broken into the chunks the learner drags into order — "
            "words and particles as separate tiles, e.g. "
            "['音楽を', '聞きながら', '勉強します']. Joining them in the right "
            "order must reproduce `answer` exactly, and there must be at least "
            "three, or there is nothing to arrange."
        ),
    )
    vocab_item_ids: list[int] = Field(
        description=(
            "Ids of the words this question actually tests, taken from the "
            "word list given. Never invent an id. A question that tests one "
            "word lists one."
        )
    )
    grammar_entry_id: int | None = Field(
        default=None,
        description=(
            "Id of the grammar point this question exercises, when it was "
            "built around one. Null when it tests vocabulary alone."
        ),
    )
    rationale: str = Field(
        description=(
            "One line on why this answer is right and the others are not. The "
            "verifier reads it; the learner never does."
        )
    )


class DraftBatch(BaseModel):
    questions: list[DraftQuestion]


# -- what we ask the verifier for -----------------------------------------


class Verdict(BaseModel):
    ok: bool = Field(
        description=(
            "True only if the question is answerable and the stated answer is "
            "the single correct one. When in doubt, false — a rejected "
            "question costs nothing and a wrong one gets rehearsed."
        )
    )
    reason: str = Field(
        default="",
        description=(
            "When false, what is wrong, in one line: 'two choices are both "
            "acceptable readings', 'the blank admits either particle', "
            "'answer does not appear in choices'. Empty when true."
        )
    )


GENERATOR_SYSTEM = """You write Japanese practice questions for one learner.

You are given the words they are studying, split into three pools, and any
grammar points they have logged and confirmed. Write questions that test those
words.

Weight the batch: mostly `review`, a few from `new`, some `continuing`. The new
pool is a seasoning. A lesson made entirely of words learned this morning is
not a lesson, it is a re-run of the morning.

Vary the question types. Recall is the hardest and should not be the whole set.

Two rules that matter more than variety:

1. Every wrong choice must be actually wrong. If a distractor is also a
   correct reading, meaning or particle, the question cannot be answered and
   will be rejected.
2. Only use the vocab_item_ids you were given. Never invent one, and never
   test a word that is not in the pools.

Where a confirmed grammar point fits the words naturally, build a question
around it and set grammar_entry_id. Where none fits, do not force it — a
vocabulary question is a perfectly good question."""


VERIFIER_SYSTEM = """You check one Japanese practice question and pass or fail it.

You did not write it. Do not assume it is right, and do not repair it — your
only output is a verdict.

Fail it when:
- more than one of the choices is an acceptable answer
- the stated answer is not among the choices, for a multiple-choice question
- the sentence admits a filler other than the stated answer
- the prompt is ambiguous about what is being asked for (meaning or reading)
- the Japanese is unnatural, or the question tests something other than the
  word it claims to

Pass it only when the question is answerable and exactly one answer is right.
When you are unsure, fail it. A rejected question costs one generation; a wrong
one gets rehearsed into a deck until the learner believes it."""


VERIFIER_SYSTEM_WITH_TOOLS = (
    VERIFIER_SYSTEM
    + """

You have `look_up_word`, which reads the learner's own deck. Use it on the
stated answer and on every distractor before you rule.

The check it exists for: a distractor that the deck lists as an accepted answer
for the word being tested makes the question unanswerable, however plausible it
looks. Your own sense of the language cannot settle that — the deck can.

A word that is not in the deck is not grounds for failing anything. It only
means the word was not photographed or synced, which is normal."""
)


def _client(settings: Settings) -> anthropic.AsyncAnthropic:
    if settings.anthropic_api_key is None:
        raise GenerationUnavailable("ANTHROPIC_API_KEY is not set.")

    kwargs = {
        "api_key": settings.anthropic_api_key.get_secret_value(),
        "timeout": settings.lesson_timeout_seconds,
    }
    if settings.anthropic_workspace_id:
        kwargs["default_headers"] = {
            "anthropic-workspace-id": settings.anthropic_workspace_id
        }
    return anthropic.AsyncAnthropic(**kwargs)


def _describe(item: VocabItem) -> str:
    reading = f" ({item.furigana_only})" if item.furigana_only else ""
    context = f" [{item.usage_context}]" if item.usage_context else ""
    return f"  id={item.id} {item.kanji_furigana}{reading}{context} — {item.english}"


def _pool_block(name: str, items: list[VocabItem]) -> str:
    if not items:
        return f"{name}: (none)"
    return f"{name}:\n" + "\n".join(_describe(i) for i in items)


def _grammar_block(entries: list[GrammarEntry]) -> str:
    if not entries:
        return (
            "Grammar points: (none confirmed — write vocabulary questions only, "
            "which is expected and fine)"
        )
    lines = []
    for entry in entries:
        sense = f" [{entry.sense_label}]" if entry.sense_label else ""
        lines.append(
            f"  id={entry.id} {entry.pattern}{sense} — {entry.meaning or 'no gloss'}"
            + (f" | formation: {entry.formation}" if entry.formation else "")
        )
    return "Grammar points:\n" + "\n".join(lines)


def _generation_prompt(
    pools: dict[str, list[VocabItem]], grammar: list[GrammarEntry], count: int
) -> str:
    return "\n\n".join(
        [
            f"Write {count} questions.",
            _pool_block("review (due now — most of the batch)", pools.get("review", [])),
            _pool_block("new (just learned — a few only)", pools.get("new", [])),
            _pool_block("continuing (in progress)", pools.get("continuing", [])),
            _grammar_block(grammar),
        ]
    )


def _verification_prompt(draft: DraftQuestion) -> str:
    parts = [
        f"Type: {draft.type}",
        f"Prompt: {draft.prompt}",
    ]
    if draft.choices:
        parts.append("Choices:\n" + "\n".join(f"  - {c}" for c in draft.choices))
    parts.append(f"Stated answer: {draft.answer}")
    parts.append(f"Author's rationale: {draft.rationale}")
    return "\n".join(parts)


def _structurally_sound(draft: DraftQuestion, known_item_ids: set[int]) -> str | None:
    """Cheap checks before spending a verifier call.

    These are the failures a model cannot talk its way out of and we should not
    pay to have confirmed: a hallucinated id, a missing gap, an answer that is
    not among its own choices.

    Returns the reason it is unsound, or None if it is worth verifying.
    """
    if not draft.vocab_item_ids:
        return "no vocab items named"
    unknown = [i for i in draft.vocab_item_ids if i not in known_item_ids]
    if unknown:
        return f"vocab ids not in the pools: {unknown}"
    if draft.type not in QUESTION_TYPES:
        return f"unknown question type {draft.type!r}"
    if draft.type == "multiple_choice":
        if len(draft.choices) != 4:
            return f"{len(draft.choices)} choices, expected 4"
        if len(set(draft.choices)) != 4:
            return "duplicate choices"
        if draft.answer not in draft.choices:
            return "answer is not among the choices"
    elif draft.choices:
        return f"{draft.type} should carry no choices"

    if draft.type == "sentence_construction":
        # Checked here rather than by the verifier because it is string
        # equality, not judgement: tiles that do not rebuild the answer make
        # the question literally unsolvable, and the app has nothing to render.
        if len(draft.tiles) < 3:
            return f"sentence_construction needs at least 3 tiles, got {len(draft.tiles)}"
        if "".join(draft.tiles) != draft.answer.replace(" ", ""):
            return "tiles do not join to form the stated answer"
    elif draft.tiles:
        return f"{draft.type} should carry no tiles"
    if draft.type == "fill_in_blank" and draft.prompt.count("___") != 1:
        return "fill_in_blank needs exactly one ___ gap"
    if not draft.answer.strip():
        return "empty answer"
    return None


async def generate_drafts(
    pools: dict[str, list[VocabItem]],
    grammar: list[GrammarEntry],
    *,
    count: int,
    feedback: list[str] | None = None,
    settings: Settings | None = None,
    client: anthropic.AsyncAnthropic | None = None,
) -> list[DraftQuestion]:
    """One generation call. `client` is injectable so tests never hit the network."""
    settings = settings or get_settings()
    client = client or _client(settings)

    try:
        response = await client.messages.parse(
            model=settings.lesson_model,
            max_tokens=16000,
            system=GENERATOR_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": _generation_prompt(pools, grammar, count, feedback),
                }
            ],
            output_format=DraftBatch,
        )
    except anthropic.APIStatusError as exc:
        raise GenerationFailed(f"Generation rejected ({exc.status_code}).") from exc
    except (anthropic.APITimeoutError, anthropic.APIConnectionError) as exc:
        raise GenerationFailed("Could not reach the generation service.") from exc

    batch = response.parsed_output
    if batch is None:
        raise GenerationFailed("The generator returned no parsed output.")
    return batch.questions


async def verify_draft(
    draft: DraftQuestion,
    *,
    session: AsyncSession | None = None,
    settings: Settings | None = None,
    client: anthropic.AsyncAnthropic | None = None,
) -> Verdict:
    """Second opinion on one draft.

    Runs on `verifier_model` — a cheaper model than the generator, and the
    asymmetry is the point. Writing a good question is a judgement call;
    checking one against rows fetched from the deck is a much easier task. This
    is also the call that scales: one generation per bundle, one verification
    per question.

    With a `session`, the verifier gets `look_up_word` and the loop runs until
    it stops calling tools. That matters for exactly one failure the design
    cares most about — a distractor that is *also* an accepted answer for the
    word being tested. A verifier working from parametric memory has to guess
    whether "permission" is acceptable for 免許; one that can read
    `vocab_answers` does not.

    Without a session it degrades to a single stateless call, which is what the
    unit tests use.

    A failure to *reach* the verifier is a rejection, not a pass. Defaulting to
    "serve it" the moment the network wobbles would quietly delete the only
    safeguard this module has.
    """
    settings = settings or get_settings()
    client = client or _client(settings)

    # Only multiple choice can have a secretly-correct distractor, and the tool
    # loop is several round trips. Spending it on a recall question — which has
    # no choices to be wrong about — buys nothing.
    use_tools = session is not None and draft.type == "multiple_choice"

    try:
        if use_tools:
            return await _verify_with_lookup(draft, session, settings, client)

        response = await client.messages.parse(
            model=settings.verifier_model,
            max_tokens=2000,
            system=VERIFIER_SYSTEM,
            messages=[{"role": "user", "content": _verification_prompt(draft)}],
            output_format=Verdict,
        )
    except anthropic.APIError as exc:
        logger.warning("Verifier unreachable, rejecting draft: %s", exc)
        return Verdict(ok=False, reason="verifier unreachable")

    verdict = response.parsed_output
    if verdict is None:
        return Verdict(ok=False, reason="verifier returned no parsed output")
    return verdict


async def _verify_with_lookup(
    draft: DraftQuestion,
    session: AsyncSession,
    settings: Settings,
    client: anthropic.AsyncAnthropic,
) -> Verdict:
    """The tool-using path: let the verifier read the deck before ruling.

    The tool closes over the session rather than taking it as an argument —
    the model chooses what to look up, never which database to look in.
    """

    @beta_async_tool
    async def look_up_word(written_form: str) -> str:
        """Look one word up in the learner's own deck.

        Use this on the answer and on every distractor before ruling. A
        distractor that appears here as an accepted answer for the word being
        tested makes the question unanswerable.

        Args:
            written_form: The word as written, e.g. 免許, or its reading.
        """
        rows = await repo.find_words(session, written_form)
        if not rows:
            return f"{written_form}: not in the deck."
        return "\n".join(rows)

    messages: list[dict] = [
        {"role": "user", "content": _verification_prompt(draft)}
    ]

    runner = client.beta.messages.tool_runner(
        model=settings.verifier_model,
        max_tokens=2000,
        system=VERIFIER_SYSTEM_WITH_TOOLS,
        tools=[look_up_word],
        messages=messages,
        output_format=Verdict,
    )

    final = None
    async for message in runner:
        final = message

    if final is None:
        return Verdict(ok=False, reason="verifier produced no message")

    verdict = getattr(final, "parsed_output", None)
    if verdict is None:
        return Verdict(ok=False, reason="verifier returned no parsed output")
    return verdict


def to_payload(draft: DraftQuestion) -> dict:
    """The stored shape. Varies by type, which is why the column is JSONB."""
    payload: dict = {"prompt": draft.prompt, "answer": draft.answer}
    if draft.choices:
        payload["choices"] = draft.choices
    if draft.tiles:
        # Stored shuffled would be wrong: the app shuffles for display, and a
        # stored order is the answer key for grading a drag-and-drop.
        payload["tiles"] = draft.tiles
    return payload


def prune_for_variety(
    drafts: list[DraftQuestion], *, max_repeats_per_word: int
) -> tuple[list[DraftQuestion], list[str]]:
    """Thin a batch that leans on the same words over and over.

    **Deliberately not a model's job.** Repetition is a property of the batch,
    and the verifier sees one question at a time — it could not detect this if
    asked. It is also purely countable, so a model would only add cost and the
    chance of being talked out of an arithmetic fact.

    The generator is *told* to vary its output, and mostly does. This is the
    check that the instruction was followed, which is a different thing from
    the instruction.

    Keeps the first occurrences and drops the surplus, so an over-drilled word
    still appears — just not six times. Returns what survived, and one line per
    drop for the run's log.
    """
    seen: dict[int, int] = {}
    kept: list[DraftQuestion] = []
    dropped: list[str] = []

    for question in drafts:
        over = [
            item_id
            for item_id in question.vocab_item_ids
            if seen.get(item_id, 0) >= max_repeats_per_word
        ]
        if over:
            dropped.append(f"word {over[0]} already used {max_repeats_per_word}x")
            continue

        for item_id in question.vocab_item_ids:
            seen[item_id] = seen.get(item_id, 0) + 1
        kept.append(question)

    return kept, dropped


def variety_note(drafts: list[DraftQuestion]) -> str:
    """One line describing how monotonous a batch turned out.

    Fed back to the generator on a retry pass rather than enforced: question
    type is a judgement call about the material — a set of words with no shared
    grammar genuinely does not support sentence construction — so telling the
    generator what it did and letting it choose beats deleting its work.
    """
    counts = Counter(d.type for d in drafts)
    rendered = ", ".join(f"{kind}: {n}" for kind, n in sorted(counts.items()))
    return f"The last pass produced {rendered}."


# -- the scheduled top-up ---------------------------------------------------


class TopUpResult(BaseModel):
    """What one scheduled run did. Returned from the Lambda handler as-is."""

    ok: bool = True
    skipped: bool = False
    reason: str = ""
    bundles_waiting: int = 0
    words_projected: int = 0
    drafted: int = 0
    rejected: int = 0
    bundles_created: int = 0


async def _build_one_bundle(
    session: AsyncSession,
    user_id: int,
    pools: dict[str, list[VocabItem]],
    grammar: list[GrammarEntry],
    known_ids: set[int],
    *,
    settings: Settings,
    client: anthropic.AsyncAnthropic,
) -> tuple[list[int], int, int]:
    """Generate, check and store the questions for one bundle.

    Returns the ids that survived, how many were drafted, and how many were
    rejected.

    The retry pass is the reason this is a loop rather than a single call. A
    first pass typically loses a couple of questions to a distractor that turns
    out to be acceptable; feeding those rejections back — with their reasons —
    recovers most of them. The feedback is text, not structure: the generator is
    told what went wrong and asked for replacements, which is the cheapest
    possible form of the retry.
    """
    verified_ids: list[int] = []
    drafted = 0
    rejected = 0
    feedback: list[str] = []

    for attempt in range(settings.lesson_retry_passes + 1):
        wanted = settings.lesson_questions_per_bundle - len(verified_ids)
        if wanted <= 0:
            break

        try:
            drafts = await generate_drafts(
                pools,
                grammar,
                count=wanted,
                feedback=feedback,
                settings=settings,
                client=client,
            )
        except GenerationFailed as exc:
            logger.warning("Generation failed on pass %d: %s", attempt, exc)
            break

        drafted += len(drafts)

        drafts, thinned = prune_for_variety(
            drafts, max_repeats_per_word=settings.lesson_max_repeats_per_word
        )
        rejected += len(thinned)
        for note in thinned:
            logger.info("Pruned for variety: %s", note)

        feedback = []
        for draft in drafts:
            unsound = _structurally_sound(draft, known_ids)
            if unsound is not None:
                # Never reached the verifier, so nothing is stored: there is no
                # row to attach a note to, and a draft that failed arithmetic
                # teaches the prompt nothing a rule could not.
                logger.info("Discarding malformed draft: %s", unsound)
                rejected += 1
                feedback.append(f"{draft.prompt[:40]}… — {unsound}")
                continue

            verdict = await verify_draft(
                draft, session=session, settings=settings, client=client
            )
            question = await repo.create_question(
                session,
                user_id,
                question_type=draft.type,
                payload=to_payload(draft),
                vocab_item_ids=draft.vocab_item_ids,
                grammar_entry_id=draft.grammar_entry_id,
            )
            await repo.mark_question_verified(
                session, question, ok=verdict.ok, note=verdict.reason or None
            )

            if verdict.ok:
                verified_ids.append(question.id)
            else:
                rejected += 1
                feedback.append(f"{draft.prompt[:40]}… — {verdict.reason}")

        if drafts:
            feedback.append(variety_note(drafts))

        if not feedback:
            break

    return verified_ids, drafted, rejected


async def top_up_bundles(
    session: AsyncSession,
    user_id: int,
    *,
    settings: Settings | None = None,
    client: anthropic.AsyncAnthropic | None = None,
) -> TopUpResult:
    """Keep the lesson queue stocked. Called on a schedule, twice a day.

    Checks first and usually stops there — the queue is normally full, and a
    run that generates nothing should cost one COUNT and no model calls.

    Everything after the threshold check is best effort. This runs with nobody
    waiting on it, so a failure means the next run tries again; it must never
    leave half a bundle behind, which is why questions are only bundled after
    they have passed the verifier.
    """
    settings = settings or get_settings()

    waiting = await repo.count_unconsumed_bundles(session, user_id)
    if waiting >= settings.lesson_bundle_low_water:
        return TopUpResult(skipped=True, reason="queue is stocked", bundles_waiting=waiting)

    if not settings.has_anthropic:
        return TopUpResult(
            ok=False, skipped=True, reason="no ANTHROPIC_API_KEY", bundles_waiting=waiting
        )

    # Sync only fills `subjects` and `study_progress`, so a user who has never
    # imported a photo has nothing a question can point at until this runs.
    projected = await repo.project_wanikani_vocabulary(session, user_id)

    pools = await repo.get_generation_pools(session, user_id)
    if not any(pools.values()):
        return TopUpResult(
            skipped=True,
            reason="nothing studied yet to build questions from",
            bundles_waiting=waiting,
            words_projected=projected,
        )

    grammar = await repo.list_confirmed_grammar(session, user_id)
    known_ids = {item.id for pool in pools.values() for item in pool}

    client = client or _client(settings)
    drafted = 0
    rejected = 0
    created = 0

    for _ in range(settings.lesson_bundles_per_run):
        question_ids, n_drafted, n_rejected = await _build_one_bundle(
            session,
            user_id,
            pools,
            grammar,
            known_ids,
            settings=settings,
            client=client,
        )
        drafted += n_drafted
        rejected += n_rejected

        # A bundle of one is not a lesson. Verified questions stay in the table
        # either way — a later run can bundle them — rather than shipping a stub.
        if len(question_ids) >= 2:
            await repo.create_bundle(session, user_id, question_ids)
            created += 1

    return TopUpResult(
        bundles_waiting=waiting + created,
        words_projected=projected,
        drafted=drafted,
        rejected=rejected,
        bundles_created=created,
    )
