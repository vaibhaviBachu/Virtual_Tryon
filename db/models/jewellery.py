"""
Core catalogue item. Physical dimensions are first-class columns (not buried in the
`extra_measurements` JSON) because the Milestone 0 research is explicit that the future
geometry try-on engine needs real-world scale, not pixel dimensions — see
docs/architecture.md §6 and §7. `extra_measurements` is for the category-specific
measurements that don't apply universally (e.g. ring size, bangle inner diameter,
necklace drop length) so adding a new category's measurement doesn't require a schema
migration.
"""
import uuid
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Jewellery(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jewellery"

    category_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("jewellery_categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(220), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    # Catalogue-management fields only — no cart/checkout/order semantics (Milestone 2
    # explicitly says not to invent e-commerce functionality beyond this).
    price: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)

    # Physical dimensions for future geometry-based scale calculation.
    physical_width_mm: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    physical_height_mm: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    physical_depth_mm: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    weight_g: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)

    # Category-specific measurements that don't apply to every category (ring size,
    # bangle inner diameter, necklace drop length, ...) — extensible without a migration.
    extra_measurements: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    category = relationship("JewelleryCategory", lazy="joined")
    assets = relationship(
        "JewelleryAsset", back_populates="jewellery", cascade="all, delete-orphan", lazy="selectin"
    )
