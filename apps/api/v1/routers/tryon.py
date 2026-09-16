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
from apps.api.core.config import get_settings
from apps.api.core.redis_client import get_redis_client
from apps.api.db.session import get_db
from apps.api.v1.schemas.tryon import (
    CategoryOptionResponse,
    LandmarksResponse,
    SegmentationResponse,
    SessionCreateRequest,
    SessionResponse,
    TryOnRenderCreateRequest,
    TryOnRenderDebugResponse,
    TryOnRenderResponse,
    TryOnRequestCreateRequest,
    TryOnRequestResponse,
    UserImageResponse,
)
from apps.api.v1.services import tryon_service
from db.models import TryOnRender, User

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


# --- Milestone 4: geometry try-on rendering ---


@router.get("/categories", response_model=list[CategoryOptionResponse])
def list_categories(db: Session = Depends(get_db)) -> list[CategoryOptionResponse]:
    """Spec §26: real backend category data with a `functional` flag — the frontend
    must never hard-code which categories can actually render."""
    return [CategoryOptionResponse(**c) for c in tryon_service.list_functional_categories(db)]


def _to_render_response(render: TryOnRender) -> TryOnRenderResponse:
    return TryOnRenderResponse(
        id=render.id,
        request_id=render.request_id,
        jewellery_id=render.jewellery_id,
        asset_id=render.asset_id,
        category_slug=render.category_slug,
        status=render.status.value if hasattr(render.status, "value") else render.status,
        error_code=render.error_code,
        error_message=render.error_message,
        result_image_url=tryon_service.get_render_result_url(render),
        created_at=render.created_at,
        queued_at=render.queued_at,
        started_at=render.started_at,
        completed_at=render.completed_at,
    )


@router.post(
    "/requests/{request_id}/render",
    response_model=TryOnRenderResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_render(
    request_id: UUID,
    payload: TryOnRenderCreateRequest,
    db: Session = Depends(get_db),
    redis_client: redis.Redis = Depends(get_redis_client),
    current_user: User | None = Depends(get_current_user_optional),
) -> TryOnRenderResponse:
    """Spec §22-23: validate -> enqueue -> return render status. All geometry
    calculation happens in the worker/ai layer, never here (spec §3)."""
    try:
        render = tryon_service.create_render(
            db, redis_client, request_id, payload.jewellery_id, payload.asset_id, current_user
        )
    except tryon_service.TryOnRequestNotFoundError:
        raise _not_found("Try-on request not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this request.")
    except tryon_service.JewelleryNotFoundError:
        raise _not_found("Jewellery item not found.")
    except tryon_service.RenderAssetNotFoundError:
        raise _not_found("Jewellery asset not found for this item.")
    return _to_render_response(render)


@router.get("/renders/{render_id}", response_model=TryOnRenderResponse)
def get_render(
    render_id: UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TryOnRenderResponse:
    try:
        render = tryon_service.get_render(db, render_id, current_user)
    except tryon_service.RenderNotFoundError:
        raise _not_found("Render not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this render.")
    return _to_render_response(render)


@router.get("/renders/{render_id}/debug", response_model=TryOnRenderDebugResponse)
def get_render_debug(
    render_id: UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> TryOnRenderDebugResponse:
    """Internal/developer-only placement visualization (spec §27) — gated by
    Settings.ENABLE_TRYON_DEBUG_VIZ so it can be disabled entirely in a real production
    deployment without touching this route's code. Deliberately returns 404 (not 403)
    when disabled, so its existence isn't distinguishable from "no such render" to a
    normal customer probing the API."""
    if not get_settings().ENABLE_TRYON_DEBUG_VIZ:
        raise _not_found("Not found.")
    try:
        render = tryon_service.get_render(db, render_id, current_user)
    except tryon_service.RenderNotFoundError:
        raise _not_found("Not found.")
    except tryon_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this render.")
    return TryOnRenderDebugResponse(
        placement_metadata=render.placement_metadata,
        debug_image_url=tryon_service.get_render_debug_url(render),
    )
