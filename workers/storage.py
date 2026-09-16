"""
Worker-side object storage factory — mirrors apps/api/storage/s3_storage.py but built
from WorkerSettings, never from apps.api.core.config (see db/base.py for why worker and
api never import each other's config/session code even though they share storage/db
abstractions).
"""
from functools import lru_cache

from storage.base import ObjectStorage
from storage.s3_storage import S3CompatibleStorage
from workers.config import get_worker_settings


@lru_cache
def get_object_storage() -> ObjectStorage:
    settings = get_worker_settings()
    return S3CompatibleStorage(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        bucket=settings.MINIO_BUCKET,
        secure=settings.MINIO_SECURE,
    )
