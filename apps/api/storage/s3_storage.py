"""
API-side object storage factory: builds the shared S3CompatibleStorage (storage/) from
apps.api.core.config settings. See storage/s3_storage.py for the implementation and
workers/storage.py for the worker-side equivalent (built from workers.config instead).
"""
from functools import lru_cache

from apps.api.core.config import get_settings
from storage.base import ObjectStorage
from storage.s3_storage import S3CompatibleStorage

__all__ = ["ObjectStorage", "S3CompatibleStorage", "get_object_storage"]


@lru_cache
def get_object_storage() -> ObjectStorage:
    settings = get_settings()
    return S3CompatibleStorage(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        bucket=settings.MINIO_BUCKET,
        secure=settings.MINIO_SECURE,
        # See MINIO_PUBLIC_ENDPOINT's docstring in apps/api/core/config.py and
        # storage/s3_storage.py's module docstring — this is what makes signed URLs
        # returned to the browser actually resolvable from the browser.
        public_endpoint=settings.MINIO_PUBLIC_ENDPOINT or None,
        public_secure=settings.MINIO_PUBLIC_SECURE,
    )
