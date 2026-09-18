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
    # Milestone 4 geometry-try-on anchor metadata (db.models.JewelleryAsset columns
    # added by the 20260919_0004 migration) was computed and stored from the start, but
    # never reached the API response -- the old server-side render pipeline only ever
    # needed it inside the worker (ai.geometry.asset_geometry reads it directly off the
    # ORM row). Milestone 5's Live AR client renders in the browser with no server-side
    # render step in the loop, so it needs this same calibration data itself to run the
    # identical anchor/scale math client-side (see docs/live-ar-architecture.md). This
    # is an additive response-schema change only -- no new columns, no migration.
    anchor_x: Optional[float] = None
    anchor_y: Optional[float] = None
    attachment_point: Optional[str] = None
    mirrorable: bool = False
    created_at: datetime
    updated_at: datetime


class AssetWithPreviewResponse(AssetResponse):
    # Signed, short-lived — never a permanent/public URL. Generated on demand by the
    # service layer, never stored, per docs/production-readiness.md.
    preview_url: Optional[str] = None
