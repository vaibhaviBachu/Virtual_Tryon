"""
AI Jewellery Assistant routes.

Deliberately public (no `require_admin`/`get_current_user` dependency anywhere in this
router) -- see apps/api/v1/services/jewellery_ai_service.py's module docstring for why.
Every AI-cost-incurring endpoint (image prep, regenerate, metadata) is rate-limited per
client IP via apps/api/core/rate_limit.py.
"""
import logging
from uuid import UUID

import redis
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from ai.jewellery_assistant.image_pipeline import ImagePreparationError
from ai.jewellery_assistant.providers.base import AIServiceError, AIServiceNotConfiguredError
from ai.preprocessing.image_validation import ImageValidationError
from apps.api.core.config import Settings, get_settings
from apps.api.core.rate_limit import RateLimitExceededError, enforce_rate_limit
from apps.api.core.redis_client import get_redis_client
from apps.api.db.session import get_db
from apps.api.storage.s3_storage import get_object_storage
from apps.api.v1.schemas.jewellery_ai import IntakeResponse, MetadataUpdateRequest, SubmitResponse
from apps.api.v1.services import category_service, jewellery_ai_service

logger = logging.getLogger("app.jewellery_ai")
router = APIRouter(prefix="/api/v1/jewellery-ai", tags=["jewellery-ai"])

SIGNED_URL_EXPIRY_SECONDS = 15 * 60


def _intake_response(intake) -> IntakeResponse:
    storage = get_object_storage()
    from datetime import timedelta

    original_url = (
        storage.create_signed_url(intake.original_storage_key, expires_in=timedelta(seconds=SIGNED_URL_EXPIRY_SECONDS))
        if intake.original_storage_key
        else None
    )
    prepared_url = (
        storage.create_signed_url(intake.thumbnail_storage_key, expires_in=timedelta(seconds=SIGNED_URL_EXPIRY_SECONDS))
        if intake.thumbnail_storage_key
        else None
    )
    return IntakeResponse.model_validate(intake).model_copy(
        update={"original_preview_url": original_url, "prepared_preview_url": prepared_url}
    )


def _client_key(request: Request, suffix: str) -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"ratelimit:jewellery_ai:{suffix}:{client_host}"


def _enforce_rate_limit(
    request: Request, redis_client: redis.Redis, settings: Settings, *, bucket: str
) -> None:
    try:
        enforce_rate_limit(
            redis_client, _client_key(request, bucket), limit=settings.AI_RATE_LIMIT_PER_HOUR, window_seconds=3600
        )
    except RateLimitExceededError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You've made too many AI assistant requests. Please try again in a bit.",
        )


@router.post("/sessions", response_model=IntakeResponse, status_code=status.HTTP_201_CREATED)
def create_session(db: Session = Depends(get_db)) -> IntakeResponse:
    intake = jewellery_ai_service.create_session(db)
    return _intake_response(intake)


@router.get("/sessions/{session_id}", response_model=IntakeResponse)
def get_session(session_id: UUID, db: Session = Depends(get_db)) -> IntakeResponse:
    try:
        intake = jewellery_ai_service.get_session(db, session_id)
    except jewellery_ai_service.IntakeNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    return _intake_response(intake)


@router.post("/sessions/{session_id}/image", response_model=IntakeResponse)
async def upload_image(
    session_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    redis_client: redis.Redis = Depends(get_redis_client),
    settings: Settings = Depends(get_settings),
) -> IntakeResponse:
    _enforce_rate_limit(request, redis_client, settings, bucket="image")

    raw_bytes = await file.read()
    max_bytes = settings.AI_MAX_UPLOAD_MB * 1024 * 1024
    if len(raw_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File is too large. Maximum allowed size is {settings.AI_MAX_UPLOAD_MB} MB.",
        )

    try:
        intake = jewellery_ai_service.process_image(
            db, session_id, raw_bytes, image_provider=jewellery_ai_service.build_image_provider(settings)
        )
    except jewellery_ai_service.IntakeNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    except ImageValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except ImagePreparationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return _intake_response(intake)


@router.post("/sessions/{session_id}/regenerate", response_model=IntakeResponse)
def regenerate_image(
    session_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    redis_client: redis.Redis = Depends(get_redis_client),
    settings: Settings = Depends(get_settings),
) -> IntakeResponse:
    _enforce_rate_limit(request, redis_client, settings, bucket="regenerate")
    try:
        intake = jewellery_ai_service.regenerate_image(
            db,
            session_id,
            image_provider=jewellery_ai_service.build_image_provider(settings),
            max_attempts=settings.AI_MAX_GENERATIONS_PER_ITEM,
        )
    except jewellery_ai_service.IntakeNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    except jewellery_ai_service.MissingRequiredFieldError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except AIServiceNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except AIServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    return _intake_response(intake)


@router.post("/sessions/{session_id}/metadata", response_model=IntakeResponse)
def suggest_metadata(
    session_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    redis_client: redis.Redis = Depends(get_redis_client),
    settings: Settings = Depends(get_settings),
) -> IntakeResponse:
    _enforce_rate_limit(request, redis_client, settings, bucket="metadata")
    category_slugs = [c.slug for c, _count in category_service.list_categories(db, is_active=True)]
    try:
        intake = jewellery_ai_service.suggest_metadata(
            db,
            session_id,
            metadata_provider=jewellery_ai_service.build_metadata_provider(settings),
            category_slugs=category_slugs,
        )
    except jewellery_ai_service.IntakeNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    except jewellery_ai_service.MissingRequiredFieldError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except AIServiceNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except AIServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    return _intake_response(intake)


@router.patch("/sessions/{session_id}", response_model=IntakeResponse)
def update_metadata(
    session_id: UUID, payload: MetadataUpdateRequest, db: Session = Depends(get_db)
) -> IntakeResponse:
    try:
        intake = jewellery_ai_service.update_user_metadata(
            db, session_id, payload.model_dump(exclude_unset=True)
        )
    except jewellery_ai_service.IntakeNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    return _intake_response(intake)


@router.post("/sessions/{session_id}/submit", response_model=SubmitResponse)
def submit(
    session_id: UUID,
    db: Session = Depends(get_db),
    redis_client: redis.Redis = Depends(get_redis_client),
) -> SubmitResponse:
    try:
        intake = jewellery_ai_service.submit(db, redis_client, session_id)
    except jewellery_ai_service.IntakeNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    except jewellery_ai_service.MissingRequiredFieldError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except jewellery_ai_service.InvalidCategoryError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category.")
    return SubmitResponse(intake=_intake_response(intake), jewellery_id=intake.jewellery_id)
