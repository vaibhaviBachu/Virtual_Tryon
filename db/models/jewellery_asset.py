"""
An asset variant (original / processed / thumbnail) belonging to one jewellery item.
Binary image data never lives here — only object-storage keys and metadata, per the
Milestone 1/2 hard rule (docs/production-readiness.md, Milestone 2 spec §5).

`processing_status`/`processing_error` live per-asset-row rather than per-jewellery-item
because a jewellery item can have several asset rows in flight (e.g. a re-upload
replacing a processed cutout while the thumbnail from the previous run is still valid).
"""
import enum
import uuid
from typing import Optional

from sqlalchemy import Boolean, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class AssetType(str, enum.Enum):
    original = "original"
    processed = "processed"
    thumbnail = "thumbnail"


class ProcessingStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class JewelleryAsset(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jewellery_assets"

    jewellery_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("jewellery.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    asset_type: Mapped[AssetType] = mapped_column(
        Enum(AssetType, name="jewellery_asset_type", native_enum=False, length=20), nullable=False
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    width_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    processing_status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus, name="jewellery_asset_processing_status", native_enum=False, length=20),
        nullable=False,
        default=ProcessingStatus.pending,
        server_default=ProcessingStatus.pending.value,
    )
    # Safe, user-facing message only. The real exception/traceback is logged server-side
    # (workers/tasks/process_jewellery_asset.py) and never stored here or sent to the
    # frontend, per docs/production-readiness.md's error-handling rule.
    processing_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- Milestone 4: geometry try-on anchor metadata (spec §8, §11, §19) ---
    # Normalized [0,1], top-left-origin coordinates of the JEWELLERY_ANCHOR (the
    # attachment point — e.g. an earring hook, a necklace's chain-center) within THIS
    # asset's own image plane. Nullable: most catalogue rows will not have an
    # admin-supplied anchor, and the geometry engine falls back to a documented default
    # derived from the asset's own non-transparent alpha bounding box (see
    # ai/geometry/asset_geometry.py) rather than the raw image rectangle (spec §18).
    anchor_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    anchor_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Free-text, category-appropriate label for what the anchor represents (e.g.
    # "ear_hook", "chain_center") — descriptive metadata only, never parsed for control
    # flow (category-specific placement logic lives in ai/geometry, keyed off the
    # jewellery's category, not this string).
    attachment_point: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    # Spec §11: "if the catalogue contains a single symmetric earring asset, provide an
    # explicit transformation option for mirroring... if asymmetric, do not
    # automatically mirror it unless the metadata says it is allowed." Defaults to
    # False (the safe, non-destructive default — an asymmetric asset silently mirrored
    # would look wrong on one ear) and must be explicitly set True by an admin who has
    # confirmed the design is left/right-symmetric.
    mirrorable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    jewellery = relationship("Jewellery", back_populates="assets")
