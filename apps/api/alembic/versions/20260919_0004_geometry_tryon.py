"""geometry try-on: jewellery asset anchor metadata + tryon_renders

Milestone 4. Additive only — does not modify Milestones 1-3's tables/columns.

Adds anchor/mirror/attachment-point metadata to `jewellery_assets` (spec §19:
"Extend catalogue asset metadata ... anchor_x, anchor_y, attachment_point, mirrorable")
and a new `tryon_renders` table tracking one geometry-engine render attempt per
(tryon_request, jewellery) pair (spec §22-24: the render API/worker pipeline is a
distinct async lifecycle from Milestone 3's "understand this photo" TryOnRequest, so it
gets its own row rather than overloading tryon_requests with rendering fields).

Revision ID: 20260919_0004
Revises: 20260918_0003
Create Date: 2026-09-19

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260919_0004"
down_revision: Union[str, None] = "20260918_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Jewellery asset anchor metadata (spec §8, §11, §19) ---
    # anchor_x/anchor_y: normalized [0,1] top-left-origin coordinates of the
    # JEWELLERY_ANCHOR (the attachment point, e.g. an earring hook or a necklace's
    # chain-center) *within the processed asset's own image plane* — same coordinate
    # convention as ai/landmarks/schemas.py, deliberately never a second convention.
    # Nullable: most catalogue items will not have an admin-supplied anchor and the
    # geometry engine falls back to a documented default derived from the asset's own
    # alpha bounding box (see ai/geometry/asset_geometry.py).
    op.add_column("jewellery_assets", sa.Column("anchor_x", sa.Float(), nullable=True))
    op.add_column("jewellery_assets", sa.Column("anchor_y", sa.Float(), nullable=True))
    op.add_column(
        "jewellery_assets",
        sa.Column("attachment_point", sa.String(60), nullable=True),
    )
    op.add_column(
        "jewellery_assets",
        sa.Column("mirrorable", sa.Boolean(), nullable=False, server_default="false"),
    )

    # --- Render lifecycle (spec §6, §22-24) ---
    op.create_table(
        "tryon_renders",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "request_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tryon_requests.id", ondelete="CASCADE"),
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
        sa.Column("engine_name", sa.String(40), nullable=False, server_default="geometry"),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        # Structured, machine-readable reason (spec §21: "EAR_NOT_VISIBLE",
        # "LOW_EAR_CONFIDENCE", etc.) — distinct from `error_message`, which is the
        # safe, human-readable copy shown to the customer.
        sa.Column("error_code", sa.String(60), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("result_storage_key", sa.String(512), nullable=True),
        sa.Column("debug_storage_key", sa.String(512), nullable=True),
        # Placement metadata (anchors, scale, rotation, bbox, assumptions) and per-stage
        # timings — real, measured values only (spec §6, §33, §38), never fabricated.
        sa.Column("placement_metadata", sa.JSON(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tryon_renders_request_id", "tryon_renders", ["request_id"])
    op.create_index("ix_tryon_renders_jewellery_id", "tryon_renders", ["jewellery_id"])


def downgrade() -> None:
    op.drop_table("tryon_renders")
    op.drop_column("jewellery_assets", "mirrorable")
    op.drop_column("jewellery_assets", "attachment_point")
    op.drop_column("jewellery_assets", "anchor_y")
    op.drop_column("jewellery_assets", "anchor_x")
