from typing import Dict

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str


class ReadinessCheck(BaseModel):
    database: bool
    redis: bool
    object_storage: bool


class ReadinessResponse(BaseModel):
    status: str
    checks: Dict[str, bool]
