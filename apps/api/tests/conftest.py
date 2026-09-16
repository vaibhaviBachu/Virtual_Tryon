import os

# Ensure sane, non-committed defaults are present before Settings() is constructed by
# any import chain triggered by the tests below. Real environments supply these via
# docker-compose / .env; CI/test runs use these safe local fallbacks.
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:2003/jewellery_tryon")
os.environ.setdefault("REDIS_URL", "redis://localhost:2004/0")
os.environ.setdefault("MINIO_ENDPOINT", "localhost:2005")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key")

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)
