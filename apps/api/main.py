"""
FastAPI application factory.

Milestone 1 scope: app wiring, health/readiness, logging, error handling, CORS.
No jewellery/catalogue/try-on routers exist yet — see docs/roadmap.md Milestone 2+.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.core.config import get_settings
from apps.api.core.logging import configure_logging
from apps.api.core.middleware import RequestIDMiddleware, register_exception_handlers
from apps.api.v1.routers import health

settings = get_settings()
configure_logging(settings.LOG_LEVEL)
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "API starting",
        extra={"extra_fields": {"environment": settings.ENVIRONMENT}},
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        description="Jewellery Virtual Try-On Platform API — Milestone 1 (platform foundation).",
        lifespan=lifespan,
    )

    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)

    app.include_router(health.router)
    # Milestone 2+: app.include_router(catalog.router, prefix="/api/v1")
    # Milestone 3+: app.include_router(uploads.router, prefix="/api/v1")
    # Milestone 4+: app.include_router(tryon.router, prefix="/api/v1")

    return app


app = create_app()
