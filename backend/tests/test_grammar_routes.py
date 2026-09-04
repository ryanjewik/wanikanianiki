"""Grammar logging, end to end against real SQL.

Skipped unless `TEST_DATABASE_URL` is set — see
`tests/test_repository_integration.py` for why that is a separate variable.
"""

from __future__ import annotations

import os
from datetime import date
from types import SimpleNamespace

import httpx2 as httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.deps import db_session
from app.config import Settings, get_settings
from app.db import repository as repo
from app.db.models import Base
from app.main import create_app
from app.services import grammar as grammar_service
from app.wanikani.mapping import build_streak

RAW_URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not RAW_URL, reason="TEST_DATABASE_URL is not set")

POINT = "～てからでないと"


def _async_url() -> str:
    return Settings(wanikani_apikey="test", database_url=RAW_URL).database_url


@pytest.fixture
async def ctx(monkeypatch):
    monkeypatch.setenv("wanikani_apikey", "test-token")
    monkeypatch.setenv("DATABASE_URL", RAW_URL)
    get_settings.cache_clear()

    engine = create_async_engine(_async_url())
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session = async_sessionmaker(engine, expire_on_commit=False)()
    async with session.begin():
        user = await repo.upsert_user(
            session, wanikani_user_id="uuid-1", username="ryan",
            level=4, max_level_granted=60, subscription_active=False,
        )

    app = create_app()

    async def _session_override():
        yield session

    app.dependency_overrides[db_session] = _session_override

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, session, user

    await session.close()
    await engine.dispose()
    from app.db.session import dispose_engine

    await dispose_engine()
    get_settings.cache_clear()


async def test_the_pattern_alone_is_enough_to_log(ctx):
    """The whole point of logging in the app: eight characters, no lookup."""
    client, _, _ = ctx

    response = await client.post(
        "/api/grammar-entries",
        json={"pattern": POINT, "learnedOn": "2026-09-03"},
    )
    assert response.status_code == 201

    body = response.json()
    assert body["pattern"] == POINT
    assert body["learnedOn"] == "2026-09-03"
    # Nothing has been enriched yet, and nothing pretends otherwise.
    assert body["enriched"] is False
    assert body["meaning"] is None
    assert body["examples"] == []
    # Empty rather than null, which is what makes the uniqueness rule work.
    assert body["senseLabel"] == ""


async def test_logging_the_same_point_twice_reopens_it(ctx):
    """Meeting a pattern again is not a second point, and not a second calendar mark."""
    client, _, _ = ctx

    first = await client.post(
        "/api/grammar-entries",
        json={"pattern": POINT, "learnedOn": "2026-09-03", "source": "Quartet II, L5"},
    )
    second = await client.post(
        "/api/grammar-entries",
        json={
            "pattern": POINT,
            "learnedOn": "2026-09-10",
            "examples": [{"japanese": "手を洗ってからでないと食べられない。"}],
        },
    )

    assert second.json()["id"] == first.json()["id"]
    # The day you first met it is the one worth remembering.
    assert second.json()["learnedOn"] == "2026-09-03"
    # Context from either logging survives.
    assert second.json()["source"] == "Quartet II, L5"
    assert len(second.json()["examples"]) == 1

    listed = (await client.get("/api/grammar-entries")).json()
    assert len(listed) == 1


async def test_the_same_pattern_in_a_different_sense_is_a_different_point(ctx):
    """ものだ is four points wearing one string; they schedule separately."""
    client, _, _ = ctx

    a = await client.post(
        "/api/grammar-entries",
        json={"pattern": "～ものだ", "senseLabel": "nostalgia", "learnedOn": "2026-09-01"},
    )
    b = await client.post(
        "/api/grammar-entries",
        json={"pattern": "～ものだ", "senseLabel": "strong advice", "learnedOn": "2026-09-02"},
    )

    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] != b.json()["id"]
    assert len((await client.get("/api/grammar-entries")).json()) == 2


