"""
Live AR API routes — Milestone 5. Exactly the two endpoints the spec authorizes for
the live loop's own persisted data: POST a captured result, GET it back with a signed
URL. No per-frame endpoint exists here or anywhere in this codebase. Session creation
reuses the existing POST /api/v1/tryon/sessions endpoint unchanged (spec: "reuse
existing try-on sessions where possible") -- there is deliberately no
POST /api/v1/live-ar/sessions.

No AI/CV import anywhere in this file, same rule as apps/api/v1/routers/tryon.py.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from ai.preprocessing.image_validation import ImageValidationError
from apps.api.core.auth_deps import get_current_user_optional
from apps.api.db.session import get_db
from apps.api.v1.schemas.live_ar import LiveArCaptureWithUrlResponse
from apps.api.v1.services import live_ar_service
from db.models import User

router = APIRouter(prefix="/api/v1/live-ar", tags=["live-ar"])


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


@router.post("/captures", response_model=LiveArCaptureWithUrlResponse, status_code=status.HTTP_201_CREATED)
async def create_capture(
    session_id: UUID = Query(...),
    jewellery_id: UUID = Query(...),
    asset_id: UUID | None = Query(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> LiveArCaptureWithUrlResponse:
    raw_bytes = await file.read()
    try:
        capture = live_ar_service.create_capture(db, session_id, jewellery_id, asset_id, current_user, raw_bytes)
    except live_ar_service.SessionNotFoundError:
        raise _not_found("Session not found.")
    except live_ar_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this session.")
    except live_ar_service.JewelleryNotFoundError:
        raise _not_found("Jewellery not found.")
    except live_ar_service.UnsupportedCategoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Live AR does not support the '{exc}' category in this milestone.",
        )
    except ImageValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    _, signed_url = live_ar_service.get_capture_signed_url(db, capture.id, current_user)
    return LiveArCaptureWithUrlResponse.model_validate({**capture.__dict__, "result_url": signed_url})


@router.get("/captures/{capture_id}", response_model=LiveArCaptureWithUrlResponse)
def get_capture(
    capture_id: UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> LiveArCaptureWithUrlResponse:
    try:
        capture, signed_url = live_ar_service.get_capture_signed_url(db, capture_id, current_user)
    except live_ar_service.CaptureNotFoundError:
        raise _not_found("Capture not found.")
    except live_ar_service.SessionAccessDeniedError:
        raise _forbidden("You do not have access to this capture.")
    return LiveArCaptureWithUrlResponse.model_validate({**capture.__dict__, "result_url": signed_url})
