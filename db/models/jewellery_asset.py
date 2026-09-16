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

from sqlalchemy import Enum, ForeignKey, Integer, String, Text
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

    jewellery = relationship("Jewellery", back_populates="assets")
