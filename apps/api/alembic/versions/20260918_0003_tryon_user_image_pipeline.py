"""user image pipeline: tryon_sessions, user_images, tryon_requests

Milestone 3. Additive only — does not modify the Milestone 1 baseline (20260916_0001)
or the Milestone 2 catalogue schema (20260917_0002).

Revision ID: 20260918_0003
Revises: 20260917_0002
Create Date: 2026-09-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260918_0003"
down_revision: Union[str, None] = "20260917_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tryon_sessions",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("device_info", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tryon_sessions_user_id", "tryon_sessions", ["user_id"])

    op.create_table(
        "user_images",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "session_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tryon_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("capture_source", sa.String(20), nullable=False, server_default="upload"),
        sa.Column("original_width_px", sa.Integer(), nullable=True),
        sa.Column("original_height_px", sa.Integer(), nullable=True),
        sa.Column("normalized_width_px", sa.Integer(), nullable=True),
        sa.Column("normalized_height_px", sa.Integer(), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
        sa.UniqueConstraint("storage_key", name="uq_user_images_storage_key"),
    )
    op.create_index("ix_user_images_session_id", "user_images", ["session_id"])

    op.create_table(
        "tryon_requests",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "session_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tryon_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_image_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_images.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(30), nullable=False, server_default="created"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("face_landmarks", sa.JSON(), nullable=True),
        sa.Column("hand_landmarks", sa.JSON(), nullable=True),
        sa.Column("pose_landmarks", sa.JSON(), nullable=True),
        sa.Column("segmentation_mask_key", sa.String(512), nullable=True),
        sa.Column("segmentation_summary", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.JSON(), nullable=True),
        sa.Column("readiness", sa.JSON(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tryon_requests_session_id", "tryon_requests", ["session_id"])
    op.create_index("ix_tryon_requests_user_image_id", "tryon_requests", ["user_image_id"])


def downgrade() -> None:
    op.drop_table("tryon_requests")
    op.drop_table("user_images")
    op.drop_table("tryon_sessions")
