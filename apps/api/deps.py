"""
Shared FastAPI dependency wiring.

Kept separate from individual routers so `Depends(get_db)` etc. has one canonical import
path across the whole app, per the "no scattered configuration" rule.
"""
from apps.api.core.config import Settings, get_settings
from apps.api.db.session import get_db

__all__ = ["get_db", "get_settings", "Settings"]
