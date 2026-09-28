"""The lesson worker's run log and the catalog built on it, against real SQL.

The model is faked; everything else — the run row, per-bundle commits, the
repeat filter, and the two catalog routes — runs for real.

Skipped unless `TEST_DATABASE_URL` is set — see
`tests/test_repository_integration.py` for why that is a separate variable.
"""

from __future__ import annotations

import os
from types import SimpleNamespace

import httpx2 as httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import db_session
from app.config import Settings, get_settings
from app.db import repository as repo
from app.db.models import Base, GenerationRun, Question
from app.main import create_app
from app.schemas import DetectedItem
from app.services.lessons import DraftBatch, DraftQuestion, Verdict, top_up_bundles

RAW_URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not RAW_URL, reason="TEST_DATABASE_URL is not set")


def _settings(**overrides) -> Settings:
    base = dict(
        wanikani_apikey="test",
        database_url=RAW_URL,
        anthropic_api_key="test-key",
        lesson_bundles_per_run=2,
        lesson_questions_per_bundle=3,
        lesson_retry_passes=0,
    )
    base.update(overrides)
    return Settings(**base)


class FakeModel:
    """Answers generation calls from a script, and passes every verification."""

    def __init__(self, batches: list[list[DraftQuestion]]):
        self.batches = list(batches)
        self.prompts: list[str] = []
        self.messages = self

    async def parse(self, *, output_format, messages, **kwargs):
        if output_format is DraftBatch:
            self.prompts.append(messages[0]["content"])
            questions = self.batches.pop(0) if self.batches else []
            return SimpleNamespace(parsed_output=DraftBatch(questions=questions))
        return SimpleNamespace(parsed_output=Verdict(ok=True))


def recall(word_id: int, prompt: str, answer: str) -> DraftQuestion:
    return DraftQuestion(
        type="recall",
        prompt=prompt,
        answer=answer,
        vocab_item_ids=[word_id],
        furigana={"免許": "めんきょ"},
        rationale="test",
    )


