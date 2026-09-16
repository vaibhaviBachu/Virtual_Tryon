"""Re-exports the shared ObjectStorage interface — see storage/base.py (moved there in
Milestone 2 so apps/api and workers share one definition; see db/base.py for the
identical rationale applied to models)."""
from storage.base import ObjectStorage

__all__ = ["ObjectStorage"]
