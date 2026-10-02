"""
Centralized, environment-driven application configuration.

Every configurable value (ports, URLs, secrets, CORS origins) MUST be read from here.
Nothing in the rest of the application should read `os.environ` directly or hard-code
a host/port/secret — this is the single source of truth described in docs/architecture.md.
"""
from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- General ---
    ENVIRONMENT: str = Field(default="development")
    APP_NAME: str = Field(default="jewellery-virtual-tryon-api")
    LOG_LEVEL: str = Field(default="INFO")

    # --- Ports (used by local tooling / uvicorn entrypoint; the container itself binds
    #     internally, but keeping the values here means nothing is hard-coded elsewhere) ---
    API_PORT: int = Field(default=2002)

    # --- Database ---
    DATABASE_URL: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:2003/jewellery_tryon"
    )

    # --- Redis ---
    REDIS_URL: str = Field(default="redis://localhost:2004/0")

    # --- Object storage (S3-compatible; MinIO locally) ---
    MINIO_ENDPOINT: str = Field(default="localhost:2005")
    MINIO_ACCESS_KEY: str = Field(default="minioadmin")
    MINIO_SECRET_KEY: str = Field(default="minioadmin")
    MINIO_BUCKET: str = Field(default="jewellery-tryon")
    MINIO_SECURE: bool = Field(default=False)
    # Host used ONLY when signing a URL handed back to the browser (asset previews,
    # try-on results, segmentation/debug images) — MINIO_ENDPOINT above is the
    # Docker-internal hostname (`minio:9000`) apps/api itself uses to reach storage,
    # which the user's browser cannot resolve. Defaults to MINIO_ENDPOINT so native/
    # single-process/test setups (no internal-vs-host split) are unaffected; Docker
    # Compose overrides this to the host-mapped MinIO port (see docker-compose.yml).
    # See storage/s3_storage.py's module docstring for the full root-cause writeup.
    MINIO_PUBLIC_ENDPOINT: str = Field(default="")
    MINIO_PUBLIC_SECURE: bool = Field(default=False)

    # --- JWT / auth (architecture ready; not enforced on any route in Milestone 1) ---
    JWT_SECRET_KEY: str = Field(default="change-me-in-every-non-local-environment")
    JWT_ALGORITHM: str = Field(default="HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30)
    JWT_REFRESH_TOKEN_EXPIRE_MINUTES: int = Field(default=60 * 24 * 7)

    # --- CORS ---
    CORS_ALLOWED_ORIGINS: str = Field(default="http://localhost:2001")

    # --- Milestone 4: geometry try-on debug visualization (spec §27) ---
    # Gates GET /api/v1/tryon/renders/{id}/debug, which returns placement anchors/
    # bounding boxes/scale/rotation and a signed URL to the annotated debug image.
    # Defaults on for development/test so it can be exercised, but must be turned off
    # (set False) in any real production deployment — it is explicitly NOT meant for
    # normal customers (spec §27: "do not expose to normal customers").
    ENABLE_TRYON_DEBUG_VIZ: bool = Field(default=True)

    # --- AI Jewellery Assistant ---
    # Server-side only -- NEVER exposed to the frontend (no NEXT_PUBLIC_ equivalent of
    # this exists anywhere, by design). Empty string (the default) means "not
    # configured yet"; every call site must check for that and return a clean
    # "AI service is not configured" response rather than attempting the network call
    # with an empty key. The real key is added directly in Render/the local .env later
    # -- never requested or hard-coded during implementation.
    AI_API_KEY: str = Field(default="")
    AI_IMAGE_PROVIDER: str = Field(default="openai")
    AI_IMAGE_MODEL: str = Field(default="")
    AI_TEXT_PROVIDER: str = Field(default="openai")
    AI_TEXT_MODEL: str = Field(default="")
    # Separate key (not AI_API_KEY) because this is a genuinely different provider with
    # its own account/credentials -- set AI_IMAGE_PROVIDER/AI_TEXT_PROVIDER to "gemini"
    # to actually use it (see ai/jewellery_assistant/providers/factory.py).
    GEMINI_API_KEY: str = Field(default="")
    # One upload should cost at most one image-generation call; this bounds explicit
    # customer-initiated regenerations on top of that (spec: cost control).
    AI_MAX_GENERATIONS_PER_ITEM: int = Field(default=3)
    AI_MAX_UPLOAD_MB: int = Field(default=10)
    # Requests per hour per client IP across the assistant's image/metadata/regenerate
    # endpoints (apps/api/core/redis_client.py) -- the first rate-limiting code in this
    # codebase; see apps/api/v1/services/jewellery_ai_service.py for where it's enforced.
    AI_RATE_LIMIT_PER_HOUR: int = Field(default=20)

    @field_validator("ENVIRONMENT")
    @classmethod
    def _validate_environment(cls, value: str) -> str:
        allowed = {"development", "staging", "production", "test"}
        if value not in allowed:
            raise ValueError(f"ENVIRONMENT must be one of {allowed}, got {value!r}")
        return value

    @property
    def cors_allowed_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


@lru_cache
def get_settings() -> Settings:
    """Settings are cached for the process lifetime; tests override via dependency_overrides
    or by constructing Settings() directly rather than mutating this cache."""
    return Settings()
