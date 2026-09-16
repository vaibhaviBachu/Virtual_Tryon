"""
API tests for Milestone 4's render routes: POST /requests/{id}/render,
GET /renders/{id}, GET /renders/{id}/debug, GET /categories. Uses
`client_with_fake_redis` like apps/api/tests/test_tryon.py so a real worker never races
these tests — the worker pipeline itself is exercised in
workers/tests/test_process_tryon_render.py.
"""
import io
import json
import uuid

import pytest
from PIL import Image

from fastapi import Request
from fastapi.testclient import TestClient

from apps.api.core.auth_deps import get_current_user_optional
from apps.api.core.config import get_settings
from apps.api.core.redis_client import get_redis_client
from apps.api.main import app
from db.models import AssetType, Jewellery, JewelleryAsset, JewelleryCategory, ProcessingStatus


def _dynamic_optional_user(request: Request, db=None):
    """Same pattern as apps/api/tests/test_tryon.py's own helper (not imported across
    test files — pytest fixtures/helpers are file-scoped unless promoted to conftest.py,
    and duplicating this small helper is clearer than adding cross-file coupling for a
    handful of authorization tests)."""
    from apps.api.db.session import SessionLocal
    from db.models import User

    user_id = request.headers.get("X-Test-User-Id")
    if not user_id:
        return None
    session = SessionLocal()
    try:
        return session.get(User, user_id)
    finally:
        session.close()


@pytest.fixture()
def customer_optional_client(customer_user, fake_redis_client):
    app.dependency_overrides[get_current_user_optional] = _dynamic_optional_user
    app.dependency_overrides[get_redis_client] = lambda: fake_redis_client
    client = TestClient(app, headers={"X-Test-User-Id": str(customer_user.id)})
    yield client
    app.dependency_overrides.pop(get_current_user_optional, None)
    app.dependency_overrides.pop(get_redis_client, None)


@pytest.fixture()
def admin_optional_client(admin_user, fake_redis_client):
    app.dependency_overrides[get_current_user_optional] = _dynamic_optional_user
    app.dependency_overrides[get_redis_client] = lambda: fake_redis_client
    client = TestClient(app, headers={"X-Test-User-Id": str(admin_user.id)})
    yield client
    app.dependency_overrides.pop(get_current_user_optional, None)
    app.dependency_overrides.pop(get_redis_client, None)


def _real_jpeg_bytes(width=640, height=800, color=(200, 180, 160)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture()
def earrings_category_id(db_session):
    row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == "earrings").first()
    assert row is not None, "seed data missing: run the Milestone 2 migration first"
    return row.id


@pytest.fixture()
def ready_jewellery_with_asset(db_session, earrings_category_id, unique_suffix):
    jewellery = Jewellery(
        category_id=earrings_category_id, name="API Test Stud", slug=f"api-test-stud-{unique_suffix}",
        sku=f"SKU-render-{unique_suffix}",
    )
    db_session.add(jewellery)
    db_session.flush()
    asset = JewelleryAsset(
        jewellery_id=jewellery.id, asset_type=AssetType.processed,
        storage_key=f"jewellery/{jewellery.id}/processed/fake.png",
        mime_type="image/png", processing_status=ProcessingStatus.ready,
    )
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(jewellery)
    db_session.refresh(asset)
    yield jewellery, asset
    db_session.delete(db_session.get(JewelleryAsset, asset.id))
    db_session.delete(db_session.get(Jewellery, jewellery.id))
    db_session.commit()


def _create_request(client) -> tuple[str, str]:
    session_id = client.post("/api/v1/tryon/sessions", json={"device_info": {}}).json()["id"]
    files = {"file": ("photo.jpg", _real_jpeg_bytes(), "image/jpeg")}
    image_id = client.post(f"/api/v1/tryon/sessions/{session_id}/image", files=files).json()["id"]
    request_id = client.post(
        "/api/v1/tryon/requests", json={"session_id": session_id, "user_image_id": image_id}
    ).json()["id"]
    return session_id, request_id


def test_list_categories_marks_only_earrings_and_necklace_functional(client_with_fake_redis):
    client, _ = client_with_fake_redis
    resp = client.get("/api/v1/tryon/categories")
    assert resp.status_code == 200
    by_slug = {c["slug"]: c for c in resp.json()}
    assert by_slug["earrings"]["functional"] is True
    assert by_slug["necklace"]["functional"] is True
    assert by_slug["ring"]["functional"] is False
    assert by_slug["bangles"]["functional"] is False


