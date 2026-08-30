"""Lambda entry points.

Three handlers, deployed as separate functions off the same image or zip:

* `handler` — the HTTP API, behind a Function URL or API Gateway HTTP API.
* `sync_handler` — the scheduled poll, triggered by EventBridge.
* `ocr_handler` — page extraction, triggered by SQS.

One artifact, several entry points. Each function gets its own memory, timeout
and concurrency, which is the only reason they are separate at all: `ocr_handler`
needs minutes where `handler` needs milliseconds. They share every line of
`app/`, so a schema change ships to all of them at once.

**Set reserved concurrency to 1 on the sync function.** WaniKani's 60/min cap
is per token, so two overlapping sync runs cannot go faster — they can only
collide and produce 429s. The rate limiter in the client is process-local and
assumes it is the only one running.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from mangum import Mangum

from app.config import get_settings
from app.main import app, configure_logging

# Mangum translates API Gateway / Function URL events into ASGI scope.
# `lifespan="auto"` runs the app's lifespan on cold start, which is what builds
# the shared WaniKani client.
handler = Mangum(app, lifespan="auto")

logger = logging.getLogger(__name__)


def sync_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """EventBridge target. Runs one sync pass and reports what moved.

    Every 15–60 minutes is plenty — lessons unlock and levels change far more
    slowly than that, and the client already forces a pass on app open, which
    is when staleness is actually visible to a person.
    """
    settings = get_settings()
    configure_logging(settings.log_level)

    if not settings.has_database:
        logger.error("Sync invoked with no DATABASE_URL configured")
        return {"ok": False, "detail": "No database configured"}

    return asyncio.run(_run_sync())


async def _run_sync() -> dict[str, Any]:
    from app.db.session import dispose_engine, session_scope
    from app.services.sync import sync_all
    from app.wanikani.client import WaniKaniClient

    # Builds its own client rather than sharing `get_client()`, deliberately:
    # `async with` closes what it opens, and closing the process-level client
    # would leave the HTTP handler in this container holding a dead transport.
    # Nothing is lost by not sharing — this function is reserved-concurrency 1
    # and runs on a schedule far longer than the limiter's one-minute window.
    async with WaniKaniClient() as client:
        try:
            async with session_scope() as session:
                result = await sync_all(session, client)
            return result.model_dump(mode="json", by_alias=True)
        finally:
            # Under NullPool this is cheap, and it keeps a frozen container
            # from holding a socket the database has already dropped.
            await dispose_engine()


def ocr_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """SQS target. Extracts each queued page photo.

    The same `process_source` the HTTP background task calls — this handler is
    only a different way of being woken.

    **Blocked on durable image storage.** The photo is currently buffered in
    the process that received the upload, so a message picked up by a *different*
    function cannot reach the bytes; `process_source` will mark the row failed
    rather than pretend. Wiring this up means giving `services/storage.py` a
    real backend first — Supabase Storage or a `bytea` column, not S3 — and
    populating `vocab_sources.image_uri`. Until then the in-process background
    task is the only working path, which is fine: one function serves both.

    Failures are recorded on the row, not raised. Letting the exception escape
    would return the message to the queue and re-run a vision call that already
    failed for a reason a retry will not change (an unreadable photo, a rejected
    image). The client learns about it by polling and seeing `failed`.
    """
    settings = get_settings()
    configure_logging(settings.log_level)

    if not settings.has_database:
        logger.error("OCR invoked with no DATABASE_URL configured")
        return {"ok": False, "detail": "No database configured"}

    source_ids: list[int] = []
    for record in event.get("Records", []):
        try:
            source_ids.append(int(json.loads(record["body"])["sourceId"]))
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("Skipping malformed OCR message: %s", exc)

    if not source_ids:
        return {"ok": True, "processed": 0}

    return asyncio.run(_run_ocr(source_ids))


async def _run_ocr(source_ids: list[int]) -> dict[str, Any]:
    from app.db.session import dispose_engine, session_scope
    from app.services.ocr import process_source

    try:
        for source_id in source_ids:
            # A session each, so one bad page cannot roll back the others.
            async with session_scope() as session:
                await process_source(session, source_id)
        return {"ok": True, "processed": len(source_ids)}
    finally:
        await dispose_engine()
