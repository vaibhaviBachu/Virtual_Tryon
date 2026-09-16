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
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import redis
from sqlalchemy.orm import Session

from ai.preprocessing.image_validation import ImageValidationError, validate_and_normalize_upload
from apps.api.storage.s3_storage import get_object_storage
from db.models import (
    Jewellery,
    JewelleryAsset,
    JewelleryCategory,
    TryOnRender,
    TryOnRenderStatus,
    TryOnRequest,
    TryOnRequestStatus,
    TryOnSession,
    User,
    UserImage,
)
from jobqueue import TryOnRenderJob, TryOnRequestProcessingJob, enqueue_render_job, enqueue_tryon_job
from storage.keys import segmentation_mask_key, user_image_key

# Spec §26: only these two categories render for real in Milestone 4. Deliberately a
# plain set here (not a DB column) because "functional" is a property of THIS
# milestone's engine capability, not of the catalogue data itself — a category row
# does not change when Milestone 5 adds bangles, only this set does.
FUNCTIONAL_CATEGORY_SLUGS = {"earrings", "necklace"}

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


class JewelleryNotFoundError(Exception):
    pass


class RenderAssetNotFoundError(Exception):
    pass


class RenderNotFoundError(Exception):
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


# --- Milestone 4: geometry try-on rendering ---


def list_functional_categories(db: Session) -> list[dict]:
    """Spec §26: real category data, with `functional` telling the frontend which
    categories should render for real vs. show disabled — never a hard-coded frontend
    list that could drift from what the backend can actually process."""
    categories = (
        db.query(JewelleryCategory)
        .filter(JewelleryCategory.is_active.is_(True))
        .order_by(JewelleryCategory.name)
        .all()
    )
    return [
        {"id": c.id, "slug": c.slug, "name": c.name, "functional": c.slug in FUNCTIONAL_CATEGORY_SLUGS}
        for c in categories
    ]


def create_render(
    db: Session,
    redis_client: redis.Redis,
    request_id: UUID,
    jewellery_id: UUID,
    asset_id: Optional[UUID],
    current_user: Optional[User],
) -> TryOnRender:
    """Spec §22: the client only ever names a `request_id` (its own, already-authorized
    photo analysis) and a `jewellery_id`/optional `asset_id` (catalogue IDs) — never a
    raw storage path. `get_tryon_request` re-runs the same session-ownership check
    every other tryon route uses, so a request belonging to a different session/user
    cannot be rendered against."""
    request = get_tryon_request(db, request_id, current_user)  # raises TryOnRequestNotFoundError/SessionAccessDeniedError

    jewellery = db.get(Jewellery, jewellery_id)
    if jewellery is None:
        raise JewelleryNotFoundError(str(jewellery_id))

    if asset_id is not None:
        asset = db.get(JewelleryAsset, asset_id)
        if asset is None or asset.jewellery_id != jewellery.id:
            raise RenderAssetNotFoundError(str(asset_id))

    now = datetime.now(timezone.utc)
    render = TryOnRender(
        request_id=request.id,
        jewellery_id=jewellery.id,
        asset_id=asset_id,
        category_slug=jewellery.category.slug if jewellery.category else "unknown",
        status=TryOnRenderStatus.queued,
        queued_at=now,
    )
    db.add(render)
    db.commit()
    db.refresh(render)

    job = TryOnRenderJob.create(render_id=str(render.id), request_id=str(request.id))
    enqueue_render_job(redis_client, job)

    logger.info(
        "Created tryon render and enqueued processing",
        extra={
            "extra_fields": {
                "render_id": str(render.id),
                "request_id": str(request.id),
                "jewellery_id": str(jewellery.id),
                "job_id": job.job_id,
            }
        },
    )
    return render


def get_render(db: Session, render_id: UUID, current_user: Optional[User]) -> TryOnRender:
    render = db.get(TryOnRender, render_id)
    if render is None:
        raise RenderNotFoundError(str(render_id))
    request = db.get(TryOnRequest, render.request_id)
    if request is None:
        raise RenderNotFoundError(str(render_id))
    _authorize_session(db, request.session_id, current_user)  # raises if not the owner
    return render


def get_render_result_url(render: TryOnRender) -> Optional[str]:
    if render.status != TryOnRenderStatus.ready or not render.result_storage_key:
        return None
    storage = get_object_storage()
    return storage.create_signed_url(render.result_storage_key, expires_in=SIGNED_URL_EXPIRY)


def get_render_debug_url(render: TryOnRender) -> Optional[str]:
    if not render.debug_storage_key:
        return None
    storage = get_object_storage()
    return storage.create_signed_url(render.debug_storage_key, expires_in=SIGNED_URL_EXPIRY)


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)
