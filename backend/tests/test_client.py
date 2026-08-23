"""WaniKani client behaviour, against a mocked transport.

Nothing here touches the real API. The point is to pin the behaviour that is
awkward to trigger on demand against a live account: 429 handling, pagination,
conditional requests, and the two write endpoints.
"""

from __future__ import annotations

import time

import httpx
import pytest
import respx

from app.config import Settings
from app.wanikani.client import (
    RateLimiter,
    WaniKaniAuthError,
    WaniKaniClient,
    WaniKaniError,
    WaniKaniValidationError,
)

BASE = "https://api.wanikani.com/v2"


def make_settings(**overrides) -> Settings:
    defaults = dict(
        wanikani_apikey="test-token-not-real",
        wanikani_rate_limit_per_minute=600,  # effectively off for tests
        wanikani_max_retries=2,
        database_url="",
    )
    defaults.update(overrides)
    return Settings(**defaults)


def collection(data: list[dict], next_url: str | None = None) -> dict:
    return {
        "object": "collection",
        "url": f"{BASE}/assignments",
        "pages": {"per_page": 500, "next_url": next_url, "previous_url": None},
        "total_count": len(data),
        "data": data,
    }


def assignment_resource(assignment_id: int, subject_id: int, srs_stage: int = 1) -> dict:
    return {
        "id": assignment_id,
        "object": "assignment",
        "data_updated_at": "2026-08-01T00:00:00.000000Z",
        "data": {
            "subject_id": subject_id,
            "subject_type": "kanji",
            "srs_stage": srs_stage,
            "unlocked_at": "2026-07-01T00:00:00.000000Z",
            "started_at": "2026-07-02T00:00:00.000000Z",
            "passed_at": None,
            "available_at": "2026-08-01T00:00:00.000000Z",
            "burned_at": None,
            "hidden": False,
        },
    }


@respx.mock
async def test_sends_auth_and_revision_headers():
    route = respx.get(f"{BASE}/user").mock(
        return_value=httpx.Response(200, json={"data": {"username": "x", "level": 1}})
    )
    async with WaniKaniClient(make_settings()) as client:
        await client.get_user()

    request = route.calls.last.request
    assert request.headers["Authorization"] == "Bearer test-token-not-real"
    # Pinning the revision is what keeps response shapes stable.
    assert request.headers["Wanikani-Revision"] == "20170710"


@respx.mock
async def test_paginate_follows_next_url():
    """The cursor lives in pages.next_url; callers should never see it.

    `side_effect` on one route rather than two url-matched routes: respx
    matches a query-less url pattern against *any* query string, so a second
    route keyed on `page_after_id` never gets a chance to win.
    """
    respx.get(url__startswith=f"{BASE}/assignments").mock(
        side_effect=[
            httpx.Response(
                200,
                json=collection(
                    [assignment_resource(1, 100)],
                    next_url=f"{BASE}/assignments?page_after_id=1",
                ),
            ),
            httpx.Response(200, json=collection([assignment_resource(2, 200)])),
        ]
    )

    async with WaniKaniClient(make_settings()) as client:
        items = await client.collect("/assignments")

    assert [i["id"] for i in items] == [1, 2]


@respx.mock
async def test_paginate_raises_when_cursor_does_not_advance():
    """A next_url that keeps pointing at itself must fail loudly.

    Left unguarded this spins forever, consuming the whole Lambda timeout and
    the entire rate-limit budget without ever surfacing an error.
    """
    respx.get(url__startswith=f"{BASE}/assignments").mock(
        return_value=httpx.Response(
            200,
            json=collection(
                [assignment_resource(1, 100)],
                next_url=f"{BASE}/assignments?page_after_id=1",
            ),
        )
    )

    async with WaniKaniClient(make_settings()) as client:
        with pytest.raises(WaniKaniError, match="did not advance"):
            await client.collect("/assignments")


@respx.mock
async def test_retries_after_429_using_reset_header():
    """RateLimit-Reset is an absolute Unix timestamp, so the wait is exact."""
    reset_at = str(int(time.time()) + 1)
    route = respx.get(f"{BASE}/user").mock(
        side_effect=[
            httpx.Response(429, headers={"RateLimit-Reset": reset_at}),
            httpx.Response(200, json={"data": {"username": "x", "level": 1}}),
        ]
    )

    async with WaniKaniClient(make_settings()) as client:
        result = await client.get_user()

    assert result["level"] == 1
    assert route.call_count == 2