async def test_enrichment_is_confirmed_without_echoing_the_whole_row(ctx):
    """PATCH: absent means unchanged, so confirming does not blank what it omits."""
    client, _, _ = ctx

    entry_id = (
        await client.post(
            "/api/grammar-entries",
            json={"pattern": POINT, "learnedOn": "2026-09-03", "note": "trips me up"},
        )
    ).json()["id"]

    patched = await client.patch(
        f"/api/grammar-entries/{entry_id}",
        json={
            "meaning": "unless/until you first do X",
            "formation": "Vて + からでないと + negative",
            "style": "plain",
            "jlptLevel": 3,
            "enriched": True,
        },
    )
    assert patched.status_code == 200

    body = patched.json()
    assert body["meaning"] == "unless/until you first do X"
    assert body["style"] == "plain"
    assert body["enriched"] is True
    # Untouched fields survived.
    assert body["note"] == "trips me up"
    assert body["learnedOn"] == "2026-09-03"


async def test_the_sentence_from_class_sorts_above_the_generated_ones(ctx):
    """It pins the sense, the conjugation and the register at once."""
    client, _, _ = ctx

    entry_id = (
        await client.post(
            "/api/grammar-entries", json={"pattern": POINT, "learnedOn": "2026-09-03"}
        )
    ).json()["id"]

    patched = await client.patch(
        f"/api/grammar-entries/{entry_id}",
        json={
            "examples": [
                {"japanese": "生成された文。", "isUserSupplied": False},
                {"japanese": "授業で書いた文。", "isUserSupplied": True},
            ]
        },
    )
    examples = patched.json()["examples"]
    assert [e["japanese"] for e in examples] == ["授業で書いた文。", "生成された文。"]


async def test_editing_examples_replaces_the_list(ctx):
    """A list edit has to be able to express a delete."""
    client, _, _ = ctx

    entry_id = (
        await client.post(
            "/api/grammar-entries",
            json={
                "pattern": POINT,
                "learnedOn": "2026-09-03",
                "examples": [{"japanese": "古い文。"}],
            },
        )
    ).json()["id"]

    patched = await client.patch(
        f"/api/grammar-entries/{entry_id}", json={"examples": [{"japanese": "新しい文。"}]}
    )
    assert [e["japanese"] for e in patched.json()["examples"]] == ["新しい文。"]


async def test_the_window_bounds_are_inclusive(ctx):
    """A caller asking for a month means both its edges."""
    client, _, _ = ctx

    for day in ("2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"):
        await client.post(
            "/api/grammar-entries", json={"pattern": f"pattern-{day}", "learnedOn": day}
        )

    listed = (
        await client.get("/api/grammar-entries?since=2026-09-01&until=2026-09-30")
    ).json()
    assert {e["learnedOn"] for e in listed} == {"2026-09-01", "2026-09-30"}


async def test_deleting_takes_its_examples_with_it(ctx):
    client, session, _ = ctx

    entry_id = (
        await client.post(
            "/api/grammar-entries",
            json={
                "pattern": POINT,
                "learnedOn": "2026-09-03",
                "examples": [{"japanese": "文。"}],
            },
        )
    ).json()["id"]

    assert (await client.delete(f"/api/grammar-entries/{entry_id}")).status_code == 204
    assert (await client.get(f"/api/grammar-entries/{entry_id}")).status_code == 404


async def test_an_unknown_entry_is_a_404(ctx):
    client, _, _ = ctx
    assert (await client.get("/api/grammar-entries/9999")).status_code == 404
    assert (await client.patch("/api/grammar-entries/9999", json={})).status_code == 404
    assert (await client.delete("/api/grammar-entries/9999")).status_code == 404


