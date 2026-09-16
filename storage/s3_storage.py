"""
S3-compatible implementation of ObjectStorage, backed by boto3.

Works unmodified against MinIO (local dev), AWS S3, and Cloudflare R2 (production) —
only the endpoint/credentials passed in change between environments. This class takes
no dependency on either apps.api or workers config — each caller's own settings module
constructs it (see apps/api/storage/s3_storage.py and workers/storage.py).
"""
import io
import logging
from datetime import timedelta
from typing import BinaryIO

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from storage.base import ObjectStorage

logger = logging.getLogger("storage.s3")


class S3CompatibleStorage(ObjectStorage):
    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool = False,
    ) -> None:
        self._bucket = bucket
        scheme = "https" if secure else "http"
        self._client = boto3.client(
            "s3",
            endpoint_url=f"{scheme}://{endpoint}",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=BotoConfig(signature_version="s3v4"),
        )
        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self) -> None:
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError:
            self._client.create_bucket(Bucket=self._bucket)
            logger.info("Created object storage bucket", extra={"extra_fields": {"bucket": self._bucket}})

    def upload(self, key: str, data: BinaryIO, content_type: str = "application/octet-stream") -> None:
        self._client.upload_fileobj(data, self._bucket, key, ExtraArgs={"ContentType": content_type})

    def download(self, key: str) -> bytes:
        buffer = io.BytesIO()
        self._client.download_fileobj(self._bucket, key, buffer)
        return buffer.getvalue()

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except ClientError:
            logger.warning("Delete failed (object may not exist)", extra={"extra_fields": {"key": key}})

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False

    def create_signed_url(self, key: str, expires_in: timedelta = timedelta(minutes=15)) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=int(expires_in.total_seconds()),
        )

    def ping(self) -> bool:
        try:
            self._client.head_bucket(Bucket=self._bucket)
            return True
        except Exception:
            logger.warning("Object storage readiness check failed", exc_info=True)
            return False
