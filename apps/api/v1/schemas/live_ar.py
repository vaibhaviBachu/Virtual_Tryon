from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LiveArCaptureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    jewellery_id: UUID
    asset_id: Optional[UUID]
    category_slug: str
    mime_type: str
    width_px: Optional[int]
    height_px: Optional[int]
    file_size_bytes: Optional[int]
    created_at: datetime
    updated_at: datetime


class LiveArCaptureWithUrlResponse(LiveArCaptureResponse):
    """Never exposes `result_storage_key` (an internal storage path) -- only a
    short-lived signed URL, same rule as every other private asset in this codebase."""

    result_url: str
