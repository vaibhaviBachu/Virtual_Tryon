"""
Shared SQLAlchemy declarative base.

ARCHITECTURAL NOTE (Milestone 2): this package (`db/`) is new and sits at the repo root,
a sibling of `apps/`, `ai/`, and `workers/` — not inside `apps/api/`. Milestone 1's rule
was "apps/api and workers never import from each other." But both genuinely need the
*same* ORM model definitions to safely read/write the same Postgres tables — the worker
updates `jewellery_assets.processing_status` after running the background-removal
pipeline, using the same `JewelleryAsset` model the API used to create that row.
Duplicating the model classes in both places would let them drift out of sync silently
(a real correctness risk, worse than a small architectural adjustment). So `db/` is
model/session code only — no FastAPI, no queue logic — and both `apps/api` and `workers`
depend on it, while still never depending on each other. See
docs/milestone-2-verification.md for the full write-up of this change.
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
