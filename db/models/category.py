"""
Jewellery categories — database-driven, per the Milestone 2 rule that new categories
must be addable without touching application code. `anchor_type` and `placement_config`
are carried over from the Milestone 0 architecture doc (docs/architecture.md §5): they
are not used by anything yet (the try-on engine doesn't exist until Milestone 4) but
exist now so a category row is the single place future placement config lives, instead
of that becoming a second migration bolted on later.
"""
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base
from db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class JewelleryCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jewellery_categories"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Not used until Milestone 4+ (geometry engine anchor selection). Nullable so
    # Milestone 2 can create categories without knowing this yet.
    anchor_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    placement_config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