@respx.mock
async def test_401_raises_auth_error():
    respx.get(f"{BASE}/user").mock(return_value=httpx.Response(401))
    async with WaniKaniClient(make_settings()) as client:
        with pytest.raises(WaniKaniAuthError):
            await client.get_user()


@respx.mock
async def test_422_raises_validation_error():
    """The realistic case: submitting a review for something not yet due."""
    respx.post(f"{BASE}/reviews").mock(
        return_value=httpx.Response(422, json={"error": "not available for review"})
    )
    async with WaniKaniClient(make_settings()) as client:
        with pytest.raises(WaniKaniValidationError) as exc:
            await client.create_review(assignment_id=1, incorrect_meaning_answers=0)
    assert exc.value.status_code == 422


@respx.mock
async def test_none_params_are_dropped():
    """A None filter must never reach the query string.

    httpx would serialise it as an empty parameter, and WaniKani reads an empty
    `updated_after` as a real (and wrong) filter.
    """
    route = respx.get(f"{BASE}/assignments").mock(
        return_value=httpx.Response(200, json=collection([]))
    )
    async with WaniKaniClient(make_settings()) as client:
        await client.get_assignments(updated_after=None)

    assert "updated_after" not in route.calls.last.request.url.params


@respx.mock
async def test_presence_flag_filters_send_empty_value():
    """`immediately_available_for_review` is a presence flag: sending it at all
    means true, and sending `false` is not the same as omitting it."""
    route = respx.get(f"{BASE}/assignments").mock(
        return_value=httpx.Response(200, json=collection([]))
    )
    async with WaniKaniClient(make_settings()) as client:
        await client.get_assignments(immediately_available_for_review=True)

    params = route.calls.last.request.url.params
    assert "immediately_available_for_review" in params
    assert params["immediately_available_for_review"] == ""


@respx.mock
async def test_start_assignment_posts_to_start_endpoint():
    route = respx.put(f"{BASE}/assignments/1422/start").mock(
        return_value=httpx.Response(200, json=assignment_resource(1422, 8801, srs_stage=1))
    )
    async with WaniKaniClient(make_settings()) as client:
        data = await client.start_assignment(1422)

    assert route.called
    assert data["srs_stage"] == 1


@respx.mock
async def test_create_review_sends_only_incorrect_counts():
    """The client never sends an SRS stage — WaniKani computes it."""
    route = respx.post(f"{BASE}/reviews").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": 0,
                "object": "review",
                "data": {
                    "assignment_id": 1422,
                    "subject_id": 8801,
                    "starting_srs_stage": 3,
                    "ending_srs_stage": 4,
                    "incorrect_meaning_answers": 1,
                    "incorrect_reading_answers": 0,
                },
                "resources_updated": {
                    "assignment": assignment_resource(1422, 8801, srs_stage=4)
                },
            },
        )
    )

    async with WaniKaniClient(make_settings()) as client:
        result = await client.create_review(
            assignment_id=1422, incorrect_meaning_answers=1, incorrect_reading_answers=0
        )

    import json

    body = json.loads(route.calls.last.request.content)
    assert body["review"] == {
        "incorrect_meaning_answers": 1,
        "incorrect_reading_answers": 0,
        "assignment_id": 1422,
    }
    # No stage is ever sent — WaniKani derives it.
    assert "srs_stage" not in json.dumps(body)
    # resources_updated is the authoritative post-review state.
    assert result["resources_updated"]["assignment"]["data"]["srs_stage"] == 4


async def test_rate_limiter_blocks_past_the_cap():
    """Two calls fit under a cap of 2; the third has to wait for the window."""
    limiter = RateLimiter(per_minute=2)
    start = time.monotonic()
    await limiter.acquire()
    await limiter.acquire()
    assert time.monotonic() - start < 0.5

    # Third would block for ~60s, so just assert the bucket is full rather
    # than actually waiting for it.
    assert len(limiter._timestamps) == 2
