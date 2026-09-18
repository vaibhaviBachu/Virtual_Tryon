"""live ar captures: one table for Milestone 5's final capture flow

Additive only — does not modify Milestones 1-4's tables/columns.

Milestone 5 spec: "a capture button composites the current live frame + jewellery
rendering into one final image... only that single captured image is sent to the
backend (never continuous video)... reuse existing private storage/signed URL
architecture." This does NOT reuse tryon_requests/tryon_renders directly: those tables
represent Milestone 3/4's server-side "analyze this uploaded photo, then render jewellery
onto it" pipeline, and a Live AR capture never goes through server-side landmark
analysis or server-side rendering — the tracking, geometry, and compositing already
happened in the browser before the image was ever sent. Reusing those tables would mean
fabricating landmarks_ready/ready statuses for a pipeline stage that never ran, which is
exactly the kind of fake state the spec repeatedly prohibits. `live_ar_captures` DOES
reuse `tryon_sessions` (spec: "reuse existing try-on sessions where possible") rather
than introducing a second session concept.

Revision ID: 20260918_0005
Revises: 20260919_0004
Create Date: 2026-09-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260918_0005"
down_revision: Union[str, None] = "20260919_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "live_ar_captures",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "session_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tryon_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "jewellery_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jewellery.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jewellery_assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("category_slug", sa.String(60), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("width_px", sa.Integer(), nullable=True),
        sa.Column("height_px", sa.Integer(), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
        # Private object-storage key for the single composited frame the browser sent.
        # No other image data (and never raw video) is ever stored for a Live AR
        # session — see docs/live-ar-architecture.md's "Privacy" section.
        sa.Column("result_storage_key", sa.String(512), nullable=False),
    )
    op.create_index("ix_live_ar_captures_session_id", "live_ar_captures", ["session_id"])
    op.create_index("ix_live_ar_captures_jewellery_id", "live_ar_captures", ["jewellery_id"])


def downgrade() -> None:
    op.drop_table("live_ar_captures")
