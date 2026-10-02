"""
AI Jewellery Assistant endpoint tests.

No admin/customer auth fixtures are used anywhere here — every route in
apps/api/v1/routers/jewellery_ai.py is deliberately public (see that module's and
jewellery_ai_service.py's docstrings for why). AI_API_KEY is empty in every test
environment (conftest.py never sets it, and it has no default other than ""), so the
image/metadata paths below exercise the "AI not configured" graceful-degradation
behavior for real, the same way they will in any environment until a real key is added
— this is not a mocked provider, it's the actual configured-absent code path.

NOTE: like the rest of apps/api/tests, this requires a real local Postgres (and here,
also local MinIO) — see docker-compose.yml's postgres/minio services. It has not been
run in every environment this feature was developed in; see the implementation report
for which environments it has and hasn't been verified in.
"""
import io

import pytest
from PIL import Image

from apps.api.core.config import Settings, get_settings
from apps.api.core.redis_client import get_redis_client
from apps.api.main import app
from db.models import Jewellery, JewelleryAIIntake, JewelleryAsset, JewelleryCategory


def _make_jpeg_bytes(size=(500, 500), color=(200, 30, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture()
def client_fake_redis(fake_redis_client):
    from fastapi.testclient import TestClient

    app.dependency_overrides[get_redis_client] = lambda: fake_redis_client
    client = TestClient(app)
    yield client, fake_redis_client
    app.dependency_overrides.pop(get_redis_client, None)


@pytest.fixture()
def cleanup_intake(db_session):
    created_ids = []
    yield created_ids
    for intake_id in created_ids:
        row = db_session.get(JewelleryAIIntake, intake_id)
        if row is not None:
            db_session.delete(row)
    db_session.commit()


@pytest.fixture()
def cleanup_jewellery(db_session):
    created_ids = []
    yield created_ids
    for jewellery_id in created_ids:
        row = db_session.get(Jewellery, jewellery_id)
        if row is not None:
            db_session.query(JewelleryAsset).filter(JewelleryAsset.jewellery_id == jewellery_id).delete()
            db_session.delete(row)
    db_session.commit()


def test_create_session_returns_created_status(client_fake_redis, cleanup_intake):
    client, _ = client_fake_redis
    response = client.post("/api/v1/jewellery-ai/sessions")
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "created"
    assert body["jewellery_id"] is None
    cleanup_intake.append(body["id"])


def test_get_unknown_session_returns_404(client_fake_redis):
    client, _ = client_fake_redis
    response = client.get("/api/v1/jewellery-ai/sessions/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


def test_upload_image_prepares_a_deterministic_preview_without_a_configured_ai_key(
    client_fake_redis, cleanup_intake
):
    client, _ = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)

    response = client.post(
        f"/api/v1/jewellery-ai/sessions/{session_id}/image",
        files={"file": ("photo.jpg", _make_jpeg_bytes(), "image/jpeg")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "image_ready"
    assert body["ai_image_enhanced"] is False  # no AI_API_KEY/GEMINI_API_KEY in any test environment
    assert body["image_preparation_status"] == "not_configured"
    assert body["original_preview_url"]
    assert body["prepared_preview_url"]


def test_upload_image_rejects_corrupt_file(client_fake_redis, cleanup_intake):
    client, _ = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)

    response = client.post(
        f"/api/v1/jewellery-ai/sessions/{session_id}/image",
        files={"file": ("corrupt.jpg", b"not a real image", "image/jpeg")},
    )
    assert response.status_code == 422
    assert "traceback" not in response.text.lower()


def test_metadata_suggestion_reports_service_not_configured_cleanly(client_fake_redis, cleanup_intake):
    client, _ = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)
    client.post(
        f"/api/v1/jewellery-ai/sessions/{session_id}/image",
        files={"file": ("photo.jpg", _make_jpeg_bytes(), "image/jpeg")},
    )

    response = client.post(f"/api/v1/jewellery-ai/sessions/{session_id}/metadata")
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()
    assert "traceback" not in response.text.lower()


def test_patch_updates_user_metadata_without_touching_suggested_metadata(client_fake_redis, cleanup_intake):
    client, _ = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)

    response = client.patch(
        f"/api/v1/jewellery-ai/sessions/{session_id}",
        json={"name": "Hand-entered Name", "category_slug": "necklace", "physical_width_mm": 125},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user_metadata"]["name"] == "Hand-entered Name"
    assert body["user_metadata"]["physical_width_mm"] == 125
    assert body["suggested_metadata"] == {}


def test_submit_without_required_fields_returns_400(client_fake_redis, cleanup_intake):
    client, _ = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)
    client.post(
        f"/api/v1/jewellery-ai/sessions/{session_id}/image",
        files={"file": ("photo.jpg", _make_jpeg_bytes(), "image/jpeg")},
    )

    response = client.post(f"/api/v1/jewellery-ai/sessions/{session_id}/submit")
    assert response.status_code == 400


def test_submit_happy_path_creates_real_catalogue_rows_and_enqueues_existing_worker_job(
    client_fake_redis, cleanup_intake, cleanup_jewellery, db_session
):
    from jobqueue.catalogue_jobs import QUEUE_KEY

    client, redis_client = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)

    client.post(
        f"/api/v1/jewellery-ai/sessions/{session_id}/image",
        files={"file": ("photo.jpg", _make_jpeg_bytes(), "image/jpeg")},
    )
    client.patch(
        f"/api/v1/jewellery-ai/sessions/{session_id}",
        json={
            "name": "Test AI Haaram",
            "category_slug": "haaram",
            "size": "Large",
            "material": "Gold",
            "physical_width_mm": 110,
        },
    )

    response = client.post(f"/api/v1/jewellery-ai/sessions/{session_id}/submit")
    assert response.status_code == 200
    body = response.json()
    jewellery_id = body["jewellery_id"]
    cleanup_jewellery.append(jewellery_id)
    assert body["intake"]["status"] == "submitted"

    jewellery = db_session.get(Jewellery, jewellery_id)
    assert jewellery is not None
    assert jewellery.name == "Test AI Haaram"
    assert jewellery.physical_width_mm == 110
    assert jewellery.extra_measurements["size"] == "Large"

    assets = db_session.query(JewelleryAsset).filter(JewelleryAsset.jewellery_id == jewellery_id).all()
    asset_types = {a.asset_type.value for a in assets}
    assert asset_types == {"original", "processed"}

    # Reused the EXISTING catalogue worker queue -- no parallel processing path.
    assert redis_client.llen(QUEUE_KEY) == 1


