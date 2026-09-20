"""Jewellery item business logic. Milestone 2 spec §17 prefers archive semantics
(is_active flag, see archive_jewellery below) over destructive delete for catalogue
items, and that remains the default/recommended path. delete_jewellery_permanently
exists alongside it as an explicit, deliberately-chosen exception for an admin who
wants a real removal — see that function's own docstring for what it actually does
and why it's dangerous (jewellery_id has ON DELETE CASCADE from both
live_ar_captures and tryon_renders — see db/models/live_ar.py and db/models/tryon.py
— so this silently deletes a customer's saved captures/renders too, not just the
catalogue entry)."""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from apps.api.storage.s3_storage import get_object_storage
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


class ImplausiblePhysicalDimensionError(Exception):
    """Raised when physical_width_mm/physical_height_mm is outside a documented,
    real-world-plausible range for the item's category. See
    _PHYSICAL_WIDTH_MM_RANGE_BY_CATEGORY's docstring below for why this exists."""


# Sanity bounds for physical_width_mm, keyed by category slug. Deliberately NOT
# imported from ai/geometry/constants.py (apps/api must not depend on ai.geometry —
# see docs/architecture.md's "apps/api never contains CV/geometry code" rule); this is
# independent, catalogue-data-entry-time validation, not rendering math.
#
# Exists because of a real Milestone 4 runtime bug, reproduced directly: an admin can
# accidentally enter a catalogue item's physical width in the wrong unit (typing "5"
# meaning 5cm, or a chain/drop length instead of the necklace's own width) and
# ai.geometry.scale's physical-dimensions calibration path (see that module's
# docstring) will compute an almost-invisible target width. MIN_SCALE_FACTOR's safety
# clamp (ai/geometry/constants.py, 0.03) still lets the render "succeed" — just at a
# few pixels wide, which looks indistinguishable from no jewellery having been
# rendered at all. Confirmed with evaluation.debug_necklace against a controlled test
# render: the SAME asset produced 1224 changed pixels at physical_width_mm=180 (a
# plausible real value) versus only 5-7 changed pixels at physical_width_mm=5 or 15.
#
# Ranges are deliberately generous (real adult jewellery sizes span these), not tuned
# to make any specific item pass — a legitimate future item outside these bounds
# should widen this documented range, not bypass it silently.
_PHYSICAL_WIDTH_MM_RANGE_BY_CATEGORY = {
    "necklace": (30.0, 600.0),
    "earrings": (3.0, 150.0),
}


def _validate_physical_dimensions(category_slug: Optional[str], width_mm: Optional[float]) -> None:
    if category_slug is None or width_mm is None:
        return
    bounds = _PHYSICAL_WIDTH_MM_RANGE_BY_CATEGORY.get(category_slug)
    if bounds is None:
        return
    low, high = bounds
    if not (low <= width_mm <= high):
        raise ImplausiblePhysicalDimensionError(
            f"physical_width_mm={width_mm} is outside the plausible range for "
            f"category '{category_slug}' ({low}-{high}mm). Enter the item's real "
            "width in MILLIMETERS (not centimeters or inches) — an implausibly small "
            "value will render the jewellery at only a few pixels wide, which looks "
            "identical to no jewellery being rendered at all."
        )


def create_jewellery(db: Session, payload: JewelleryCreateRequest) -> Jewellery:
    category = db.get(JewelleryCategory, payload.category_id)
    if category is None:
        raise CategoryNotFoundForJewelleryError(str(payload.category_id))
    if db.query(Jewellery).filter(Jewellery.sku == payload.sku).first() is not None:
        raise JewellerySkuAlreadyExistsError(payload.sku)
    if db.query(Jewellery).filter(Jewellery.slug == payload.slug).first() is not None:
        raise JewellerySlugAlreadyExistsError(payload.slug)
    _validate_physical_dimensions(category.slug, payload.physical_width_mm)

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
    new_category = None
    if "category_id" in updates:
        new_category = db.get(JewelleryCategory, updates["category_id"])
        if new_category is None:
            raise CategoryNotFoundForJewelleryError(str(updates["category_id"]))

    if "physical_width_mm" in updates:
        effective_category = new_category or item.category
        effective_category_slug = effective_category.slug if effective_category else None
        _validate_physical_dimensions(effective_category_slug, updates["physical_width_mm"])

    for field, value in updates.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


def archive_jewellery(db: Session, jewellery_id: UUID) -> Jewellery:
    """Soft-delete: sets is_active=False. This is the DEFAULT/recommended way to
    remove an item from the active catalogue — see Milestone 2 spec §17 and
    delete_jewellery_permanently's docstring for why the alternative is dangerous."""
    item = get_jewellery(db, jewellery_id)
    item.is_active = False
    db.commit()
    db.refresh(item)
    return item


def delete_jewellery_permanently(db: Session, jewellery_id: UUID) -> None:
    """Genuinely removes the jewellery row, its asset rows, and their underlying
    object-storage files. An explicit exception to this module's normal archive-only
    policy — call only when an admin has deliberately asked for irreversible removal,
    never as a default.

    DANGEROUS SIDE EFFECT, not just "deletes the catalogue entry": jewellery_id has
    ON DELETE CASCADE from both live_ar_captures and tryon_renders (db/models/live_ar.py,
    db/models/tryon.py) — the database itself will cascade-delete any saved try-on
    captures/renders that reference this item the moment this row is deleted. There is
    no way to delete the jewellery without also losing those.
    """
    item = get_jewellery(db, jewellery_id)
    deletable_keys = [a.storage_key for a in item.assets if not a.storage_key.startswith("pending/")]
    if deletable_keys:
        # Constructed lazily, only when there's actually something to delete — an item
        # with no uploaded assets yet (or none past the pending placeholder) never
        # touches object storage at all.
        storage = get_object_storage()
        for key in deletable_keys:
            storage.delete(key)
    db.delete(item)  # cascades to JewelleryAsset rows (see the ORM relationship's
    # cascade="all, delete-orphan" in db/models/jewellery.py) and, at the database
    # level, to live_ar_captures/tryon_renders rows referencing this item.
    db.commit()


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
