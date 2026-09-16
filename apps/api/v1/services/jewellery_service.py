"""Jewellery item business logic. Soft-delete only (is_active flag) — Milestone 2 spec
§17 explicitly prefers archive semantics over destructive delete for catalogue items."""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from apps.api.v1.schemas.jewellery import JewelleryCreateRequest, JewelleryUpdateRequest
from apps.api.v1.schemas.pagination import PageParams
from db.models import Jewellery, JewelleryCategory


class JewellerySkuAlreadyExistsError(Exception):
    pass


class JewellerySlugAlreadyExistsError(Exception):
    pass


class JewelleryNotFoundError(Exception):
    pass


class CategoryNotFoundForJewelleryError(Exception):
    pass


def create_jewellery(db: Session, payload: JewelleryCreateRequest) -> Jewellery:
    if db.get(JewelleryCategory, payload.category_id) is None:
        raise CategoryNotFoundForJewelleryError(str(payload.category_id))
    if db.query(Jewellery).filter(Jewellery.sku == payload.sku).first() is not None:
        raise JewellerySkuAlreadyExistsError(payload.sku)
    if db.query(Jewellery).filter(Jewellery.slug == payload.slug).first() is not None:
        raise JewellerySlugAlreadyExistsError(payload.slug)

    item = Jewellery(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def get_jewellery(db: Session, jewellery_id: UUID) -> Jewellery:
    item = db.get(Jewellery, jewellery_id)
    if item is None:
        raise JewelleryNotFoundError(str(jewellery_id))
    return item


def update_jewellery(db: Session, jewellery_id: UUID, payload: JewelleryUpdateRequest) -> Jewellery:
    item = get_jewellery(db, jewellery_id)
    updates = payload.model_dump(exclude_unset=True)
    if "category_id" in updates and db.get(JewelleryCategory, updates["category_id"]) is None:
        raise CategoryNotFoundForJewelleryError(str(updates["category_id"]))
    for field, value in updates.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


def archive_jewellery(db: Session, jewellery_id: UUID) -> Jewellery:
    """Soft-delete: sets is_active=False. Nothing is ever hard-deleted from the
    jewellery table via the API — see Milestone 2 spec §17."""
    item = get_jewellery(db, jewellery_id)
    item.is_active = False
    db.commit()
    db.refresh(item)
    return item


def list_jewellery(
    db: Session,
    page_params: PageParams,
    *,
    category_id: Optional[UUID] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
) -> tuple[list[Jewellery], int]:
    filters = []
    if category_id is not None:
        filters.append(Jewellery.category_id == category_id)
    if is_active is not None:
        filters.append(Jewellery.is_active == is_active)
    if search:
        pattern = f"%{search.lower()}%"
        filters.append(or_(func.lower(Jewellery.name).like(pattern), func.lower(Jewellery.sku).like(pattern)))

    count_query = select(func.count()).select_from(Jewellery)
    query = select(Jewellery)
    for condition in filters:
        count_query = count_query.where(condition)
        query = query.where(condition)

    total = db.execute(count_query).scalar_one()
    query = query.order_by(Jewellery.created_at.desc()).offset(page_params.offset).limit(
        page_params.page_size
    )
    items = list(db.execute(query).scalars().all())
    return items, total
