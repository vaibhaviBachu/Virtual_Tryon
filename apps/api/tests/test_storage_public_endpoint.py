"""
Regression test for the Milestone 4 runtime bug: signed URLs generated against the
Docker-internal MinIO hostname (`minio:9000`) are not resolvable from the user's
browser. See storage/s3_storage.py's module docstring for the full root-cause account.

This runs against the real moto_server used by every other apps/api test (see
conftest.py / docs/development.md) — no mocking of boto3 itself, only proving that
`create_signed_url()`'s returned URL's host reflects `public_endpoint`, independent of
the `endpoint` used for actual upload/download/exists calls.
"""
import io

from storage.s3_storage import S3CompatibleStorage


def _storage(**overrides) -> S3CompatibleStorage:
    kwargs = dict(
        endpoint="localhost:2005",
        access_key="minioadmin",
        secret_key="minioadmin",
        bucket="jewellery-tryon",
        secure=False,
    )
    kwargs.update(overrides)
    return S3CompatibleStorage(**kwargs)


def test_signed_url_uses_internal_endpoint_when_no_public_endpoint_is_configured():
    # Backward-compatible default (native-process dev, tests, anything without an
    # internal/host split): unchanged behavior from before this fix.
    storage = _storage()
    key = "tryon/regression-test/no-public-endpoint.png"
    storage.upload(key, io.BytesIO(b"fake-png-bytes"), content_type="image/png")
    try:
        url = storage.create_signed_url(key)
        assert url.startswith("http://localhost:2005/")
    finally:
        storage.delete(key)


def test_signed_url_uses_public_endpoint_when_configured_and_different():
    # The actual bug scenario: internal endpoint (what apps/api uses to talk to
    # storage) differs from the public endpoint (what must appear in a URL handed to
    # the browser). Upload/download must still succeed against the real internal
    # endpoint; only the presigned URL's host should change.
    storage = _storage(public_endpoint="example-public-minio-host:2005")
    key = "tryon/regression-test/with-public-endpoint.png"
    payload = b"fake-png-bytes-for-public-endpoint-test"
    storage.upload(key, io.BytesIO(payload), content_type="image/png")
    try:
        assert storage.exists(key) is True
        assert storage.download(key) == payload

        url = storage.create_signed_url(key)
        assert url.startswith("http://example-public-minio-host:2005/"), (
            f"expected the signed URL to use the configured public endpoint, got: {url}"
        )
        assert "localhost:2005" not in url
    finally:
        storage.delete(key)


def test_public_endpoint_identical_to_internal_endpoint_is_a_no_op():
    # Passing the same value for both must not change behavior or create a redundant
    # second client — the constructor's "public_endpoint != endpoint" guard covers
    # this (also covers apps/api's `MINIO_PUBLIC_ENDPOINT or None` default of "").
    storage = _storage(public_endpoint="localhost:2005")
    key = "tryon/regression-test/same-endpoint.png"
    storage.upload(key, io.BytesIO(b"x"), content_type="image/png")
    try:
        url = storage.create_signed_url(key)
        assert url.startswith("http://localhost:2005/")
    finally:
        storage.delete(key)
