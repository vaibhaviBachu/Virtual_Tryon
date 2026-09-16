from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from apps.api.v1.schemas.category import CategoryResponse


class JewelleryCreateRequest(BaseModel):
    category_id: UUID
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=220, pattern=r"^[a-z0-9-]+$")
    description: Optional[str] = None
    sku: str = Field(min_length=1, max_length=64)
    price: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    physical_width_mm: Optional[float] = Field(default=None, gt=0)
    physical_height_mm: Optional[float] = Field(default=None, gt=0)
    physical_depth_mm: Optional[float] = Field(default=None, gt=0)
    weight_g: Optional[float] = Field(default=None, gt=0)
    extra_measurements: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class JewelleryUpdateRequest(BaseModel):
    category_id: Optional[UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    price: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    physical_width_mm: Optional[float] = Field(default=None, gt=0)
    physical_height_mm: Optional[float] = Field(default=None, gt=0)
    physical_depth_mm: Optional[float] = Field(default=None, gt=0)
    weight_g: Optional[float] = Field(default=None, gt=0)
    extra_measurements: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None


class JewelleryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID
    category: CategoryResponse
    name: str
    slug: str
    description: Optional[str]
    sku: str
    price: Optional[float]
    currency: Optional[str]
    physical_width_mm: Optional[float]
    physical_height_mm: Optional[float]
    physical_depth_mm: Optional[float]
    weight_g: Optional[float]
    extra_measurements: dict[str, Any]
    is_active: bool
    created_at: datetime
    updated_at: datetime
