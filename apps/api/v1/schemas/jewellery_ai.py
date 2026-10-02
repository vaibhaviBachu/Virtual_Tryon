from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class IntakeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: str
    content_hash: Optional[str] = None
    original_preview_url: Optional[str] = None
    prepared_preview_url: Optional[str] = None
    ai_image_enhanced: bool
    # "not_configured" | "failed" | "rejected" | "success" -- see
    # apps/api/v1/services/jewellery_ai_service.py::ImagePreparationOutcome.
    image_preparation_status: str = "not_configured"
    image_generation_attempts: int
    suggested_metadata: dict[str, Any]
    user_metadata: dict[str, Any]
    duplicate_of_jewellery_id: Optional[UUID] = None
    jewellery_id: Optional[UUID] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MetadataUpdateRequest(BaseModel):
    """Every field optional -- a PATCH only updates the fields it includes. Editing any
    of these must never trigger another AI call (spec: changing a field like width
    120 -> 125 must not call the LLM); this is a plain DB merge, enforced by the service
    never calling a provider from this path."""

    name: Optional[str] = Field(default=None, max_length=200)
    category_slug: Optional[str] = None
    size: Optional[str] = Field(default=None, pattern=r"^(Small|Medium|Large)$")
    style: Optional[str] = Field(default=None, max_length=60)
    material: Optional[str] = Field(default=None, max_length=60)
    stone: Optional[str] = Field(default=None, max_length=60)
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    # Physical dimensions are never AI-suggested (spec: "DO NOT invent physical
    # dimensions from an image") -- only ever set here, by the customer.
    physical_width_mm: Optional[float] = Field(default=None, gt=0)
    physical_height_mm: Optional[float] = Field(default=None, gt=0)
    physical_depth_mm: Optional[float] = Field(default=None, gt=0)
    weight_g: Optional[float] = Field(default=None, gt=0)


class SubmitResponse(BaseModel):
    intake: IntakeResponse
    jewellery_id: UUID
