from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AssetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    jewellery_id: UUID
    asset_type: str
    mime_type: Optional[str]
    width_px: Optional[int]
    height_px: Optional[int]
    file_size_bytes: Optional[int]
    processing_status: str
    processing_error: Optional[str]
    created_at: datetime
    updated_at: datetime


class AssetWithPreviewResponse(AssetResponse):
    # Signed, short-lived — never a permanent/public URL. Generated on demand by the
    # service layer, never stored, per docs/production-readiness.md.
    preview_url: Optional[str] = None
