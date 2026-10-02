"""jewellery ai intakes: AI Jewellery Assistant session/dedupe tracking

Additive only -- does not modify any existing table. Backs the new AI Jewellery
Assistant feature (floating chat widget that walks a customer through preparing their
own jewellery photo for virtual try-on). This table is NOT a second catalogue: product
data still lands in `jewellery`/`jewellery_assets` only, once the customer confirms via
the existing creation path. It exists purely so a minimized/reopened assistant session
can resume, and so repeat uploads of the same photo can be flagged (content_hash).

Revision ID: 20261002_0006
Revises: 20260918_0005
Create Date: 2026-10-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261002_0006"
down_revision: Union[str, None] = "20260918_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "jewellery_ai_intakes",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="created"),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("original_storage_key", sa.String(512), nullable=True),
        sa.Column("original_mime_type", sa.String(100), nullable=True),
        sa.Column("catalogue_image_storage_key", sa.String(512), nullable=True),
        sa.Column("thumbnail_storage_key", sa.String(512), nullable=True),
        sa.Column("ai_image_enhanced", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("image_generation_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("suggested_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("user_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "duplicate_of_jewellery_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jewellery.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "jewellery_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jewellery.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.create_index("ix_jewellery_ai_intakes_content_hash", "jewellery_ai_intakes", ["content_hash"])


def downgrade() -> None:
    op.drop_index("ix_jewellery_ai_intakes_content_hash", table_name="jewellery_ai_intakes")
    op.drop_table("jewellery_ai_intakes")
