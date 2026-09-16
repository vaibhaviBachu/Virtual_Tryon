"""
Try-on (user image pipeline) business logic — Milestone 3.

Same architectural rule as apps/api/v1/services/asset_service.py: this module
validates/persists/enqueues only. No landmark detection, no segmentation, no MediaPipe
import anywhere in this file or anywhere under apps/api — that all lives in
workers/tasks/process_tryon_request.py and ai/, per docs/development.md's one rule that
matters most.

Authorization model (spec: "a user must not access another user's photo/session by
guessing an ID"):
- A session's `user_id` is either NULL (guest) or a real authenticated user.
- A guest session's "credential" is simply knowledge of its own unguessable UUID
  (the same trust model as e.g. a signed URL) — nobody can access it without the id,
  and ids are never enumerable or logged anywhere they could leak.
- An authenticated session additionally requires the *same* user's token on every
  subsequent call — `_authorize_session` enforces this for every read/write below.
"""
import logging
from datetime import timedelta
from typing import Optional
from uuid import UUID

import redis
from sqlalchemy.orm import Session

from ai.preprocessing.image_validation import ImageValidationError, validate_and_normalize_upload
from apps.api.storage.s3_storage import get_object_storage
from db.models import TryOnRequest, TryOnRequestStatus, TryOnSession, User, UserImage
from jobqueue import TryOnRequestProcessingJob, enqueue_tryon_job
from storage.keys import segmentation_mask_key, user_image_key

logger = logging.getLogger("app.tryon")

SIGNED_URL_EXPIRY = timedelta(minutes=15)


class SessionNotFoundError(Exception):
    pass


class SessionAccessDeniedError(Exception):
    """Raised when an authenticated user attempts to touch a session they do not own.
    Deliberately a distinct exception from SessionNotFoundError so a 403 can be
    returned for "wrong owner" vs 404 for "does not exist" — see the router."""


class UserImageNotFoundError(Exception):
    pass


class TryOnRequestNotFoundError(Exception):
    pass


def create_session(db: Session, current_user: Optional[User], device_info: dict) -> TryOnSession:
    session = TryOnSession(
        user_id=current_user.id if current_user else None,
        device_info=device_info,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(
        "Created tryon session",
        extra={"extra_fields": {"session_id": str(session.id), "guest": current_user is None}},
    )
    return session


def _authorize_session(db: Session, session_id: UUID, current_user: Optional[User]) -> TryOnSession:
    session = db.get(TryOnSession, session_id)
    if session is None:
        raise SessionNotFoundError(str(session_id))
    if session.user_id is not None:
        # An owned session may only be touched by its owner, authenticated.
        if current_user is None or current_user.id != session.user_id:
            raise SessionAccessDeniedError(str(session_id))
    return session


def upload_session_image(
    db: Session,
    session_id: UUID,
    current_user: Optional[User],
    raw_bytes: bytes,
    capture_source: str,
) -> UserImage:
    """Validates + normalizes (reuses ai/preprocessing/image_validation.py's existing,
    content-sniffed, EXIF-stripping, orientation-normalizing pipeline unchanged — see
    Milestone 3's instruction to reuse rather than duplicate this logic), stores the
    result privately, and records metadata only."""
    session = _authorize_session(db, session_id, current_user)

    validated = validate_and_normalize_upload(raw_bytes)  # raises ImageValidationError

    storage = get_object_storage()
    key = user_image_key(session.id, validated.mime_type)
    storage.upload(key, _bytes_io(validated.content), content_type=validated.mime_type)

    image = UserImage(
        session_id=session.id,
        storage_key=key,
        mime_type=validated.mime_type,
        capture_source=capture_source if capture_source in ("camera", "upload") else "upload",
        original_width_px=validated.width_px,
        original_height_px=validated.height_px,
        normalized_width_px=validated.width_px,
        normalized_height_px=validated.height_px,
        file_size_bytes=validated.file_size_bytes,
    )
    db.add(image)
    db.commit()
    db.refresh(image)

    logger.info(
        "Stored user photo",
        extra={
            "extra_fields": {
                "session_id": str(session.id),
                "user_image_id": str(image.id),
                "capture_source": image.capture_source,
                "width_px": image.normalized_width_px,
                "height_px": image.normalized_height_px,
            }
        },
        # Deliberately no pixel data, no storage_key full value, no EXIF fields logged —
        # spec: "never log raw photographs/image contents/GPS/EXIF."
    )
    return image


def create_tryon_request(
    db: Session,
    redis_client: redis.Redis,
    session_id: UUID,
    user_image_id: UUID,
    current_user: Optional[User],
) -> TryOnRequest:
    session = _authorize_session(db, session_id, current_user)
    image = db.get(UserImage, user_image_id)
    if image is None or image.session_id != session.id:
        raise UserImageNotFoundError(str(user_image_id))

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    request = TryOnRequest(
        session_id=session.id,
        user_image_id=image.id,
        status=TryOnRequestStatus.queued,
        queued_at=now,
    )
    db.add(request)
    db.commit()
    db.refresh(request)

    job = TryOnRequestProcessingJob.create(request_id=str(request.id), session_id=str(session.id))
    enqueue_tryon_job(redis_client, job)

    logger.info(
        "Created tryon request and enqueued processing",
        extra={"extra_fields": {"request_id": str(request.id), "job_id": job.job_id}},
    )
    return request


def get_tryon_request(db: Session, request_id: UUID, current_user: Optional[User]) -> TryOnRequest:
    request = db.get(TryOnRequest, request_id)
    if request is None:
        raise TryOnRequestNotFoundError(str(request_id))
    _authorize_session(db, request.session_id, current_user)  # raises if not the owner
    return request


def get_segmentation_preview_url(request: TryOnRequest) -> Optional[str]:
    if not request.segmentation_mask_key:
        return None
    storage = get_object_storage()
    return storage.create_signed_url(request.segmentation_mask_key, expires_in=SIGNED_URL_EXPIRY)


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)
