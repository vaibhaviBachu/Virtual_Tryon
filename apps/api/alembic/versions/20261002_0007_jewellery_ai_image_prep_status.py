"""jewellery ai intakes: add image_preparation_status

Additive only. Lets the frontend distinguish "AI not configured" from "AI ran and
failed" from "AI ran but its output didn't pass the isolated-product-photo check" --
previously all three collapsed into the same ai_image_enhanced=false with no way to
tell the customer which one actually happened.

Revision ID: 20261002_0007
Revises: 20261002_0006
Create Date: 2026-10-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261002_0007"
down_revision: Union[str, None] = "20261002_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jewellery_ai_intakes",
        sa.Column("image_preparation_status", sa.String(20), nullable=False, server_default="not_configured"),
    )


def downgrade() -> None:
    op.drop_column("jewellery_ai_intakes", "image_preparation_status")
