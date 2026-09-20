"""
Catalogue API routes (Milestone 2 spec §17-19).

Read routes (list/get categories and jewellery) are public — a customer browsing the
catalogue needs no account. Every mutation (create/update category, create/update/
archive jewellery, upload/delete asset) requires `require_admin`. This is the
"authorization boundary" the spec asks for, built entirely on Milestone 1's JWT
primitives (see apps/api/core/auth_deps.py) — no parallel auth system.
"""
import logging
from uuid import UUID

import redis
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from ai.preprocessing.image_validation import ImageValidationError
from apps.api.core.auth_deps import require_admin
from apps.api.core.redis_client import get_redis_client
from apps.api.db.session import get_db
from apps.api.v1.schemas.asset import AssetResponse, AssetWithPreviewResponse
from apps.api.v1.schemas.category import (
    CategoryCreateRequest,
    CategoryResponse,
    CategoryUpdateRequest,
)
from apps.api.v1.schemas.jewellery import (
    JewelleryCreateRequest,
    JewelleryResponse,
    JewelleryUpdateRequest,
)
from apps.api.v1.schemas.pagination import Page, PageParams
from apps.api.v1.services import asset_service, category_service, jewellery_service
from db.models import User

logger = logging.getLogger("app.catalog")
router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])


def _category_response(category, item_count: int = 0) -> CategoryResponse:
    return CategoryResponse.model_validate(category).model_copy(update={"item_count": item_count})


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@router.get("/categories", response_model=list[CategoryResponse])
def list_categories(
    is_active: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[CategoryResponse]:
    rows = category_service.list_categories(db, is_active=is_active)
    return [_category_response(category, count) for category, count in rows]


@router.post("/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> CategoryResponse:
    try:
        category = category_service.create_category(db, payload)
    except category_service.CategorySlugAlreadyExistsError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A category with slug '{payload.slug}' already exists.",
        )
    return _category_response(category, item_count=0)


@router.patch("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: UUID,
    payload: CategoryUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> CategoryResponse:
    try:
        category = category_service.update_category(db, category_id, payload)
    except category_service.CategoryNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")
    return _category_response(category)


# ---------------------------------------------------------------------------
# Jewellery
# ---------------------------------------------------------------------------


@router.get("/jewellery", response_model=Page[JewelleryResponse])
def list_jewellery(
    category_id: UUID | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> Page[JewelleryResponse]:
    page_params = PageParams(page=page, page_size=page_size)
    items, total = jewellery_service.list_jewellery(
        db, page_params, category_id=category_id, is_active=is_active, search=search
    )
    return Page(
        items=[JewelleryResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/jewellery", response_model=JewelleryResponse, status_code=status.HTTP_201_CREATED)
def create_jewellery(
    payload: JewelleryCreateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> JewelleryResponse:
    try:
        item = jewellery_service.create_jewellery(db, payload)
    except jewellery_service.CategoryNotFoundForJewelleryError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")
    except jewellery_service.JewellerySkuAlreadyExistsError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"SKU '{payload.sku}' already exists."
        )
    except jewellery_service.JewellerySlugAlreadyExistsError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Slug '{payload.slug}' already exists."
        )
    except jewellery_service.ImplausiblePhysicalDimensionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return JewelleryResponse.model_validate(item)


@router.get("/jewellery/{jewellery_id}", response_model=JewelleryResponse)
def get_jewellery(jewellery_id: UUID, db: Session = Depends(get_db)) -> JewelleryResponse:
    try:
        item = jewellery_service.get_jewellery(db, jewellery_id)
    except jewellery_service.JewelleryNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jewellery not found.")
    return JewelleryResponse.model_validate(item)


@router.patch("/jewellery/{jewellery_id}", response_model=JewelleryResponse)
def update_jewellery(
    jewellery_id: UUID,
    payload: JewelleryUpdateRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> JewelleryResponse:
    try:
        item = jewellery_service.update_jewellery(db, jewellery_id, payload)
    except jewellery_service.JewelleryNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jewellery not found.")
    except jewellery_service.CategoryNotFoundForJewelleryError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")
    except jewellery_service.ImplausiblePhysicalDimensionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return JewelleryResponse.model_validate(item)


@router.delete("/jewellery/{jewellery_id}", response_model=JewelleryResponse)
def archive_jewellery(
    jewellery_id: UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> JewelleryResponse:
    """Soft-delete (is_active=False) — see Milestone 2 spec §17. Uses DELETE as the HTTP
    verb because that's the conventional REST mapping for "remove from the active
    catalogue," even though the underlying row is archived, not dropped."""
    try:
        item = jewellery_service.archive_jewellery(db, jewellery_id)
    except jewellery_service.JewelleryNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jewellery not found.")
    return JewelleryResponse.model_validate(item)


@router.delete("/jewellery/{jewellery_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
def delete_jewellery_permanently(
    jewellery_id: UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    """Genuinely removes the item (row, assets, and their storage files) — a separate,
    explicit, deliberately-chosen exception to this catalogue's normal archive-only
    policy (see jewellery_service.delete_jewellery_permanently's docstring for the
    real, dangerous side effect: this also deletes any saved try-on captures/renders
    for this item, via ON DELETE CASCADE). Distinct from the DELETE /jewellery/{id}
    route above, which only archives (is_active=False) and is the recommended path."""
    try:
        jewellery_service.delete_jewellery_permanently(db, jewellery_id)
    except jewellery_service.JewelleryNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jewellery not found.")


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------


@router.post(
    "/jewellery/{jewellery_id}/assets",
    response_model=list[AssetResponse],
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_jewellery_asset(
    jewellery_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    redis_client: redis.Redis = Depends(get_redis_client),
    _admin: User = Depends(require_admin),
) -> list[AssetResponse]:
    raw_bytes = await file.read()
    try:
        original, processed = asset_service.upload_original_asset(
            db, redis_client, jewellery_id, raw_bytes
        )
    except asset_service.JewelleryNotFoundForAssetError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jewellery not found.")
    except ImageValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return [AssetResponse.model_validate(original), AssetResponse.model_validate(processed)]


@router.get("/jewellery/{jewellery_id}/assets", response_model=list[AssetResponse])
def list_jewellery_assets(jewellery_id: UUID, db: Session = Depends(get_db)) -> list[AssetResponse]:
    assets = asset_service.list_assets_for_jewellery(db, jewellery_id)
    return [AssetResponse.model_validate(asset) for asset in assets]


@router.get("/assets/{asset_id}", response_model=AssetWithPreviewResponse)
def get_asset(asset_id: UUID, db: Session = Depends(get_db)) -> AssetWithPreviewResponse:
    try:
        return asset_service.get_asset_with_preview(db, asset_id)
    except asset_service.AssetNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    try:
        asset_service.delete_asset(db, asset_id)
    except asset_service.AssetNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")
