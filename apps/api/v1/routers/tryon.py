"""
Try-on (user image pipeline) API routes — Milestone 3 spec's endpoint list, exactly:
POST /sessions, POST /sessions/{id}/image, POST /requests, GET /requests/{id},
GET /requests/{id}/landmarks, GET /requests/{id}/segmentation.

Guest sessions work with no auth header at all (see auth_deps.get_current_user_optional
and tryon_service's authorization model docstring). An authenticated customer may also
use these routes; their session is then tied to their account and only they may access
it afterward.

No AI/CV import anywhere in this file — validation, persistence, and job enqueueing
only, per docs/development.md's central architecture rule.
"""
import logging
from uuid import UUID

import redis
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from ai.preprocessing.image_validation import ImageValidationError
from apps.api.core.auth_deps import get_current_user_optional
from apps.api.core.redis_client import get_redis_client
from apps.api.db.session import get_db
from apps.api.v1.schemas.tryon import (
    LandmarksResponse,
    SegmentationResponse,
    SessionCreateRequest,
    SessionResponse,
    TryOnRequestCreateRequest,
    TryOnRequestResponse,
    UserImageResponse,
)
from apps.api.v1.services import tryon_service
from db.models import User

logger = logging.getLogger("app.tryon_router")
router = APIRouter(prefix="/api/v1/tryon", tags=["tryon"])


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SessionResponse:
    session = tryon_service.create_session(db, current_user, payload.device_info)
    return SessionResponse.model_validate(session)


@router.post(
    "/sessions/{session_id}/image",
    response_model=UserImageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_session_image(
    session_id: UUID,
    file: UploadFile = File(...),
    capture_source: str = Query(default="upload", pattern="^(camera|upload)$"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> UserImageResponse:
    raw_bytes = await file.read()
    try:
        image = tryon_service.upload_session_image(db, session_id, current_user, raw_bytes, capture_source)
    except tryon_service.SessionNotFoundError:
        raise _not_found("Session not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this session.")
    except ImageValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return UserImageResponse.model_validate(image)


@router.post("/requests", response_model=TryOnRequestResponse, status_code=status.HTTP_202_ACCEPTED)
def create_request(
    payload: TryOnRequestCreateRequest,
    db: Session = Depends(get_db),
    redis_client: redis.Redis = Depends(get_redis_client),
    current_user: User | None = Depends(get_current_user_optional),
) -> TryOnRequestResponse:
    try:
        request = tryon_service.create_tryon_request(
            db, redis_client, payload.session_id, payload.user_image_id, current_user
        )
    except tryon_service.SessionNotFoundError:
        raise _not_found("Session not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this session.")
    except tryon_service.UserImageNotFoundError:
        raise _not_found("User image not found for this session.")
    return TryOnRequestResponse.model_validate(request)


@router.get("/requests/{request_id}", response_model=TryOnRequestResponse)
def get_request(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TryOnRequestResponse:
    try:
        request = tryon_service.get_tryon_request(db, request_id, current_user)
    except tryon_service.TryOnRequestNotFoundError:
        raise _not_found("Try-on request not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this request.")
    return TryOnRequestResponse.model_validate(request)


@router.get("/requests/{request_id}/landmarks", response_model=LandmarksResponse)
def get_landmarks(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> LandmarksResponse:
    try:
        request = tryon_service.get_tryon_request(db, request_id, current_user)
    except tryon_service.TryOnRequestNotFoundError:
        raise _not_found("Try-on request not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this request.")
    return LandmarksResponse(
        face_landmarks=request.face_landmarks,
        hand_landmarks=request.hand_landmarks,
        pose_landmarks=request.pose_landmarks,
    )


@router.get("/requests/{request_id}/segmentation", response_model=SegmentationResponse)
def get_segmentation(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SegmentationResponse:
    try:
        request = tryon_service.get_tryon_request(db, request_id, current_user)
    except tryon_service.TryOnRequestNotFoundError:
        raise _not_found("Try-on request not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this request.")
    preview_url = tryon_service.get_segmentation_preview_url(request)
    return SegmentationResponse(segmentation_summary=request.segmentation_summary, mask_preview_url=preview_url)
