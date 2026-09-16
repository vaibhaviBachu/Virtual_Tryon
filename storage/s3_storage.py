"""
S3-compatible implementation of ObjectStorage, backed by boto3.

Works unmodified against MinIO (local dev), AWS S3, and Cloudflare R2 (production) —
only the endpoint/credentials passed in change between environments. This class takes
no dependency on either apps.api or workers config — each caller's own settings module
constructs it (see apps/api/storage/s3_storage.py and workers/storage.py).

INTERNAL vs PUBLIC ENDPOINT (fixed as a real bug found during Milestone 4 runtime
verification on a real Docker Compose deployment — not a hypothetical): `upload`/
`download`/`delete`/`exists`/`ping` always run inside a container (apps/api or
workers), so they correctly use the Docker-internal service hostname (e.g.
`minio:9000`, only resolvable on the compose network). But `create_signed_url()`
produces a URL that is handed to the FRONTEND and opened directly by the user's
BROWSER — a process running on the host machine, which cannot resolve `minio` at all.
Signing a URL against the internal endpoint therefore produced a browser-unreachable
`http://minio:9000/...` link that always failed with a broken-image icon, even though
the object itself was uploaded and retrievable correctly from inside the containers.

The fix: an optional, separate `public_endpoint` (defaulting to `endpoint` when not
given, so single-process/native-process/test setups where there is no internal/
external split are unaffected). Presigned URLs are generated with a second boto3
client pointed at the public endpoint. This works because an S3 SigV4 presigned URL's
signature is computed over the bucket/key/expiry/host header, not validated against
"the process that generated it" — MinIO (and S3/R2) accept a request whose Host header
matches the endpoint the signature was computed for, regardless of which client
process created that signature, as long as both endpoints route to the same underlying
storage instance (true here: the internal `minio:9000` and the public
`localhost:2005` are the same MinIO container, just reached via two different
network paths — the Docker-internal DNS name vs. the host-mapped port).
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
        public_endpoint: str | None = None,
        public_secure: bool | None = None,
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

        # Only build a second client when a genuinely different public endpoint is
        # configured — most callers (tests, native-process dev, anything without a
        # container/host network split) have none, and should keep signing against the
        # same client/endpoint as before this fix.
        if public_endpoint and public_endpoint != endpoint:
            public_scheme = "https" if (secure if public_secure is None else public_secure) else "http"
            self._presign_client = boto3.client(
                "s3",
                endpoint_url=f"{public_scheme}://{public_endpoint}",
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                config=BotoConfig(signature_version="s3v4"),
            )
        else:
            self._presign_client = self._client

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
        return self._presign_client.generate_presigned_url(
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
