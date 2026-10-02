"""
Tracks one AI Jewellery Assistant conversation end-to-end: the customer's uploaded
photo, the prepared catalogue image, AI-suggested metadata, the customer's edits, and
(once submitted) the real catalogue row it produced.

This is deliberately NOT a second catalogue. Product data lives only in `Jewellery`/
`JewelleryAsset` once the customer confirms — this table is bookkeeping for the
assistant's own conversational session (so a minimized/reopened chat can resume where
it left off, per the AI Jewellery Assistant spec's "state persistence" requirement) and
for cross-session duplicate-upload detection (`content_hash`), neither of which the
existing catalogue schema has any reason to carry.
"""
import enum
import uuid
from typing import Any, Optional

from sqlalchemy import JSON, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class IntakeStatus(str, enum.Enum):
    created = "created"
    image_ready = "image_ready"
    metadata_ready = "metadata_ready"
    submitted = "submitted"
    failed = "failed"


class JewelleryAIIntake(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jewellery_ai_intakes"

    status: Mapped[IntakeStatus] = mapped_column(
        Enum(IntakeStatus, name="jewellery_ai_intake_status", native_enum=False, length=20),
        nullable=False,
        default=IntakeStatus.created,
        server_default=IntakeStatus.created.value,
    )

    # --- Image stage ---
    # sha256 of the original uploaded bytes, used for duplicate-upload detection across
    # sessions (spec: "generate a content hash ... check whether the same source image
    # already exists"). Indexed, not unique — a duplicate is a warning shown to the
    # customer, never a hard block (they may legitimately re-upload the same photo).
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    original_storage_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    original_mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    catalogue_image_storage_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    thumbnail_storage_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # True only if a configured ImageGenerationProvider actually ran AND its output
    # passed looks_like_isolated_product_photo (vs. the deterministic-only fallback) —
    # surfaced to the frontend so it never claims "AI-prepared" when it was only
    # resized/padded.
    ai_image_enhanced: Mapped[bool] = mapped_column(default=False, server_default="false", nullable=False)
    # One of "not_configured" | "failed" | "rejected" | "success" (see
    # apps/api/v1/services/jewellery_ai_service.py::ImagePreparationOutcome) — distinct
    # from ai_image_enhanced so the frontend can tell the customer the REAL reason their
    # photo wasn't AI-prepared, rather than one generic fallback message regardless of
    # whether AI was never configured, errored out, or ran but produced something that
    # still isn't an isolated product shot.
    image_preparation_status: Mapped[str] = mapped_column(
        String(20), default="not_configured", server_default="not_configured", nullable=False
    )
    image_generation_attempts: Mapped[int] = mapped_column(default=0, server_default="0", nullable=False)

    # --- Metadata stage ---
    # AI-suggested fields, kept separate from the customer's edits so "what did the
    # model actually suggest" is always recoverable (useful for debugging/evals) even
    # after the customer changes everything.
    suggested_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}", nullable=False)
    # The customer's current working copy (starts as a copy of suggested_metadata once
    # generated, then diverges as they edit). This is what submit() actually uses.
    user_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}", nullable=False)

    # --- Outcome ---
    duplicate_of_jewellery_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("jewellery.id", ondelete="SET NULL"), nullable=True
    )
    jewellery_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("jewellery.id", ondelete="SET NULL"), nullable=True
    )
    # Safe, user-facing message only (never a raw traceback) — same rule as
    # JewelleryAsset.processing_error.
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    jewellery = relationship("Jewellery", foreign_keys=[jewellery_id])
    duplicate_of_jewellery = relationship("Jewellery", foreign_keys=[duplicate_of_jewellery_id])
