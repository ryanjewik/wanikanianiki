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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.config import get_settings
from app.wanikani.client import WaniKaniAuthError, WaniKaniClient, WaniKaniError


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build the shared WaniKani client once per process.

    Sharing it is not just an optimisation: the client owns the rate limiter,
    and a per-request client would hand each request its own 60/min budget,
    which is exactly how you get 429s.
    """
    settings = get_settings()
    configure_logging(settings.log_level)

    app.state.wanikani = WaniKaniClient(settings)
    try:
        yield
    finally:
        await app.state.wanikani.aclose()
        if settings.has_database:
            from app.db.session import dispose_engine

            await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
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
    async def _upstream_error(_: Request, exc: WaniKaniError) -> JSONResponse:
        return JSONResponse(
            status_code=502,
            content={"detail": "Upstream WaniKani request failed", "error": str(exc)},
        )

    app.include_router(router)
    return app


app = create_app()
