"""
API tests for the Milestone 5 Live AR capture routes: POST /api/v1/live-ar/captures,
GET /api/v1/live-ar/captures/{id}. No per-frame endpoint exists to test, by design.
"""
import io

import pytest
from PIL import Image

from db.models import Jewellery, JewelleryCategory, LiveArCapture


def _real_jpeg_bytes(width=640, height=480, color=(180, 160, 140)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture()
def earrings_category_id(db_session):
    row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == "earrings").first()
    return str(row.id)


@pytest.fixture()
def rings_category_id(db_session):
    row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == "rings").first()
    return str(row.id) if row else None


@pytest.fixture()
def earring_item(db_session, earrings_category_id, unique_suffix):
    item = Jewellery(
        category_id=earrings_category_id,
        name=f"Live AR Test Earring {unique_suffix}",
        slug=f"live-ar-test-earring-{unique_suffix}",
        sku=f"LIVEAR-{unique_suffix}",
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    yield item
    db_session.query(LiveArCapture).filter(LiveArCapture.jewellery_id == item.id).delete()
    db_session.delete(db_session.get(Jewellery, item.id))
    db_session.commit()


def _create_session(client) -> str:
    return client.post("/api/v1/tryon/sessions", json={"device_info": {}}).json()["id"]


def test_create_capture_for_guest_session(client, earring_item):
    session_id = _create_session(client)
    files = {"file": ("capture.jpg", _real_jpeg_bytes(), "image/jpeg")}
    resp = client.post(
        f"/api/v1/live-ar/captures?session_id={session_id}&jewellery_id={earring_item.id}",
        files=files,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["session_id"] == session_id
    assert body["jewellery_id"] == str(earring_item.id)
    assert body["category_slug"] == "earrings"
    assert body["mime_type"] == "image/jpeg"
    assert body["width_px"] == 640
    assert "result_url" in body and body["result_url"]
    # Never exposes the raw internal storage key.
    assert "result_storage_key" not in body


def test_get_capture_returns_a_fresh_signed_url(client, earring_item):
    session_id = _create_session(client)
    files = {"file": ("capture.jpg", _real_jpeg_bytes(), "image/jpeg")}
    create_resp = client.post(
        f"/api/v1/live-ar/captures?session_id={session_id}&jewellery_id={earring_item.id}",
        files=files,
    )
    capture_id = create_resp.json()["id"]

    get_resp = client.get(f"/api/v1/live-ar/captures/{capture_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == capture_id
    assert get_resp.json()["result_url"]


def test_create_capture_for_nonexistent_session_returns_404(client, earring_item):
    import uuid

    files = {"file": ("capture.jpg", _real_jpeg_bytes(), "image/jpeg")}
    resp = client.post(
        f"/api/v1/live-ar/captures?session_id={uuid.uuid4()}&jewellery_id={earring_item.id}",
        files=files,
    )
    assert resp.status_code == 404


def test_create_capture_for_nonexistent_jewellery_returns_404(client):
    import uuid

    session_id = _create_session(client)
    files = {"file": ("capture.jpg", _real_jpeg_bytes(), "image/jpeg")}
    resp = client.post(
        f"/api/v1/live-ar/captures?session_id={session_id}&jewellery_id={uuid.uuid4()}",
        files=files,
    )
    assert resp.status_code == 404


def test_create_capture_rejects_invalid_file(client, earring_item):
    session_id = _create_session(client)
    files = {"file": ("not-an-image.txt", b"hello world", "text/plain")}
    resp = client.post(
        f"/api/v1/live-ar/captures?session_id={session_id}&jewellery_id={earring_item.id}",
        files=files,
    )
    assert resp.status_code == 422


def test_create_capture_rejects_unsupported_category(client, db_session, rings_category_id, unique_suffix):
    if rings_category_id is None:
        pytest.skip("No 'rings' category seeded in this environment.")
    ring = Jewellery(
        category_id=rings_category_id,
        name=f"Live AR Test Ring {unique_suffix}",
        slug=f"live-ar-test-ring-{unique_suffix}",
        sku=f"LIVEARRING-{unique_suffix}",
    )
    db_session.add(ring)
    db_session.commit()
    db_session.refresh(ring)

    session_id = _create_session(client)
    files = {"file": ("capture.jpg", _real_jpeg_bytes(), "image/jpeg")}
    resp = client.post(
        f"/api/v1/live-ar/captures?session_id={session_id}&jewellery_id={ring.id}",
        files=files,
    )
    assert resp.status_code == 422

    db_session.delete(db_session.get(Jewellery, ring.id))
    db_session.commit()
