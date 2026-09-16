"""
Asset upload endpoint tests (Milestone 2 spec §9-10, §26).

Uses fake_redis_client (via client_with_fake_redis) rather than the real Redis instance
so these tests never race with a live worker process actually consuming the job queue —
the worker-side processing pipeline is tested separately and directly in
workers/tests/test_process_jewellery_asset.py.
"""
import io

import pytest
from PIL import Image

from apps.api.core.auth_deps import get_current_user
from apps.api.main import app
from db.models import Jewellery, JewelleryAsset, JewelleryCategory
from jobqueue import CatalogueAssetProcessingJob
from jobqueue.catalogue_jobs import QUEUE_KEY


def _make_jpeg_bytes(size=(500, 500), color=(200, 30, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture()
def earrings_category_id(db_session):
    row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == "earrings").first()
    return str(row.id)


@pytest.fixture()
def jewellery_item(db_session, earrings_category_id, unique_suffix):
    item = Jewellery(
        category_id=earrings_category_id,
        name=f"Asset Test Item {unique_suffix}",
        slug=f"asset-test-item-{unique_suffix}",
        sku=f"ASSET-{unique_suffix}",
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    yield item
    db_session.query(JewelleryAsset).filter(JewelleryAsset.jewellery_id == item.id).delete()
    db_session.delete(db_session.get(Jewellery, item.id))
    db_session.commit()


@pytest.fixture()
def admin_client_fake_redis(admin_user, fake_redis_client):
    from apps.api.core.redis_client import get_redis_client
    from fastapi.testclient import TestClient

    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_redis_client] = lambda: fake_redis_client
    client = TestClient(app)
    yield client, fake_redis_client
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_redis_client, None)


def test_upload_valid_image_creates_original_and_pending_processed_rows_and_enqueues_job(
    admin_client_fake_redis, jewellery_item
):
    client, redis_client = admin_client_fake_redis
    image_bytes = _make_jpeg_bytes()

    response = client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("photo.jpg", image_bytes, "image/jpeg")},
    )
    assert response.status_code == 202
    rows = response.json()
    types = {row["asset_type"] for row in rows}
    assert types == {"original", "processed"}

    original = next(r for r in rows if r["asset_type"] == "original")
    processed = next(r for r in rows if r["asset_type"] == "processed")
    assert original["processing_status"] == "ready"
    assert original["mime_type"] == "image/jpeg"
    assert original["width_px"] == 500
    assert processed["processing_status"] == "pending"

    # A real job was enqueued on the (fake) Redis queue — not just database rows created
    # with no corresponding work scheduled.
    assert redis_client.llen(QUEUE_KEY) == 1
    raw = redis_client.lpop(QUEUE_KEY)
    job = CatalogueAssetProcessingJob.from_json(raw)
    assert job.asset_id == processed["id"]
    assert job.jewellery_id == str(jewellery_item.id)


def test_upload_rejects_unsupported_mime_type(admin_client_fake_redis, jewellery_item):
    client, _ = admin_client_fake_redis
    response = client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("not-an-image.txt", b"just plain text, not an image at all", "text/plain")},
    )
    assert response.status_code == 422
    assert "traceback" not in response.text.lower()


def test_upload_rejects_extension_mime_mismatch(admin_client_fake_redis, jewellery_item):
    """A .png filename wrapping actual JPEG bytes — the API must trust neither the
    filename extension nor the client-sent Content-Type, only content sniffing."""
    client, redis_client = admin_client_fake_redis
    image_bytes = _make_jpeg_bytes()
    response = client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("photo.png", image_bytes, "image/png")},
    )
    # This must succeed (content-sniffed as real JPEG bytes, not rejected for the
    # mismatched extension/header) — proving MIME detection is content-based.
    assert response.status_code == 202
    assert response.json()[0]["mime_type"] == "image/jpeg"
    redis_client.flushall()


def test_upload_rejects_oversized_file(admin_client_fake_redis, jewellery_item):
    client, _ = admin_client_fake_redis
    oversized = b"\xff\xd8\xff\xe0" + b"0" * (16 * 1024 * 1024)
    response = client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("huge.jpg", oversized, "image/jpeg")},
    )
    assert response.status_code == 422


def test_upload_rejects_corrupt_file(admin_client_fake_redis, jewellery_item):
    client, _ = admin_client_fake_redis
    response = client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("corrupt.jpg", b"this is not a real image file", "image/jpeg")},
    )
    assert response.status_code == 422


def test_upload_rejects_truncated_file_without_500(admin_client_fake_redis, jewellery_item):
    """Regression test for a real bug found during manual verification: a
    structurally-valid-looking-but-truncated JPEG passed PIL's cheap verify() check and
    then raised an unhandled OSError deeper in the pipeline (EXIF normalization), which
    surfaced as a 500. Fixed in ai/preprocessing/image_validation.py by catching decode
    failures at that stage too."""
    client, _ = admin_client_fake_redis
    full_jpeg = _make_jpeg_bytes(size=(600, 600))
    truncated = full_jpeg[: len(full_jpeg) // 3]
    response = client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("truncated.jpg", truncated, "image/jpeg")},
    )
    assert response.status_code == 422
    assert "traceback" not in response.text.lower()
    assert response.json()["detail"]


def test_upload_rejects_image_below_minimum_dimensions(admin_client_fake_redis, jewellery_item):
    client, _ = admin_client_fake_redis
    tiny = _make_jpeg_bytes(size=(50, 50))
    response = client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("tiny.jpg", tiny, "image/jpeg")},
    )
    assert response.status_code == 422


def test_upload_to_unknown_jewellery_returns_404(admin_client_fake_redis):
    client, _ = admin_client_fake_redis
    image_bytes = _make_jpeg_bytes()
    response = client.post(
        "/api/v1/catalog/jewellery/00000000-0000-0000-0000-000000000000/assets",
        files={"file": ("photo.jpg", image_bytes, "image/jpeg")},
    )
    assert response.status_code == 404


def test_upload_requires_admin(customer_client, jewellery_item):
    image_bytes = _make_jpeg_bytes()
    response = customer_client.post(
        f"/api/v1/catalog/jewellery/{jewellery_item.id}/assets",
        files={"file": ("photo.jpg", image_bytes, "image/jpeg")},
    )
    assert response.status_code == 403
