from apps.api.storage.base import ObjectStorage
from apps.api.storage.s3_storage import S3CompatibleStorage, get_object_storage

__all__ = ["ObjectStorage", "S3CompatibleStorage", "get_object_storage"]
