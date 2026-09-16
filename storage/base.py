"""
Object storage interface — moved to the repo-root `storage/` package in Milestone 2 for
the same reason `db/` moved: both `apps/api` (uploads original assets, creates signed
preview URLs) and `workers` (uploads processed/thumbnail assets after background
removal) need the identical abstraction, and duplicating it risked drift. See
db/base.py for the full rationale; this is the same pattern applied to storage.

Business logic and API routes must depend only on this abstraction, never on a
MinIO/boto3-specific type or call. This is what lets the same code run against local
MinIO in development and AWS S3 or Cloudflare R2 in production without a single line of
application code changing — only the configured endpoint/credentials differ.
"""
from abc import ABC, abstractmethod
from datetime import timedelta
from typing import BinaryIO


class ObjectStorage(ABC):
    @abstractmethod
    def upload(self, key: str, data: BinaryIO, content_type: str = "application/octet-stream") -> None:
        """Upload a file-like object to `key`."""

    @abstractmethod
    def download(self, key: str) -> bytes:
        """Return the raw bytes stored at `key`."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete the object at `key`. Must not raise if the key does not exist."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Return True if an object exists at `key`."""

    @abstractmethod
    def create_signed_url(self, key: str, expires_in: timedelta = timedelta(minutes=15)) -> str:
        """Return a time-limited, private URL for `key`. Buckets are never public — see
        docs/production-readiness.md privacy requirements."""

    @abstractmethod
    def ping(self) -> bool:
        """Cheap connectivity check for the /ready endpoint."""
