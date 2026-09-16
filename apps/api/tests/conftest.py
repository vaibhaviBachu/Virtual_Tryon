import os

# Ensure sane, non-committed defaults are present before Settings() is constructed by
# any import chain triggered by the tests below. Real environments supply these via
# docker-compose / .env; CI/test runs use these safe local fallbacks.
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:2003/jewellery_tryon")
os.environ.setdefault("REDIS_URL", "redis://localhost:2004/0")
os.environ.setdefault("MINIO_ENDPOINT", "localhost:2005")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key")

import uuid

import fakeredis
import pytest
from fastapi.testclient import TestClient

from apps.api.core.auth_deps import get_current_user, require_admin
from apps.api.core.redis_client import get_redis_client
from apps.api.db.session import SessionLocal, get_db
from apps.api.main import app
from apps.api.core.security import hash_password
from db.models import User, UserRole


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def db_session():
    """A real session against the real (locally running) Postgres database that the
    Milestone 2 migration has been applied to — Milestone 1's own testing philosophy
    (docs/development.md) prefers real dependencies over mocks wherever practical.
    Tests are responsible for cleaning up rows they create (most use a unique uuid
    suffix in slugs/skus/emails precisely so parallel/repeated runs never collide)."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def fake_redis_client():
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture()
def unique_suffix() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def admin_user(db_session, unique_suffix):
    """Creates a real admin User row and returns it. Cleaned up after the test."""
    user = User(
        email=f"admin-{unique_suffix}@example.com",
        password_hash=hash_password("test-password-123"),
        role=UserRole.admin,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    yield user
    db_session.delete(db_session.get(User, user.id))
    db_session.commit()


@pytest.fixture()
def customer_user(db_session, unique_suffix):
    user = User(
        email=f"customer-{unique_suffix}@example.com",
        password_hash=hash_password("test-password-123"),
        role=UserRole.customer,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    yield user
    db_session.delete(db_session.get(User, user.id))
    db_session.commit()


@pytest.fixture()
def admin_client(admin_user):
    """A TestClient authenticated as an admin by overriding only `get_current_user` —
    `require_admin`'s own role check (see apps/api/core/auth_deps.py) still runs for
    real on every request, so this fixture proves the real authorization logic passes
    an actual admin, not that the check was bypassed."""
    app.dependency_overrides[get_current_user] = lambda: admin_user
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def customer_client(customer_user):
    """A TestClient authenticated as a non-admin — `require_admin`'s real role check
    still runs, so this proves it actually rejects (403) a genuine non-admin user
    rather than the test faking a 403."""
    app.dependency_overrides[get_current_user] = lambda: customer_user
    client = TestClient(app)
    yield client
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def client_with_fake_redis(fake_redis_client):
    app.dependency_overrides[get_redis_client] = lambda: fake_redis_client
    client = TestClient(app)
    yield client, fake_redis_client
    app.dependency_overrides.pop(get_redis_client, None)
