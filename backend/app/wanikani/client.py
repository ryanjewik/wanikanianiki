"""WaniKani API v2 client.

This is the only module that holds the token and the only one that talks to
wanikani.com. Everything it has to get right:

* **Auth and revision.** Every request carries `Authorization: Bearer <token>`
  and `Wanikani-Revision`. The revision is date-versioned and pinned in config —
  it is what keeps response shapes stable.

* **Rate limiting.** The documented cap is 60 requests/minute *per token*, so
  concurrency cannot buy throughput — it can only cause 429s. Requests are
  serialised through a token bucket rather than fired in parallel.

* **429 handling.** WaniKani returns `RateLimit-Reset` as a Unix timestamp;
  the client sleeps until exactly then rather than guessing a backoff.

* **Conditional requests.** Collections support `ETag`/`If-None-Match` and
  return 304 when nothing changed. A 304 costs no rate-limit budget worth
  worrying about and no parsing, which matters for a poll that mostly finds
  nothing new.

* **Pagination.** Collections are cursor-based via `pages.next_url`. Callers get
  an async iterator and never see a cursor.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Iterable, Mapping
from typing import Any

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class WaniKaniError(RuntimeError):
    """Any non-recoverable failure talking to WaniKani."""

    def __init__(self, message: str, *, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class WaniKaniAuthError(WaniKaniError):
    """401 — the token is missing, malformed, or revoked."""


class WaniKaniValidationError(WaniKaniError):
    """422 — the request was well-formed but WaniKani refused it.

    Most often on `POST /reviews`: the assignment is not actually available for
    review yet, or `created_at` predates `available_at`.
    """


class RateLimiter:
    """Token bucket, sized to a rolling one-minute window.

    Deliberately process-local. One sync worker with reserved concurrency 1 is
    the intended deployment, so a shared/distributed limiter would be solving a
    problem the architecture already prevents.
    """

    def __init__(self, per_minute: int):
        self._per_minute = per_minute
        self._timestamps: list[float] = []
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                # Drop anything that has aged out of the window.
                self._timestamps = [t for t in self._timestamps if now - t < 60.0]

                if len(self._timestamps) < self._per_minute:
                    self._timestamps.append(now)
                    return

                # Wait just past the oldest call's expiry.
                sleep_for = 60.0 - (now - self._timestamps[0]) + 0.05
                logger.debug("Rate limit reached, sleeping %.2fs", sleep_for)
                await asyncio.sleep(sleep_for)


class WaniKaniClient:
    """Async client. Use as a context manager, or via `lifespan` in main.py."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        client: httpx.AsyncClient | None = None,
    ):
        self._settings = settings or get_settings()
        self._limiter = RateLimiter(self._settings.wanikani_rate_limit_per_minute)
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self._settings.wanikani_base_url,
            timeout=httpx.Timeout(self._settings.wanikani_timeout_seconds),
            headers=self._headers(),
        )

    def _headers(self) -> dict[str, str]:
        token = self._settings.wanikani_apikey.get_secret_value()
        return {
            "Authorization": f"Bearer {token}",
            "Wanikani-Revision": self._settings.wanikani_revision,
            "Accept": "application/json",
        }

    async def __aenter__(self) -> WaniKaniClient:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # -- core request ------------------------------------------------------

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Mapping[str, Any] | None = None,
        etag: str | None = None,
    ) -> httpx.Response:
        """One HTTP call, rate-limited and retried.

        Returns the raw response so callers can distinguish 304 from 200.
        Raises on 401/422 and on exhausted retries.
        """
        headers: dict[str, str] = {}
        if etag:
            headers["If-None-Match"] = etag

        attempt = 0
        while True:
            attempt += 1
            await self._limiter.acquire()

            try:
                response = await self._client.request(
                    method,
                    path,
                    params=_clean_params(params),
                    json=json,
                    headers=headers or None,
                )
            except httpx.TimeoutException as exc:
                if attempt > self._settings.wanikani_max_retries:
                    raise WaniKaniError(f"WaniKani timed out after {attempt} attempts") from exc
                await asyncio.sleep(_backoff(attempt))
                continue
            except httpx.HTTPError as exc:
                if attempt > self._settings.wanikani_max_retries:
                    raise WaniKaniError(f"WaniKani request failed: {exc}") from exc
                await asyncio.sleep(_backoff(attempt))
                continue

            # Nothing changed since the caller's ETag.
            if response.status_code == 304:
                return response

            if response.status_code == 429:
                wait = _reset_delay(response)
                if attempt > self._settings.wanikani_max_retries:
                    raise WaniKaniError("WaniKani rate limit exceeded", status_code=429)
                logger.warning("429 from WaniKani, waiting %.1fs before retry", wait)
                await asyncio.sleep(wait)
                continue

            if response.status_code == 401:
                raise WaniKaniAuthError(
                    "WaniKani rejected the API token (401)", status_code=401
                )

            if response.status_code == 422:
                raise WaniKaniValidationError(
                    "WaniKani rejected the request (422)",
                    status_code=422,
                    body=_safe_json(response),
                )

            # 5xx is worth retrying; other 4xx is a bug on our side.
            if response.status_code >= 500:
                if attempt > self._settings.wanikani_max_retries:
                    raise WaniKaniError(
                        f"WaniKani server error {response.status_code}",
                        status_code=response.status_code,
                    )
                await asyncio.sleep(_backoff(attempt))
                continue

            if response.status_code >= 400:
                raise WaniKaniError(
                    f"WaniKani returned {response.status_code} for {method} {path}",
                    status_code=response.status_code,
                    body=_safe_json(response),
                )

            return response

    async def get_json(
        self, path: str, *, params: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        response = await self.request("GET", path, params=params)
        return response.json()

    # -- pagination --------------------------------------------------------

    # A hard ceiling on pages followed. At 500 records per page this is far
    # past any real account, and it bounds the damage if a cursor misbehaves.
    MAX_PAGES = 200

    async def paginate(
        self, path: str, *, params: Mapping[str, Any] | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Yields every resource across every page.

        WaniKani's cursor lives in `pages.next_url`, an absolute URL with the
        cursor already applied — following it verbatim is both simpler and less
        error-prone than reconstructing `page_after_id` ourselves.

        Guarded against a cursor that fails to advance. A `next_url` that
        repeats, or one that keeps pointing at a page we have already fetched,
        would otherwise loop forever — burning the whole Lambda timeout and the
        entire rate-limit budget without ever failing loudly.
        """
        response = await self.request("GET", path, params=params)
        payload = response.json()

        seen_urls: set[str] = set()
        pages = 0

        while True:
            for resource in payload.get("data", []):
                yield resource

            next_url = (payload.get("pages") or {}).get("next_url")
            if not next_url:
                return

            if next_url in seen_urls:
                raise WaniKaniError(
                    f"Pagination cursor did not advance (repeated {next_url})"
                )
            seen_urls.add(next_url)

            pages += 1
            if pages >= self.MAX_PAGES:
                raise WaniKaniError(
                    f"Pagination exceeded {self.MAX_PAGES} pages for {path}; "
                    "refusing to keep following the cursor"
                )

            response = await self.request("GET", next_url)
            payload = response.json()

    async def collect(
        self, path: str, *, params: Mapping[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        return [item async for item in self.paginate(path, params=params)]

    # -- endpoints ---------------------------------------------------------

    async def get_user(self) -> dict[str, Any]:
        """`GET /user` — level, subscription, preferences.

        `subscription.max_level_granted` matters: on a free account it is 3, and
        content above it is invisible regardless of level.
        """
        payload = await self.get_json("/user")
        return payload["data"]

    async def get_summary(self) -> dict[str, Any]:
        """`GET /summary` — the cheap "what's due right now" report.

        One call instead of paging all of `/assignments`. `reviews` is a 24-hour
        forecast: element 0 is available now, the rest are future hourly slots.
        """
        payload = await self.get_json("/summary")
        return payload["data"]

    async def get_assignments(
        self,
        *,
        updated_after: str | None = None,
        immediately_available_for_lessons: bool | None = None,
        immediately_available_for_review: bool | None = None,
        subject_ids: Iterable[int] | None = None,
        levels: Iterable[int] | None = None,
        started: bool | None = None,
        hidden: bool | None = None,
    ) -> list[dict[str, Any]]:
        """`GET /assignments`.

        `updated_after` is the important one — it turns each poll into a cheap
        diff instead of re-pulling every assignment on the account.
        """
        params: dict[str, Any] = {
            "updated_after": updated_after,
            "subject_ids": _csv(subject_ids),
            "levels": _csv(levels),
            "started": started,
            "hidden": hidden,
        }
        # These two are presence-flags: WaniKani treats the bare parameter as
        # true, and sending `false` is not the same as omitting it.
        if immediately_available_for_lessons:
            params["immediately_available_for_lessons"] = ""
        if immediately_available_for_review:
            params["immediately_available_for_review"] = ""

        return await self.collect("/assignments", params=params)

    async def get_subjects(
        self,
        *,
        ids: Iterable[int] | None = None,
        types: Iterable[str] | None = None,
        levels: Iterable[int] | None = None,
        updated_after: str | None = None,
    ) -> list[dict[str, Any]]:
        """`GET /subjects` — the content itself.

        Subject content essentially never changes, so this should be pulled once
        and cached, not refetched per lesson batch.
        """
        return await self.collect(
            "/subjects",
            params={
                "ids": _csv(ids),
                "types": _csv(types),
                "levels": _csv(levels),
                "updated_after": updated_after,
            },
        )

    async def get_review_statistics(
        self, *, subject_ids: Iterable[int] | None = None, updated_after: str | None = None
    ) -> list[dict[str, Any]]:
        return await self.collect(
            "/review_statistics",
            params={"subject_ids": _csv(subject_ids), "updated_after": updated_after},
        )

    async def get_level_progressions(self) -> list[dict[str, Any]]:
        """`GET /level_progressions` — the raw timeline.

        WaniKani does not compute "days at level" or "average level pace"; those
        are derived from these timestamps.
        """
        return await self.collect("/level_progressions")

    # -- writes ------------------------------------------------------------
    # The only two calls in the whole API that change state upstream.

    async def start_assignment(
        self, assignment_id: int, *, started_at: str | None = None
    ) -> dict[str, Any]:
        """`PUT /assignments/{id}/start` — moves a lesson into the SRS.

        Requires `srs_stage == 0` and a level within the user's subscription,
        so a stale queue produces a 422 rather than silent success.
        """
        body = {"assignment": {"started_at": started_at}} if started_at else None
        response = await self.request("PUT", f"/assignments/{assignment_id}/start", json=body)
        return response.json()["data"]

    async def create_review(
        self,
        *,
        assignment_id: int | None = None,
        subject_id: int | None = None,
        incorrect_meaning_answers: int = 0,
        incorrect_reading_answers: int = 0,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        """`POST /reviews` — submit one answered item.

        Only the *incorrect* counts go up; WaniKani computes the resulting SRS
        stage itself, so a client never sends a stage.

        The response carries `resources_updated` with the freshly recomputed
        assignment and review statistic. Using that directly is what lets the
        caller update local state without a follow-up poll — and it is the only
        authoritative source for the real next-review time.
        """
        if assignment_id is None and subject_id is None:
            raise ValueError("create_review needs assignment_id or subject_id")

        review: dict[str, Any] = {
            "incorrect_meaning_answers": incorrect_meaning_answers,
            "incorrect_reading_answers": incorrect_reading_answers,
        }
        if assignment_id is not None:
            review["assignment_id"] = assignment_id
        if subject_id is not None:
            review["subject_id"] = subject_id
        if created_at is not None:
            review["created_at"] = created_at

        response = await self.request("POST", "/reviews", json={"review": review})
        return response.json()


# -- helpers ---------------------------------------------------------------


def _clean_params(params: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Drops None values so they never reach the query string.

    httpx would otherwise serialise `None` as an empty parameter, which
    WaniKani reads as a real (and usually wrong) filter.
    """
    if not params:
        return None
    cleaned = {k: v for k, v in params.items() if v is not None}
    return cleaned or None


def _csv(values: Iterable[Any] | None) -> str | None:
    """WaniKani takes array filters as comma-separated values."""
    if values is None:
        return None
    joined = ",".join(str(v) for v in values)
    return joined or None


def _backoff(attempt: int) -> float:
    """Exponential, capped. Deliberately no jitter — a single serialised
    worker has nobody to collide with."""
    return min(2.0**attempt, 30.0)


def _reset_delay(response: httpx.Response, *, default: float = 60.0) -> float:
    """Seconds until the rate-limit window resets.

    `RateLimit-Reset` is an absolute Unix timestamp, so this is exact rather
    than a guess. Falls back to a full minute if the header is missing.
    """
    raw = response.headers.get("RateLimit-Reset")
    if not raw:
        return default
    try:
        return max(1.0, float(raw) - time.time()) + 0.5
    except ValueError:
        return default


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text[:500]
