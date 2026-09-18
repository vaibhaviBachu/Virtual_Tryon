"""
FastAPI application factory.

Milestone 1: app wiring, health/readiness, logging, error handling, CORS.
Milestone 2 adds: auth (login/me) and the catalogue routers (categories, jewellery,
assets). No try-on routers exist yet — see docs/roadmap.md Milestone 4+.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.core.config import get_settings
from apps.api.core.logging import configure_logging
from apps.api.core.middleware import RequestIDMiddleware, register_exception_handlers
from apps.api.v1.routers import auth, catalog, health, live_ar, tryon

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
    app.include_router(auth.router)
    app.include_router(catalog.router)
    app.include_router(tryon.router)
    # Milestone 4+: jewellery placement/rendering endpoints (not this router — this one
    # is user-image understanding only, per Milestone 3's explicit scope boundary).
    app.include_router(live_ar.router)

    return app


app = create_app()
