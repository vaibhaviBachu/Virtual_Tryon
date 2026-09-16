"""
Worker-side configuration. Deliberately separate from apps/api/core/config.py: the
worker is an independent process/deployable (docs/architecture.md — API and worker pools
scale independently) and must not import anything from `apps.api`. Both read the same
environment variables, so there is one source of truth for values, even though the
Settings classes are not shared code.
"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ENVIRONMENT: str = Field(default="development")
    LOG_LEVEL: str = Field(default="INFO")
    REDIS_URL: str = Field(default="redis://localhost:2004/0")
    DATABASE_URL: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:2003/jewellery_tryon"
    )
    MINIO_ENDPOINT: str = Field(default="localhost:2005")
    MINIO_ACCESS_KEY: str = Field(default="minioadmin")
    MINIO_SECRET_KEY: str = Field(default="minioadmin")
    MINIO_BUCKET: str = Field(default="jewellery-tryon")
    MINIO_SECURE: bool = Field(default=False)

    # Milestone 1: heartbeat only. Milestone 4+: actual job queue name(s).
    WORKER_PORT: int = Field(default=2007)
    HEARTBEAT_INTERVAL_SECONDS: float = Field(default=5.0)


@lru_cache
def get_worker_settings() -> WorkerSettings:
    return WorkerSettings()
