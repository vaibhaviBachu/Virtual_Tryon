"""Category CRUD + authorization tests (Milestone 2 spec §17-18)."""
from db.models import JewelleryCategory


def test_list_categories_is_public_and_returns_the_nine_seeded_categories(client):
    response = client.get("/api/v1/catalog/categories")
    assert response.status_code == 200
    slugs = {c["slug"] for c in response.json()}
    # Subset, not exact-equality: an admin may have created additional categories (that
    # is the whole point of the database-driven category system) — what matters is that
    # the nine required seed categories are all present.
    assert slugs >= {
        "earrings",
        "necklace",
        "haaram",
        "bangles",
        "bracelet",
        "ring",
        "maang_tikka",
        "nose_ring",
        "jewellery_set",
    }


def test_create_category_requires_authentication(client, unique_suffix):
    response = client.post(
        "/api/v1/catalog/categories", json={"name": "Anklet", "slug": f"anklet_{unique_suffix}"}
    )
    assert response.status_code == 401


def test_create_category_requires_admin_role(customer_client, unique_suffix):
    response = customer_client.post(
        "/api/v1/catalog/categories", json={"name": "Anklet", "slug": f"anklet_{unique_suffix}"}
    )
    assert response.status_code == 403


def test_admin_can_create_category(admin_client, db_session, unique_suffix):
    slug = f"anklet_{unique_suffix}"
    try:
        response = admin_client.post(
            "/api/v1/catalog/categories", json={"name": "Anklet", "slug": slug, "anchor_type": "ankle"}
        )
        assert response.status_code == 201
        body = response.json()
        assert body["slug"] == slug
        assert body["is_active"] is True
        assert body["item_count"] == 0
    finally:
        row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == slug).first()
        if row:
            db_session.delete(row)
            db_session.commit()


def test_create_category_rejects_duplicate_slug(admin_client, db_session, unique_suffix):
    slug = f"dup_{unique_suffix}"
    try:
        first = admin_client.post("/api/v1/catalog/categories", json={"name": "First", "slug": slug})
        assert first.status_code == 201
        second = admin_client.post("/api/v1/catalog/categories", json={"name": "Second", "slug": slug})
        assert second.status_code == 409
    finally:
        row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == slug).first()
        if row:
            db_session.delete(row)
            db_session.commit()


def test_create_category_rejects_invalid_slug_format(admin_client):
    response = admin_client.post(
        "/api/v1/catalog/categories", json={"name": "Bad Slug", "slug": "Not A Valid Slug!"}
    )
    assert response.status_code == 422


def test_admin_can_deactivate_category(admin_client, db_session, unique_suffix):
    slug = f"deactivate_{unique_suffix}"
    created = admin_client.post("/api/v1/catalog/categories", json={"name": "Deactivate Me", "slug": slug})
    category_id = created.json()["id"]
    try:
        response = admin_client.patch(
            f"/api/v1/catalog/categories/{category_id}", json={"is_active": False}
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        listed = client_list_active_only(admin_client)
        assert slug not in {c["slug"] for c in listed}
    finally:
        row = db_session.query(JewelleryCategory).filter(JewelleryCategory.slug == slug).first()
        if row:
            db_session.delete(row)
            db_session.commit()


def client_list_active_only(client):
    return client.get("/api/v1/catalog/categories", params={"is_active": True}).json()


def test_update_unknown_category_returns_404(admin_client):
    response = admin_client.patch(
        "/api/v1/catalog/categories/00000000-0000-0000-0000-000000000000", json={"is_active": False}
    )
    assert response.status_code == 404