def test_create_render_enqueues_job(client_with_fake_redis, ready_jewellery_with_asset):
    client, fake_redis = client_with_fake_redis
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(client)

    resp = client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(jewellery.id)}
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued"
    assert body["category_slug"] == "earrings"
    assert body["result_image_url"] is None

    queued = fake_redis.lrange("queue:tryon_render_processing", 0, -1)
    assert len(queued) == 1
    job = json.loads(queued[0])
    assert job["render_id"] == body["id"]
    assert job["request_id"] == request_id


def test_get_render_returns_queued_status(client_with_fake_redis, ready_jewellery_with_asset):
    client, _ = client_with_fake_redis
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(client)
    render_id = client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(jewellery.id)}
    ).json()["id"]

    resp = client.get(f"/api/v1/tryon/renders/{render_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"


def test_render_for_unknown_request_returns_404(client_with_fake_redis, ready_jewellery_with_asset):
    client, _ = client_with_fake_redis
    jewellery, _asset = ready_jewellery_with_asset
    resp = client.post(
        f"/api/v1/tryon/requests/{uuid.uuid4()}/render", json={"jewellery_id": str(jewellery.id)}
    )
    assert resp.status_code == 404


def test_render_for_unknown_jewellery_returns_404(client_with_fake_redis):
    client, _ = client_with_fake_redis
    _session_id, request_id = _create_request(client)
    resp = client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(uuid.uuid4())}
    )
    assert resp.status_code == 404


def test_unknown_render_returns_404(client_with_fake_redis):
    client, _ = client_with_fake_redis
    resp = client.get(f"/api/v1/tryon/renders/{uuid.uuid4()}")
    assert resp.status_code == 404


# --- Cross-session/cross-user access denial (spec §41) ---


def test_cannot_render_another_users_request(customer_optional_client, admin_optional_client, ready_jewellery_with_asset):
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(customer_optional_client)

    resp = admin_optional_client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(jewellery.id)}
    )
    assert resp.status_code == 403


def test_cannot_read_another_users_render(customer_optional_client, admin_optional_client, ready_jewellery_with_asset):
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(customer_optional_client)
    render_id = customer_optional_client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(jewellery.id)}
    ).json()["id"]

    resp = admin_optional_client.get(f"/api/v1/tryon/renders/{render_id}")
    assert resp.status_code == 403


def test_owner_can_read_their_own_render(customer_optional_client, ready_jewellery_with_asset):
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(customer_optional_client)
    render_id = customer_optional_client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(jewellery.id)}
    ).json()["id"]

    resp = customer_optional_client.get(f"/api/v1/tryon/renders/{render_id}")
    assert resp.status_code == 200


def test_client_cannot_submit_arbitrary_asset_id(client_with_fake_redis, ready_jewellery_with_asset):
    """Spec §22/§41: the client names IDs the server looks up server-side, never a raw
    storage path — an asset_id that doesn't belong to the given jewellery is rejected."""
    client, _ = client_with_fake_redis
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(client)

    resp = client.post(
        f"/api/v1/tryon/requests/{request_id}/render",
        json={"jewellery_id": str(jewellery.id), "asset_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 404


# --- Debug endpoint gating (spec §27) ---


def test_debug_endpoint_hidden_when_disabled(client_with_fake_redis, ready_jewellery_with_asset):
    client, _ = client_with_fake_redis
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(client)
    render_id = client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(jewellery.id)}
    ).json()["id"]

    settings = get_settings()
    original = settings.ENABLE_TRYON_DEBUG_VIZ
    settings.ENABLE_TRYON_DEBUG_VIZ = False
    try:
        resp = client.get(f"/api/v1/tryon/renders/{render_id}/debug")
        assert resp.status_code == 404
    finally:
        settings.ENABLE_TRYON_DEBUG_VIZ = original


def test_debug_endpoint_available_when_enabled(client_with_fake_redis, ready_jewellery_with_asset):
    client, _ = client_with_fake_redis
    jewellery, _asset = ready_jewellery_with_asset
    _session_id, request_id = _create_request(client)
    render_id = client.post(
        f"/api/v1/tryon/requests/{request_id}/render", json={"jewellery_id": str(jewellery.id)}
    ).json()["id"]

    settings = get_settings()
    settings.ENABLE_TRYON_DEBUG_VIZ = True
    resp = client.get(f"/api/v1/tryon/renders/{render_id}/debug")
    assert resp.status_code == 200
    body = resp.json()
    assert "placement_metadata" in body
    # Nothing rendered yet (still queued) — no debug image url yet, but the endpoint
    # itself is reachable, proving the gate is about exposure, not existence.
    assert body["debug_image_url"] is None
