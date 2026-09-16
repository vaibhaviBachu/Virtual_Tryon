"""Category business logic — kept out of the router per Milestone 1's
"no business logic in route functions" rule, extended here to Milestone 2's catalogue."""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from apps.api.v1.schemas.category import CategoryCreateRequest, CategoryUpdateRequest
from db.models import Jewellery, JewelleryCategory


class CategorySlugAlreadyExistsError(Exception):
    pass


class CategoryNotFoundError(Exception):
    pass


def create_category(db: Session, payload: CategoryCreateRequest) -> JewelleryCategory:
    existing = db.query(JewelleryCategory).filter(JewelleryCategory.slug == payload.slug).first()
    if existing is not None:
        raise CategorySlugAlreadyExistsError(payload.slug)

    category = JewelleryCategory(
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        anchor_type=payload.anchor_type,
        placement_config=payload.placement_config,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


def list_categories(
    db: Session, *, is_active: Optional[bool] = None
) -> list[tuple[JewelleryCategory, int]]:
    """Returns (category, item_count) pairs — item_count is computed here rather than
    via a lazy relationship count so listing categories never triggers N additional
    queries (Milestone 2 spec §32: "avoid unnecessary database queries")."""
    query = (
        select(JewelleryCategory, func.count(Jewellery.id))
        .outerjoin(Jewellery, Jewellery.category_id == JewelleryCategory.id)
        .group_by(JewelleryCategory.id)
        .order_by(JewelleryCategory.name)
    )
    if is_active is not None:
        query = query.where(JewelleryCategory.is_active == is_active)
    return [(row[0], row[1]) for row in db.execute(query).all()]


def get_category(db: Session, category_id: UUID) -> JewelleryCategory:
    category = db.get(JewelleryCategory, category_id)
    if category is None:
        raise CategoryNotFoundError(str(category_id))
    return category


def update_category(
    db: Session, category_id: UUID, payload: CategoryUpdateRequest
) -> JewelleryCategory:
    category = get_category(db, category_id)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category
