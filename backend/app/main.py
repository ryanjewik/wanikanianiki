"""FastAPI application.

Deliberately a plain ASGI app with no hosting-specific code in it: `uvicorn`
runs it locally, `lambda_handler.py` wraps it for Lambda, and a container image
runs it unchanged on Fargate or App Runner. The only thing that varies by
target is the database pooling strategy, which lives in `db/session.py`.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import require_api_key
from app.api.routes import router
from app.config import get_settings
from app.wanikani.client import WaniKaniAuthError, WaniKaniError, get_client

logger = logging.getLogger(__name__)


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Warm the process-level client, and tear it down only where that is safe.

    The client owns the rate limiter, so it must outlive the request — a
    per-request client would hand each request its own 60/min budget against a
    limit that is per token. `get_client()` is cached on the module, so the
    instance survives regardless of how often this function runs.

    **That last part matters under Lambda.** Mangum builds its `LifespanCycle`
    inside `__call__`, so startup *and shutdown* fire on every invocation, not
    once per container. Closing the client here would therefore close it after
    every request and reopen it on the next — which is the exact per-request
    client the rate limiter cannot tolerate. So teardown is skipped there, and
    the frozen container keeps its connections for the next invocation.

    Under uvicorn, where shutdown really does mean shutdown, both are closed
    properly.
    """
    settings = get_settings()
    configure_logging(settings.log_level)

    app.state.wanikani = get_client()
    try:
        yield
    finally:
        if not settings.is_lambda:
            await app.state.wanikani.aclose()
            get_client.cache_clear()
            if settings.has_database:
                from app.db.session import dispose_engine

                await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    local = settings.environment == "local"

    app = FastAPI(
        # The interactive docs map every route, and are served outside the
        # router the key protects. Useful on a laptop; a gift anywhere public.
        docs_url="/docs" if local else None,
        redoc_url="/redoc" if local else None,
        openapi_url="/openapi.json" if local else None,
        title="Kanji Workshop API",
        version="0.1.0",
        description=(
            "WaniKani-connected backend. The WaniKani token lives here and "
            "only here — clients never talk to WaniKani directly."
        ),
        lifespan=lifespan,
    )

    # The Expo dev client and the web build call this from other origins.
    # Tighten `allow_origins` before this is reachable from the internet.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.environment == "local" else [],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(WaniKaniAuthError)
    async def _auth_error(_: Request, exc: WaniKaniAuthError) -> JSONResponse:
        # Deliberately does not echo the token or any part of it.
        return JSONResponse(
            status_code=502,
            content={
                "detail": "WaniKani rejected the configured API token.",
                "hint": "Check WANIKANI_APIKEY; it may have been revoked or regenerated.",
            },
        )

    @app.exception_handler(WaniKaniError)
    async def _upstream_error(request: Request, exc: WaniKaniError) -> JSONResponse:
        # Logged with WaniKani's own status and body: before this, a refusal
        # (a 403, a 404) reached the phone as a bare 502 that it retried
        # forever, and nothing anywhere said what WaniKani had answered.
        logger.warning(
            "WaniKani failed for %s %s: %s (status %s) %s",
            request.method, request.url.path, exc, exc.status_code, exc.body,
        )
        # A 4xx from WaniKani is a refusal that retrying will not change, so the
        # phone is told so (409) and sets the write aside with this reason. A
        # 5xx, a rate limit or a timeout may pass, so those stay a 502 to retry.
        code = exc.status_code
        refused = code is not None and 400 <= code < 500 and code != 429
        what = "refused the request" if refused else "request failed"
        return JSONResponse(
            status_code=409 if refused else 502,
            content={
                "detail": f"WaniKani {what}: {exc}",
                "wanikaniStatus": exc.status_code,
                "wanikani": exc.body,
            },
        )

    app.include_router(router, dependencies=[Depends(require_api_key)])
    return app


app = create_app()
