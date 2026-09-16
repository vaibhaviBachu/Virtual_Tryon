"""
Re-exports the shared declarative base.

Milestone 2 moved the actual `Base`/model definitions to the top-level `db/` package
(see db/base.py for why) so `apps/api` and `workers` can share one set of ORM models
without importing from each other. This module is kept so any existing
`from apps.api.db.base import Base` import still works.
"""
from db.base import Base

__all__ = ["Base"]
