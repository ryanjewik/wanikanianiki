"""Lambda entry points.

Two handlers, deployed as two functions off the same image or zip:

* `handler` — the HTTP API, behind a Function URL or API Gateway HTTP API.
* `sync_handler` — the scheduled poll, triggered by EventBridge.

**Set reserved concurrency to 1 on the sync function.** WaniKani's 60/min cap
is per token, so two overlapping sync runs cannot go faster — they can only
collide and produce 429s. The rate limiter in the client is process-local and
assumes it is the only one running.
"""

from __future__ import annotations

import asyncio
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

    async with WaniKaniClient() as client:
        try:
            async with session_scope() as session:
                result = await sync_all(session, client)
            return result.model_dump(mode="json", by_alias=True)
        finally:
            # Under NullPool this is cheap, and it keeps a frozen container
            # from holding a socket the database has already dropped.
            await dispose_engine()
