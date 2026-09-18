"""
Live AR capture model — Milestone 5. See the 20260918_0005 migration's docstring for
why this is a new table rather than reusing TryOnRequest/TryOnRender: those represent
Milestone 3/4's server-side "analyze then render" pipeline, which a Live AR capture
never goes through (tracking + geometry + compositing all already happened in the
browser). `session_id` reuses the existing TryOnSession table.
"""
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class LiveArCapture(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "live_ar_captures"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tryon_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    jewellery_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("jewellery.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("jewellery_assets.id", ondelete="SET NULL"), nullable=True
    )
    category_slug: Mapped[str] = mapped_column(String(60), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    width_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    result_storage_key: Mapped[str] = mapped_column(String(512), nullable=False)

    session = relationship("TryOnSession")
    jewellery = relationship("Jewellery")
