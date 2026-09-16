"""
Auth endpoint tests (Milestone 2 spec's minimal login/me scope, built on Milestone 1's
JWT primitives). Runs against the real Postgres database via `db_session`/`admin_user`.
"""


def test_login_with_correct_credentials_returns_token(client, db_session, unique_suffix):
    from apps.api.core.security import hash_password
    from db.models import User, UserRole

    email = f"login-test-{unique_suffix}@example.com"
    user = User(email=email, password_hash=hash_password("correct-password"), role=UserRole.customer)
    db_session.add(user)
    db_session.commit()
    try:
        response = client.post("/api/v1/auth/login", json={"email": email, "password": "correct-password"})
        assert response.status_code == 200
        body = response.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
    finally:
        db_session.delete(db_session.get(User, user.id))
        db_session.commit()


def test_login_with_wrong_password_is_rejected(client, db_session, unique_suffix):
    from apps.api.core.security import hash_password
    from db.models import User, UserRole

    email = f"login-wrong-{unique_suffix}@example.com"
    user = User(email=email, password_hash=hash_password("correct-password"), role=UserRole.customer)
    db_session.add(user)
    db_session.commit()
    try:
        response = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
        assert response.status_code == 401
    finally:
        db_session.delete(db_session.get(User, user.id))
        db_session.commit()


def test_login_with_unknown_email_is_rejected(client):
    response = client.post(
        "/api/v1/auth/login", json={"email": "does-not-exist@example.com", "password": "whatever"}
    )
    assert response.status_code == 401


def test_me_requires_authentication(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_me_returns_current_user(admin_client, admin_user):
    response = admin_client.get("/api/v1/auth/me")
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == admin_user.email
    assert body["role"] == "admin"


def test_me_rejects_garbage_token(client):
    response = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401
