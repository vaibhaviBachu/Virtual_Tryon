import os
import uuid

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:2003/jewellery_tryon")
os.environ.setdefault("REDIS_URL", "redis://localhost:2004/0")
os.environ.setdefault("MINIO_ENDPOINT", "localhost:2005")

import pytest


@pytest.fixture()
def unique_suffix() -> str:
    return uuid.uuid4().hex[:8]