async def test_a_logged_day_shows_on_the_calendar_but_is_not_a_study_day(ctx):
    """The decision this whole split exists to enforce.

    Logging a point marks the day and nothing more. A streak you could keep by
    typing eight characters is a streak worth nothing, so the grammar day must
    reach the calendar without reaching either review log the streak reads.
    """
    client, session, user = ctx

    await client.post(
        "/api/grammar-entries", json={"pattern": POINT, "learnedOn": "2026-09-03"}
    )
    await session.commit()

    activity = (await client.get("/api/activity")).json()
    day = next(d for d in activity if d["day"] == "2026-09-03")
    assert day["grammarLogged"] == 1
    # Present on the calendar, absent from everything that counts.
    assert day["reviews"] == 0
    assert day["vocabReviews"] == 0

    review_days = await repo.get_review_days(session, user.timezone)
    vocab_days = await repo.get_vocab_review_days(session, user.timezone)
    assert date(2026, 9, 3) not in review_days | vocab_days
    assert build_streak(review_days | vocab_days, today=date(2026, 9, 3)).days == 0


# -- enrichment ------------------------------------------------------------


class FakeMessages:
    """Only the vendor call is replaced; the rest of the path runs for real."""

    def __init__(self, result, stop_reason="end_turn", raises=None):
        self._result = result
        self._stop_reason = stop_reason
        self._raises = raises
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises is not None:
            raise self._raises
        return SimpleNamespace(
            stop_reason=self._stop_reason, parsed_output=self._result
        )


def _stub(monkeypatch, result, **kwargs):
    fake = FakeMessages(result, **kwargs)
    monkeypatch.setattr(
        grammar_service, "_client", lambda settings: SimpleNamespace(messages=fake)
    )
    return fake


def _enriched(**overrides):
    payload = {
        "unrecognised": False,
        "other_senses": [],
        "meaning": "unless/until you first do X, you cannot Y",
        "formation": "Vて + からでないと + negative",
        "style": "plain",
        "jlpt_level": 3,
        "examples": [
            {"japanese": "手を洗ってからでないと食べられない。",
             "english": "You can't eat until you've washed your hands."},
            {"japanese": "予約してからでないと入れませんか。",
             "english": "Can't we get in without booking first?"},
        ],
    }
    payload.update(overrides)
    return grammar_service.EnrichedGrammar(**payload)


async def _log(client, **overrides):
    body = {"pattern": POINT, "learnedOn": "2026-09-03"}
    body.update(overrides)
    return (await client.post("/api/grammar-entries", json=body)).json()["id"]


async def test_enrichment_fills_the_row_but_does_not_confirm_it(ctx, monkeypatch):
    """The model writes the answer; only a person may call it checked."""
    client, _, _ = ctx
    _stub(monkeypatch, _enriched())
    entry_id = await _log(client)

    response = await client.post(f"/api/grammar-entries/{entry_id}/enrich")
    assert response.status_code == 200

    body = response.json()
    assert body["applied"] is True

    entry = body["entry"]
    assert entry["meaning"] == "unless/until you first do X, you cannot Y"
    assert entry["formation"] == "Vて + からでないと + negative"
    assert entry["jlptLevel"] == 3
    assert len(entry["examples"]) == 2
    # The whole point: generated content is not confirmed content.
    assert entry["enriched"] is False


async def test_an_unrecognised_pattern_writes_nothing(ctx, monkeypatch):
    """A typo must not come back as a confident explanation."""
    client, _, _ = ctx
    _stub(monkeypatch, _enriched(unrecognised=True, meaning="", examples=[]))
    entry_id = await _log(client, pattern="～てからでないとX")

    body = (await client.post(f"/api/grammar-entries/{entry_id}/enrich")).json()
    assert body["unrecognised"] is True
    assert body["applied"] is False
    assert body["entry"]["meaning"] is None
    assert body["entry"]["examples"] == []


