"""
User-photo pipeline models — Milestone 3 (spec §"Database: additive migration only").

Three tables, matching docs/architecture.md's `tryon_sessions`/`tryon_requests` naming
plus one addition (`user_images`) for the "user-image metadata" the spec calls out as
its own concept (a session can, in principle, hold more than one uploaded/captured
photo over its lifetime — e.g. a retake — so photo metadata is not flattened directly
onto the request row).

What is deliberately NOT stored here, and why:
- No binary image data anywhere (unchanged Milestone 1/2 rule) — `UserImage.storage_key`
  points at a private object-storage object.
- No raw dense per-pixel segmentation mask in the database — `TryOnRequest.
  segmentation_mask_key` is a storage key pointing at one small, private PNG mask
  (documented as an intermediate artifact with the same retention-awareness as the
  original photo, not a permanent public asset).
- Face/hand/pose landmark coordinates ARE stored, in `landmarks_json` (a single JSONB
  column, not three), because the spec's own required API surface
  (`GET /tryon/requests/{id}/landmarks`) must be able to serve them back, and because
  Milestone 4 needs them without re-running inference. This is a deliberate, documented
  exception to "do not permanently store raw landmark data unless required" — it IS
  required here by this milestone's own API contract. It is normalized 2D/3D geometry
  (points in [0,1] space, MediaPipe-topology indices), not a biometric identity template
  (no face-recognition embeddings are computed or stored anywhere in this codebase).
  A future retention job (Milestone 7 scope, not built now) can delete this column's
  contents on the same timer as the underlying photo — `TryOnSession.expires_at`
  already exists as that anchor, per the spec's "identifiable for future lifecycle
  deletion" requirement.
"""
import enum
import uuid
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class TryOnRequestStatus(str, enum.Enum):
    """Lifecycle states per the spec's example list. `uploaded`/`queued` are separate
    states (not collapsed) so the frontend can distinguish "we have your photo, about to
    enqueue" from "a worker is genuinely waiting in line," even though today the gap
    between them is milliseconds — this keeps the state machine honest if queue depth
    ever becomes real (spec: "never invent fake progress percentages; show real state")."""

    created = "created"
    uploaded = "uploaded"
    queued = "queued"
    processing = "processing"
    landmarks_ready = "landmarks_ready"
    segmentation_ready = "segmentation_ready"
    ready = "ready"
    failed = "failed"


class TryOnSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A guest or authenticated user's try-on session. `user_id` nullable — guest
    sessions are a first-class, spec-required case, using this same table (no second
    session system), matching the `user_id` nullability already established in Milestone
    0/2's `tryon_sessions` design."""

    __tablename__ = "tryon_sessions"

    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    device_info: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    expires_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    images = relationship("UserImage", back_populates="session", cascade="all, delete-orphan")
    requests = relationship("TryOnRequest", back_populates="session", cascade="all, delete-orphan")


class UserImage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One uploaded/captured user photo's metadata. Binary content lives only in private
    object storage (`storage_key`) — never in this table, never logged (see
    workers/tasks/process_tryon_request.py's logging calls, which log ids/dimensions/
    timings only, never pixel data or the storage key's full path in a way that would
    let it be reconstructed by a log reader without independent storage access)."""

    __tablename__ = "user_images"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tryon_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    capture_source: Mapped[str] = mapped_column(String(20), nullable=False, default="upload")  # "camera" | "upload"

    original_width_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    original_height_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    normalized_width_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    normalized_height_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    session = relationship("TryOnSession", back_populates="images")


class TryOnRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One "understand this photo" processing request (Milestone 3 scope — no jewellery
    placement/rendering fields exist here; those arrive with Milestone 4's own additive
    migration)."""

    __tablename__ = "tryon_requests"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tryon_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_image_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("user_images.id", ondelete="CASCADE"), nullable=False, index=True
    )

    status: Mapped[TryOnRequestStatus] = mapped_column(
        Enum(TryOnRequestStatus, name="tryon_request_status", native_enum=False, length=30),
        nullable=False,
        default=TryOnRequestStatus.created,
        server_default=TryOnRequestStatus.created.value,
    )
    # Safe, user-facing message only — mirrors JewelleryAsset.processing_error's rule
    # (Milestone 2): the real exception is logged server-side, never stored here.
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Landmark results (application-level schema from ai/landmarks/schemas.py,
    # serialized as plain dicts) — see module docstring for why these ARE persisted.
    face_landmarks: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    hand_landmarks: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    pose_landmarks: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Segmentation: only a storage key + real measured summary stats persisted here —
    # the actual per-pixel mask lives in one private object-storage object, not the DB.
    segmentation_mask_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    segmentation_summary: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    confidence: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    readiness: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    metrics: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)  # per-stage timings, spec §"Performance metrics"

    queued_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    session = relationship("TryOnSession", back_populates="requests")
    user_image = relationship("UserImage")
