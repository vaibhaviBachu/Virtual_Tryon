"""catalogue schema: users, jewellery_categories, jewellery, jewellery_assets

Milestone 2. Does not modify the Milestone 1 baseline migration (20260916_0001) — this
is a new, additive, reversible migration per the Milestone 2 spec §33.

Revision ID: 20260917_0002
Revises: 20260916_0001
Create Date: 2026-09-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260917_0002"
down_revision: Union[str, None] = "20260916_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The nine categories the Milestone 2 spec names as the initial supported set. Seeded
# here (data migration) rather than hard-coded anywhere in application code — the
# category system is entirely database-driven; adding a tenth category later is a row
# insert via the admin API, not a code change or a new migration.
_INITIAL_CATEGORIES = [
    ("Earrings", "earrings", "ear"),
    ("Necklace", "necklace", "neck"),
    ("Haaram", "haaram", "neck"),
    ("Bangles", "bangles", "wrist"),
    ("Bracelet", "bracelet", "wrist"),
    ("Ring", "ring", "finger"),
    ("Maang Tikka", "maang_tikka", "forehead"),
    ("Nose Ring", "nose_ring", "nose"),
    ("Jewellery Set", "jewellery_set", "multi"),
]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="customer"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "jewellery_categories",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("anchor_type", sa.String(30), nullable=True),
        sa.Column("placement_config", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.UniqueConstraint("slug", name="uq_jewellery_categories_slug"),
    )
    op.create_index("ix_jewellery_categories_slug", "jewellery_categories", ["slug"])

    op.create_table(
        "jewellery",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "category_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jewellery_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sku", sa.String(64), nullable=False),
        sa.Column("price", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(3), nullable=True),
        sa.Column("physical_width_mm", sa.Numeric(8, 2), nullable=True),
        sa.Column("physical_height_mm", sa.Numeric(8, 2), nullable=True),
        sa.Column("physical_depth_mm", sa.Numeric(8, 2), nullable=True),
        sa.Column("weight_g", sa.Numeric(8, 2), nullable=True),
        sa.Column("extra_measurements", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.UniqueConstraint("slug", name="uq_jewellery_slug"),
        sa.UniqueConstraint("sku", name="uq_jewellery_sku"),
    )
    op.create_index("ix_jewellery_category_id", "jewellery", ["category_id"])
    op.create_index("ix_jewellery_slug", "jewellery", ["slug"])
    op.create_index("ix_jewellery_sku", "jewellery", ["sku"])

    op.create_table(
        "jewellery_assets",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "jewellery_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jewellery.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("asset_type", sa.String(20), nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("width_px", sa.Integer(), nullable=True),
        sa.Column("height_px", sa.Integer(), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
        sa.Column("processing_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.UniqueConstraint("storage_key", name="uq_jewellery_assets_storage_key"),
    )
    op.create_index("ix_jewellery_assets_jewellery_id", "jewellery_assets", ["jewellery_id"])

    categories_table = sa.table(
        "jewellery_categories",
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("anchor_type", sa.String),
    )
    op.bulk_insert(
        categories_table,
        [{"name": name, "slug": slug, "anchor_type": anchor} for name, slug, anchor in _INITIAL_CATEGORIES],
    )


def downgrade() -> None:
    op.drop_table("jewellery_assets")
    op.drop_table("jewellery")
    op.drop_table("jewellery_categories")
    op.drop_table("users")