async def test_an_ambiguous_pattern_asks_instead_of_choosing(ctx, monkeypatch):
    """ものだ is four points; picking one silently is the failure to avoid."""
    client, _, _ = ctx
    senses = ["general truth", "nostalgic recollection", "strong advice", "exclamation"]
    _stub(monkeypatch, _enriched(other_senses=senses, meaning="", examples=[]))
    entry_id = await _log(client, pattern="～ものだ")

    body = (await client.post(f"/api/grammar-entries/{entry_id}/enrich")).json()
    assert body["otherSenses"] == senses
    assert body["applied"] is False
    assert body["entry"]["meaning"] is None


async def test_a_named_sense_is_passed_through_to_the_model(ctx, monkeypatch):
    """Having answered which sense, the user should not be asked again."""
    client, _, _ = ctx
    fake = _stub(monkeypatch, _enriched())
    entry_id = await _log(client, pattern="～ものだ", senseLabel="strong advice")

    await client.post(f"/api/grammar-entries/{entry_id}/enrich")
    prompt = fake.calls[0]["messages"][0]["content"]
    assert "strong advice" in prompt
    assert "～ものだ" in prompt


async def test_the_learners_own_sentence_reaches_the_prompt_and_survives(ctx, monkeypatch):
    """It is the authority on sense and register, and it is not ours to replace."""
    client, _, _ = ctx
    fake = _stub(monkeypatch, _enriched())
    mine = "先生に聞いてからでないと決められません。"
    entry_id = await _log(
        client,
        examples=[{"japanese": mine, "isUserSupplied": True}],
        note="the negative trips me up",
        source="Quartet II, L5",
    )

    body = (await client.post(f"/api/grammar-entries/{entry_id}/enrich")).json()

    prompt = fake.calls[0]["messages"][0]["content"]
    assert mine in prompt
    assert "the negative trips me up" in prompt
    assert "Quartet II, L5" in prompt

    japanese = [e["japanese"] for e in body["entry"]["examples"]]
    assert mine in japanese
    assert len(japanese) == 3  # theirs plus the two generated
    assert japanese[0] == mine  # and it still sorts first


async def test_re_enriching_replaces_generated_sentences_but_not_yours(ctx, monkeypatch):
    """Otherwise every re-run stacks up near-duplicates of the last one."""
    client, _, _ = ctx
    mine = "先生に聞いてからでないと決められません。"
    entry_id = await _log(client, examples=[{"japanese": mine, "isUserSupplied": True}])

    _stub(monkeypatch, _enriched())
    await client.post(f"/api/grammar-entries/{entry_id}/enrich")

    _stub(monkeypatch, _enriched(examples=[
        {"japanese": "別の文。", "english": "A different sentence."}
    ]))
    body = (await client.post(f"/api/grammar-entries/{entry_id}/enrich")).json()

    japanese = [e["japanese"] for e in body["entry"]["examples"]]
    assert japanese == [mine, "別の文。"]


async def test_confirming_after_enrichment_is_the_ordinary_patch(ctx, monkeypatch):
    """Enrich then accept — the two halves of the reviewed-before-trusted rule."""
    client, _, _ = ctx
    _stub(monkeypatch, _enriched())
    entry_id = await _log(client)

    await client.post(f"/api/grammar-entries/{entry_id}/enrich")
    confirmed = await client.patch(
        f"/api/grammar-entries/{entry_id}", json={"enriched": True}
    )

    body = confirmed.json()
    assert body["enriched"] is True
    # Confirming did not disturb what enrichment wrote.
    assert body["formation"] == "Vて + からでないと + negative"


async def test_a_refusal_is_reported_not_swallowed(ctx, monkeypatch):
    """HTTP 200 with no parsed output; reading it first would raise something opaque."""
    client, _, _ = ctx
    _stub(monkeypatch, None, stop_reason="refusal")
    entry_id = await _log(client)

    response = await client.post(f"/api/grammar-entries/{entry_id}/enrich")
    assert response.status_code == 502


async def test_enriching_an_unknown_entry_is_a_404(ctx, monkeypatch):
    client, _, _ = ctx
    _stub(monkeypatch, _enriched())
    assert (await client.post("/api/grammar-entries/9999/enrich")).status_code == 404