def test_submit_with_invalid_category_slug_returns_400(client_fake_redis, cleanup_intake):
    client, _ = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)
    client.post(
        f"/api/v1/jewellery-ai/sessions/{session_id}/image",
        files={"file": ("photo.jpg", _make_jpeg_bytes(), "image/jpeg")},
    )
    client.patch(
        f"/api/v1/jewellery-ai/sessions/{session_id}",
        json={"name": "Bad Category Item", "category_slug": "not-a-real-category"},
    )

    response = client.post(f"/api/v1/jewellery-ai/sessions/{session_id}/submit")
    assert response.status_code == 400


def test_image_endpoint_is_rate_limited_per_client(client_fake_redis, cleanup_intake):
    """A real request-by-request check against a very small limit — not a mock of the
    rate limiter itself."""
    client, _ = client_fake_redis
    session_id = client.post("/api/v1/jewellery-ai/sessions").json()["id"]
    cleanup_intake.append(session_id)

    tight_settings = Settings(AI_RATE_LIMIT_PER_HOUR=1)
    app.dependency_overrides[get_settings] = lambda: tight_settings
    try:
        first = client.post(
            f"/api/v1/jewellery-ai/sessions/{session_id}/image",
            files={"file": ("photo.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
        assert first.status_code == 200
        second = client.post(
            f"/api/v1/jewellery-ai/sessions/{session_id}/image",
            files={"file": ("photo.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
        assert second.status_code == 429
    finally:
        app.dependency_overrides.pop(get_settings, None)
