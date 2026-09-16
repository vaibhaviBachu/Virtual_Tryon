"""baseline: enable required Postgres extensions, no application tables yet

This is the Milestone 1 baseline migration. It intentionally creates zero application
tables — per docs/roadmap.md, the jewellery_categories/jewellery/jewellery_assets/
tryon_sessions/tryon_requests/users schema belongs to Milestone 2. Its only job is to
prove the Alembic <-> Postgres wiring works end to end and to enable the `pgcrypto`
extension that Milestone 2's UUID primary keys will rely on (`gen_random_uuid()`).

Revision ID: 20260916_0001
Revises:
Create Date: 2026-09-16

"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260916_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')


def downgrade() -> None:
    op.execute('DROP EXTENSION IF EXISTS "pgcrypto"')
