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
