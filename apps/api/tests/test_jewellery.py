"""Jewellery item CRUD/pagination/filtering/authorization tests (Milestone 2 spec §17)."""
import pytest

from db.models import Jewellery, JewelleryCategory


@pytest.fixture()
def earrings_category_id(db_session):
    row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == "earrings").first()
    assert row is not None, "seed data missing: run the Milestone 2 migration first"
    return str(row.id)


def _cleanup_jewellery(db_session, jewellery_id):
    row = db_session.get(Jewellery, jewellery_id)
    if row:
        db_session.delete(row)
        db_session.commit()


def test_create_jewellery_requires_admin(customer_client, earrings_category_id, unique_suffix):
    response = customer_client.post(
        "/api/v1/catalog/jewellery",
        json={
            "category_id": earrings_category_id,
            "name": "Test Earring",
            "slug": f"test-earring-{unique_suffix}",
            "sku": f"SKU-{unique_suffix}",
        },
    )
    assert response.status_code == 403


def test_admin_can_create_jewellery_with_physical_dimensions(admin_client, db_session, earrings_category_id, unique_suffix):
    payload = {
        "category_id": earrings_category_id,
        "name": "Diamond Studs",
        "slug": f"diamond-studs-{unique_suffix}",
        "sku": f"SKU-{unique_suffix}",
        "physical_width_mm": 8.5,
        "physical_height_mm": 8.5,
        "physical_depth_mm": 4.0,
        "weight_g": 1.2,
    }
    response = admin_client.post("/api/v1/catalog/jewellery", json=payload)
    try:
        assert response.status_code == 201
        body = response.json()
        assert body["physical_width_mm"] == 8.5
        assert body["weight_g"] == 1.2
        assert body["category"]["slug"] == "earrings"
    finally:
        _cleanup_jewellery(db_session, response.json()["id"])


def test_create_jewellery_rejects_unknown_category(admin_client, unique_suffix):
    response = admin_client.post(
        "/api/v1/catalog/jewellery",
        json={
            "category_id": "00000000-0000-0000-0000-000000000000",
            "name": "Orphan Item",
            "slug": f"orphan-{unique_suffix}",
            "sku": f"SKU-{unique_suffix}",
        },
    )
    assert response.status_code == 404


def test_create_jewellery_rejects_duplicate_sku(admin_client, db_session, earrings_category_id, unique_suffix):
    sku = f"DUPSKU-{unique_suffix}"
    first = admin_client.post(
        "/api/v1/catalog/jewellery",
        json={"category_id": earrings_category_id, "name": "First", "slug": f"first-{unique_suffix}", "sku": sku},
    )
    try:
        assert first.status_code == 201
        second = admin_client.post(
            "/api/v1/catalog/jewellery",
            json={"category_id": earrings_category_id, "name": "Second", "slug": f"second-{unique_suffix}", "sku": sku},
        )
        assert second.status_code == 409
    finally:
        _cleanup_jewellery(db_session, first.json()["id"])


def test_create_jewellery_rejects_negative_price(admin_client, earrings_category_id, unique_suffix):
    response = admin_client.post(
        "/api/v1/catalog/jewellery",
        json={
            "category_id": earrings_category_id,
            "name": "Bad Price",
            "slug": f"bad-price-{unique_suffix}",
            "sku": f"SKU-{unique_suffix}",
            "price": -5,
        },
    )
    assert response.status_code == 422


def test_get_jewellery_by_id(client, admin_client, db_session, earrings_category_id, unique_suffix):
    created = admin_client.post(
        "/api/v1/catalog/jewellery",
        json={"category_id": earrings_category_id, "name": "Fetchable", "slug": f"fetchable-{unique_suffix}", "sku": f"SKU-{unique_suffix}"},
    )
    item_id = created.json()["id"]
    try:
        response = client.get(f"/api/v1/catalog/jewellery/{item_id}")
        assert response.status_code == 200
        assert response.json()["name"] == "Fetchable"
    finally:
        _cleanup_jewellery(db_session, item_id)


def test_get_unknown_jewellery_returns_404(client):
    response = client.get("/api/v1/catalog/jewellery/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


def test_archive_jewellery_is_soft_delete(admin_client, client, db_session, earrings_category_id, unique_suffix):
    created = admin_client.post(
        "/api/v1/catalog/jewellery",
        json={"category_id": earrings_category_id, "name": "Archive Me", "slug": f"archive-me-{unique_suffix}", "sku": f"SKU-{unique_suffix}"},
    )
    item_id = created.json()["id"]
    try:
        response = admin_client.delete(f"/api/v1/catalog/jewellery/{item_id}")
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # Row still exists (soft delete, not a hard delete) — confirms directly against
        # the database, not just the API's response body.
        row = db_session.get(Jewellery, item_id)
        assert row is not None
        assert row.is_active is False

        # Still fetchable by id (an admin/detail page must still be able to see it).
        fetched = client.get(f"/api/v1/catalog/jewellery/{item_id}")
        assert fetched.status_code == 200
    finally:
        _cleanup_jewellery(db_session, item_id)


def test_list_jewellery_pagination_and_filtering(admin_client, db_session, earrings_category_id, unique_suffix):
    created_ids = []
    try:
        for i in range(3):
            resp = admin_client.post(
                "/api/v1/catalog/jewellery",
                json={
                    "category_id": earrings_category_id,
                    "name": f"Pagination Item {unique_suffix}-{i}",
                    "slug": f"pagination-{unique_suffix}-{i}",
                    "sku": f"PAG-{unique_suffix}-{i}",
                },
            )
            assert resp.status_code == 201
            created_ids.append(resp.json()["id"])

        response = admin_client.get(
            "/api/v1/catalog/jewellery",
            params={"category_id": earrings_category_id, "search": f"pagination-{unique_suffix}"[:20], "page": 1, "page_size": 2},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["page"] == 1
        assert body["page_size"] == 2
        assert len(body["items"]) <= 2
    finally:
        for item_id in created_ids:
            _cleanup_jewellery(db_session, item_id)


def test_list_jewellery_search_matches_name_and_sku(admin_client, db_session, earrings_category_id, unique_suffix):
    resp = admin_client.post(
        "/api/v1/catalog/jewellery",
        json={
            "category_id": earrings_category_id,
            "name": f"Unmistakable Search Target {unique_suffix}",
            "slug": f"search-target-{unique_suffix}",
            "sku": f"SEARCHSKU-{unique_suffix}",
        },
    )
    item_id = resp.json()["id"]
    try:
        by_name = admin_client.get("/api/v1/catalog/jewellery", params={"search": f"unmistakable search target {unique_suffix}"})
        assert item_id in {item["id"] for item in by_name.json()["items"]}

        by_sku = admin_client.get("/api/v1/catalog/jewellery", params={"search": f"searchsku-{unique_suffix}"})
        assert item_id in {item["id"] for item in by_sku.json()["items"]}
    finally:
        _cleanup_jewellery(db_session, item_id)