@pytest.fixture
async def seeded():
    engine = create_async_engine(Settings(wanikani_apikey="t", database_url=RAW_URL).database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        user = await repo.upsert_user(
            session, wanikani_user_id="uuid-1", username="ryan",
            level=4, max_level_granted=60, subscription_active=False,
        )
        words = await repo.create_flashcards(
            session,
            [
                DetectedItem(key="a", kanji_furigana="免許", furigana_only="めんきょ",
                             english="licence", selected=True),
                DetectedItem(key="b", kanji_furigana="相手", furigana_only="あいて",
                             english="partner", selected=True),
            ],
            user_id=user.id,
        )
        await session.commit()

    yield factory, user.id, [w.id for w in words]
    await engine.dispose()


async def test_a_run_is_recorded_and_its_questions_point_at_it(seeded):
    factory, user_id, (w1, w2) = seeded
    model = FakeModel([
        [recall(w1, "免許を英語で？", "licence"), recall(w2, "相手を英語で？", "partner")],
        [recall(w1, "「めんきょ」を漢字で？", "免許"), recall(w2, "「あいて」を漢字で？", "相手")],
    ])

    async with factory() as session:
        result = await top_up_bundles(
            session, user_id, trigger="schedule", settings=_settings(), client=model
        )

    assert result.bundles_created == 2
    async with factory() as session:
        run = await session.get(GenerationRun, result.run_id)
        assert (run.trigger, run.status, run.bundles_created) == ("schedule", "completed", 2)
        assert run.finished_at is not None

        questions = (await session.execute(select(Question))).scalars().all()
        assert {q.run_id for q in questions} == {run.id}
        # The furigana made it from the model's list into the stored map.
        assert questions[0].payload["furigana"] == {"免許": "めんきょ"}


async def test_the_second_bundle_is_told_what_the_first_wrote_and_repeats_are_dropped(seeded):
    factory, user_id, (w1, w2) = seeded
    first = [recall(w1, "免許を英語で？", "licence"), recall(w2, "相手を英語で？", "partner")]
    # The generator repeats itself word for word on the second call.
    model = FakeModel([first, first + [recall(w1, "「めんきょ」を漢字で？", "免許")]])

    async with factory() as session:
        result = await top_up_bundles(session, user_id, settings=_settings(), client=model)

    # The second prompt carried the first bundle's questions as "already asked".
    assert "Already asked recently" in model.prompts[1]
    assert "免許を英語で？" in model.prompts[1]

    # Both repeats were discarded before verification; only the new one stored.
    assert result.rejected == 2
    async with factory() as session:
        stored = (await session.execute(select(Question))).scalars()
        prompts = sorted(q.payload["prompt"] for q in stored)
        assert prompts == sorted(["免許を英語で？", "相手を英語で？", "「めんきょ」を漢字で？"])


async def test_a_stocked_queue_is_a_skipped_run_not_a_silent_one(seeded):
    factory, user_id, _ = seeded
    async with factory() as session:
        result = await top_up_bundles(
            session, user_id, trigger="LessonBundleClaimed",
            settings=_settings(lesson_bundle_low_water=0), client=FakeModel([]),
        )
    assert result.skipped
    async with factory() as session:
        run = await session.get(GenerationRun, result.run_id)
        assert (run.status, run.reason) == ("skipped", "queue is stocked")


async def test_a_run_that_blows_up_is_marked_failed_and_keeps_finished_bundles(seeded):
    factory, user_id, (w1, w2) = seeded

    class Exploding(FakeModel):
        async def parse(self, *, output_format, **kwargs):
            if output_format is DraftBatch and not self.batches:
                raise RuntimeError("boom")
            return await super().parse(output_format=output_format, **kwargs)

    model = Exploding(
        [[recall(w1, "免許を英語で？", "licence"), recall(w2, "相手を英語で？", "partner")]]
    )
    async with factory() as session:
        with pytest.raises(RuntimeError):
            await top_up_bundles(session, user_id, settings=_settings(), client=model)

    async with factory() as session:
        run = (await session.execute(select(GenerationRun))).scalar_one()
        assert run.status == "failed" and "boom" in run.reason
        # The first bundle was committed before the second call failed.
        assert await repo.count_unconsumed_bundles(session, user_id) == 1


async def test_the_catalog_lists_runs_and_their_questions(seeded, monkeypatch):
    factory, user_id, (w1, w2) = seeded
    model = FakeModel(
        [[recall(w1, "免許を英語で？", "licence"), recall(w2, "相手を英語で？", "partner")]]
    )
    async with factory() as session:
        result = await top_up_bundles(
            session, user_id, settings=_settings(lesson_bundles_per_run=1), client=model
        )
        # And one skipped run, which is counted rather than listed.
        await top_up_bundles(
            session, user_id, settings=_settings(lesson_bundle_low_water=0), client=model
        )

    monkeypatch.setenv("wanikani_apikey", "test-token")
    monkeypatch.setenv("DATABASE_URL", RAW_URL)
    get_settings.cache_clear()
    app = create_app()
    session = factory()

    async def _session_override():
        yield session

    app.dependency_overrides[db_session] = _session_override
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        listing = (await client.get("/api/generation-runs")).json()
        assert [r["id"] for r in listing["runs"]] == [result.run_id]
        assert listing["skippedLastWeek"] == 1
        assert listing["lastRunStatus"] == "skipped"
        assert listing["runs"][0]["verified"] == 2
        assert listing["runs"][0]["served"] == 0

        # Claiming the bundle turns its questions from waiting into served.
        detail = (await client.get(f"/api/generation-runs/{result.run_id}")).json()
        assert {q["standing"] for q in detail["questions"]} == {"waiting"}
        await client.get("/api/lesson-bundles/next")
        detail = (await client.get(f"/api/generation-runs/{result.run_id}")).json()
        assert {q["standing"] for q in detail["questions"]} == {"served"}
        assert detail["run"]["served"] == 2

        assert (await client.get("/api/generation-runs/9999")).status_code == 404

    await session.close()
    get_settings.cache_clear()
