"""
/health  -> liveness only. Must NEVER depend on Postgres/Redis/object storage: a
            container manager uses this to decide whether to restart the process, and a
            slow/unreachable dependency must not look like a crashed process.
/ready   -> readiness. Verifies every external dependency the API needs and returns
            HTTP 503 if any of them is unavailable, per docs/production-readiness.md.
"""
import logging

from fastapi import APIRouter, Response, status

from apps.api.core.config import get_settings
from apps.api.core.redis_client import check_redis_connection
from apps.api.db.session import check_database_connection
from apps.api.storage.s3_storage import get_object_storage
from apps.api.v1.schemas.health import HealthResponse, ReadinessResponse

logger = logging.getLogger("app.health")
router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="alive", service=settings.APP_NAME)


@router.get("/ready", response_model=ReadinessResponse)
def ready(response: Response) -> ReadinessResponse:
    database_ok = check_database_connection()
    redis_ok = check_redis_connection()

    try:
        object_storage_ok = get_object_storage().ping()
    except Exception:
        logger.warning("Object storage client could not be constructed", exc_info=True)
        object_storage_ok = False

    checks = {
        "database": database_ok,
        "redis": redis_ok,
        "object_storage": object_storage_ok,
    }
    all_ok = all(checks.values())
    response.status_code = status.HTTP_200_OK if all_ok else status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(status="ready" if all_ok else "not_ready", checks=checks)
