"""
Live AR capture business logic — Milestone 5.

Only endpoint of its kind the spec authorizes for the live loop's own data: "backend may
provide... POST captured result only" (no per-frame endpoint exists anywhere in this
module or its router). This validates the single composited image the browser sends
(reusing ai/preprocessing/image_validation.py's existing validator unchanged, same as
Milestone 3's upload_session_image — no new validation logic invented here), stores it
privately, and records metadata only. No landmark detection, no rendering, no MediaPipe
import anywhere in this file — the browser already did that work before this request was
ever made.
"""
import logging
from datetime import timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from ai.preprocessing.image_validation import validate_and_normalize_upload
from apps.api.storage.s3_storage import get_object_storage
from db.models import Jewellery, LiveArCapture, TryOnSession, User
from storage.keys import live_ar_capture_key

logger = logging.getLogger("app.live_ar")

SIGNED_URL_EXPIRY = timedelta(minutes=15)

# Same functional-category gate as tryon_service.py's FUNCTIONAL_CATEGORY_SLUGS -- Live
# AR only supports earrings + necklace in this milestone (spec: "do not simultaneously
# implement all future jewellery categories").
FUNCTIONAL_CATEGORY_SLUGS = {"earrings", "necklace"}


class SessionNotFoundError(Exception):
    pass


class SessionAccessDeniedError(Exception):
    pass


class JewelleryNotFoundError(Exception):
    pass


class CaptureNotFoundError(Exception):
    pass


class UnsupportedCategoryError(Exception):
    pass


def _authorize_session(db: Session, session_id: UUID, current_user: User | None) -> TryOnSession:
    session = db.get(TryOnSession, session_id)
    if session is None:
        raise SessionNotFoundError(str(session_id))
    if session.user_id is not None:
        if current_user is None or current_user.id != session.user_id:
            raise SessionAccessDeniedError(str(session_id))
    return session


def create_capture(
    db: Session,
    session_id: UUID,
    jewellery_id: UUID,
    asset_id: UUID | None,
    current_user: User | None,
    raw_bytes: bytes,
) -> LiveArCapture:
    session = _authorize_session(db, session_id, current_user)

    jewellery = db.get(Jewellery, jewellery_id)
    if jewellery is None:
        raise JewelleryNotFoundError(str(jewellery_id))
    category_slug = jewellery.category.slug
    if category_slug not in FUNCTIONAL_CATEGORY_SLUGS:
        raise UnsupportedCategoryError(category_slug)

    validated = validate_and_normalize_upload(raw_bytes)  # raises ImageValidationError

    storage = get_object_storage()
    key = live_ar_capture_key(session.id, validated.mime_type)
    storage.upload(key, _bytes_io(validated.content), content_type=validated.mime_type)

    capture = LiveArCapture(
        session_id=session.id,
        jewellery_id=jewellery.id,
        asset_id=asset_id,
        category_slug=category_slug,
        mime_type=validated.mime_type,
        width_px=validated.width_px,
        height_px=validated.height_px,
        file_size_bytes=validated.file_size_bytes,
        result_storage_key=key,
    )
    db.add(capture)
    db.commit()
    db.refresh(capture)
    logger.info(
        "Created Live AR capture",
        extra={"extra_fields": {"capture_id": str(capture.id), "session_id": str(session.id)}},
    )
    return capture


def get_capture_signed_url(db: Session, capture_id: UUID, current_user: User | None) -> tuple[LiveArCapture, str]:
    capture = db.get(LiveArCapture, capture_id)
    if capture is None:
        raise CaptureNotFoundError(str(capture_id))
    _authorize_session(db, capture.session_id, current_user)
    storage = get_object_storage()
    signed_url = storage.create_signed_url(capture.result_storage_key, expires_in=SIGNED_URL_EXPIRY)
    return capture, signed_url


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)
