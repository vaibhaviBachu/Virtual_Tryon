from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SessionCreateRequest(BaseModel):
    device_info: dict[str, Any] = Field(default_factory=dict)


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: Optional[UUID]
    created_at: datetime
    expires_at: Optional[datetime]


class UserImageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    mime_type: str
    capture_source: str
    original_width_px: Optional[int]
    original_height_px: Optional[int]
    normalized_width_px: Optional[int]
    normalized_height_px: Optional[int]
    file_size_bytes: Optional[int]
    created_at: datetime


class TryOnRequestCreateRequest(BaseModel):
    session_id: UUID
    user_image_id: UUID


class TryOnRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    user_image_id: UUID
    status: str
    error_message: Optional[str]
    confidence: Optional[dict[str, Any]]
    readiness: Optional[dict[str, Any]]
    metrics: Optional[dict[str, Any]]
    created_at: datetime
    queued_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class LandmarksResponse(BaseModel):
    face_landmarks: Optional[dict[str, Any]]
    hand_landmarks: Optional[dict[str, Any]]
    pose_landmarks: Optional[dict[str, Any]]


class SegmentationResponse(BaseModel):
    segmentation_summary: Optional[dict[str, Any]]
    mask_preview_url: Optional[str] = None


# --- Milestone 4: geometry try-on rendering ---


class CategoryOptionResponse(BaseModel):
    """Spec §26: "For Milestone 4 only expose Earrings and Necklaces as functional.
    Future categories may show as disabled but must not trigger unsupported
    rendering." `functional` is the one flag the frontend needs to gray out a category
    without hard-coding the slug list itself."""

    slug: str
    name: str
    functional: bool


class TryOnRenderCreateRequest(BaseModel):
    jewellery_id: UUID
    # Optional: the server picks the jewellery item's own ready processed asset when
    # omitted (spec §22: "do not let the client submit arbitrary image/object-storage
    # paths" — the client only ever names a catalogue ID, never a storage key).
    asset_id: Optional[UUID] = None


class TryOnRenderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    request_id: UUID
    jewellery_id: UUID
    asset_id: Optional[UUID]
    category_slug: str
    status: str
    error_code: Optional[str]
    error_message: Optional[str]
    # Signed, short-lived — never a permanent/public URL, never a raw storage key
    # (spec §24). None until the render is `ready`.
    result_image_url: Optional[str] = None
    created_at: datetime
    queued_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class TryOnRenderDebugResponse(BaseModel):
    """Internal/developer-only (spec §27) — gated by Settings.ENABLE_TRYON_DEBUG_VIZ in
    the router, never linked from the normal customer-facing render response."""

    placement_metadata: Optional[dict[str, Any]]
    debug_image_url: Optional[str] = None
