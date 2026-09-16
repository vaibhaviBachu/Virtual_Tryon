from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9_]+$")
    description: Optional[str] = None
    anchor_type: Optional[str] = Field(default=None, max_length=30)
    placement_config: dict[str, Any] = Field(default_factory=dict)


class CategoryUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None
    anchor_type: Optional[str] = Field(default=None, max_length=30)
    placement_config: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    description: Optional[str]
    anchor_type: Optional[str]
    placement_config: dict[str, Any]
    is_active: bool
    item_count: int = 0
    created_at: datetime
    updated_at: datetime
