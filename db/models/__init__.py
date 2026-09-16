"""Import every model so Alembic autogenerate (and anything else that needs the full
metadata, like create_all in tests) sees all of them from a single import."""
from db.models.category import JewelleryCategory
from db.models.jewellery import Jewellery
from db.models.jewellery_asset import AssetType, JewelleryAsset, ProcessingStatus
from db.models.user import User, UserRole

__all__ = [
    "JewelleryCategory",
    "Jewellery",
    "JewelleryAsset",
    "AssetType",
    "ProcessingStatus",
    "User",
    "UserRole",
]
