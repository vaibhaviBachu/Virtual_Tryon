"""
AI Jewellery Assistant orchestration.

Owns the `JewelleryAIIntake` session lifecycle (upload -> prepare image -> suggest
metadata -> customer edits -> submit) and, at submit time, hands off to the EXACT same
service functions the admin catalogue UI uses (`jewellery_service.create_jewellery`,
`asset_service.upload_original_asset`) -- see that module's docstring for why: this
guarantees the existing worker (background removal, processed/thumbnail generation)
picks the result up identically, with no second processing path to maintain.

No endpoint here requires authentication (apps/api/core/auth_deps.py's
`require_admin`/`get_current_user`) -- this is a deliberate product decision, not an
oversight: the feature's whole premise (spec) is a customer self-service flow with no
login step anywhere in it. The mitigation for that being a public write path into the
catalogue is apps/api/core/rate_limit.py, enforced by the router on every
AI-cost-incurring endpoint.
"""
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from ai.jewellery_assistant.dedupe import sha256_hex
from ai.jewellery_assistant.image_pipeline import looks_like_isolated_product_photo, make_catalogue_preview
from ai.jewellery_assistant.providers.base import (
    AIServiceError,
    AIServiceNotConfiguredError,
    ImageGenerationProvider,
    MetadataLLMProvider,
)
from ai.preprocessing.image_validation import ImageValidationError, validate_and_normalize_upload
from apps.api.core.config import Settings
from apps.api.storage.s3_storage import get_object_storage
from apps.api.v1.schemas.jewellery import JewelleryCreateRequest
from apps.api.v1.services import asset_service, jewellery_service
from db.models import IntakeStatus, Jewellery, JewelleryAIIntake, JewelleryCategory
from storage.keys import jewellery_ai_intake_key

logger = logging.getLogger("app.jewellery_ai")

SIGNED_URL_EXPIRY_SECONDS = 15 * 60


class IntakeNotFoundError(Exception):
    pass


class InvalidCategoryError(Exception):
    pass


class MissingRequiredFieldError(Exception):
    pass


def create_session(db: Session) -> JewelleryAIIntake:
    intake = JewelleryAIIntake(status=IntakeStatus.created)
    db.add(intake)
    db.commit()
    db.refresh(intake)
    return intake


def get_session(db: Session, intake_id: UUID) -> JewelleryAIIntake:
    intake = db.get(JewelleryAIIntake, intake_id)
    if intake is None:
        raise IntakeNotFoundError(str(intake_id))
    return intake


def _find_duplicate(db: Session, content_hash: str, *, exclude_intake_id: UUID) -> Optional[JewelleryAIIntake]:
    return (
        db.query(JewelleryAIIntake)
        .filter(
            JewelleryAIIntake.content_hash == content_hash,
            JewelleryAIIntake.id != exclude_intake_id,
            JewelleryAIIntake.jewellery_id.isnot(None),
        )
        .order_by(JewelleryAIIntake.created_at.desc())
        .first()
    )


def process_image(
    db: Session,
    intake_id: UUID,
    raw_bytes: bytes,
    *,
    image_provider: ImageGenerationProvider,
) -> JewelleryAIIntake:
    """Validates + stores the customer's upload, then produces the best available
    full-resolution "prepared" image: an AI-cleaned version if `image_provider` is
    configured, otherwise the deterministically-validated original unchanged -- either
    way followed by a deterministic 200x200 white-background preview of whichever one
    won, for the chat UI's before/after comparison. Raises ImageValidationError (safe to
    surface as-is) or IntakeNotFoundError."""
    intake = get_session(db, intake_id)

    validated = validate_and_normalize_upload(raw_bytes)  # raises ImageValidationError
    content_hash = sha256_hex(raw_bytes)
    duplicate = _find_duplicate(db, content_hash, exclude_intake_id=intake_id)

    storage = get_object_storage()
    original_key = jewellery_ai_intake_key(intake_id, "original", validated.mime_type)
    storage.upload(original_key, _bytes_io(validated.content), content_type=validated.mime_type)

    outcome = _run_image_provider_or_fallback(image_provider, validated.content, validated.mime_type)

    catalogue_key = jewellery_ai_intake_key(intake_id, "catalogue", outcome.mime_type)
    storage.upload(catalogue_key, _bytes_io(outcome.image_bytes), content_type=outcome.mime_type)

    preview = make_catalogue_preview(outcome.image_bytes)  # raises ImagePreparationError
    thumbnail_key = jewellery_ai_intake_key(intake_id, "thumbnail", "image/png")
    storage.upload(thumbnail_key, _bytes_io(preview.png_bytes), content_type="image/png")

    intake.content_hash = content_hash
    intake.original_storage_key = original_key
    intake.original_mime_type = validated.mime_type
    intake.catalogue_image_storage_key = catalogue_key
    intake.thumbnail_storage_key = thumbnail_key
    intake.ai_image_enhanced = outcome.ai_enhanced
    intake.image_preparation_status = outcome.status
    intake.image_generation_attempts = 1 if outcome.status != "not_configured" else 0
    intake.duplicate_of_jewellery_id = duplicate.jewellery_id if duplicate else None
    intake.status = IntakeStatus.image_ready
    db.commit()
    db.refresh(intake)
    return intake


def regenerate_image(
    db: Session, intake_id: UUID, *, image_provider: ImageGenerationProvider, max_attempts: int
) -> JewelleryAIIntake:
    """Re-runs ONLY the AI image step, from the ORIGINAL upload (never from a previous
    AI output -- re-editing an already-edited image compounds drift away from the real
    jewellery). Bounded by max_attempts (AI_MAX_GENERATIONS_PER_ITEM) for cost
    control."""
    intake = get_session(db, intake_id)
    if intake.original_storage_key is None:
        raise MissingRequiredFieldError("No image has been uploaded yet.")
    if intake.image_generation_attempts >= max_attempts:
        raise AIServiceError(
            f"You've reached the maximum of {max_attempts} regeneration attempts for this item."
        )

    storage = get_object_storage()
    original_bytes = storage.download(intake.original_storage_key)
    # Category may already be known by regenerate time (the customer could have gone
    # on to the details step and come back) -- pass it through as a hint when so.
    category = (intake.user_metadata or {}).get("category_slug")
    outcome = _run_image_provider_or_fallback(
        image_provider, original_bytes, intake.original_mime_type or "image/png", category=category
    )

    catalogue_key = jewellery_ai_intake_key(intake_id, "catalogue", outcome.mime_type)
    storage.upload(catalogue_key, _bytes_io(outcome.image_bytes), content_type=outcome.mime_type)
    preview = make_catalogue_preview(outcome.image_bytes)
    thumbnail_key = jewellery_ai_intake_key(intake_id, "thumbnail", "image/png")
    storage.upload(thumbnail_key, _bytes_io(preview.png_bytes), content_type="image/png")

    intake.catalogue_image_storage_key = catalogue_key
    intake.thumbnail_storage_key = thumbnail_key
    intake.ai_image_enhanced = outcome.ai_enhanced
    intake.image_preparation_status = outcome.status
    intake.image_generation_attempts += 1
    db.commit()
    db.refresh(intake)
    return intake


@dataclass
class ImagePreparationOutcome:
    image_bytes: bytes
    mime_type: str
    ai_enhanced: bool
    # One of "not_configured" | "failed" | "rejected" | "success" -- distinct from
    # ai_enhanced (a plain bool) so the API/frontend can tell the customer the real
    # reason the photo wasn't AI-prepared, instead of a single generic fallback that
    # looks identical whether AI was never configured, errored out, or ran but produced
    # something that still isn't an isolated product photo. Found to matter via real
    # user confusion: a silent fallback to the unedited original (full photo, person and
    # all) looked exactly like "AI did nothing," indistinguishable from "AI isn't set
    # up," when it could just as easily have been "AI ran and failed" or "AI ran but the
    # result didn't pass validation."
    status: str


def _run_image_provider_or_fallback(
    image_provider: ImageGenerationProvider,
    image_bytes: bytes,
    mime_type: str,
    *,
    category: Optional[str] = None,
) -> ImagePreparationOutcome:
    """Falls back to the deterministically-validated input unchanged whenever the AI
    provider isn't configured, errors, or returns something that fails the
    looks_like_isolated_product_photo sanity check (ai/jewellery_assistant/
    image_pipeline.py) -- i.e. still looks like the original un-isolated photo rather
    than an isolated product shot on white. `category` is None on the first upload
    (unknown at that point in the flow) and may be set on a later regenerate call."""
    try:
        result = image_provider.prepare_catalogue_image(image_bytes, mime_type, category=category)
    except AIServiceNotConfiguredError:
        return ImagePreparationOutcome(image_bytes, mime_type, False, "not_configured")
    except AIServiceError:
        logger.warning("AI image preparation failed; falling back to the unedited photo", exc_info=True)
        return ImagePreparationOutcome(image_bytes, mime_type, False, "failed")

    if not looks_like_isolated_product_photo(result.image_bytes):
        logger.warning(
            "AI image output failed the isolated-product-photo validation check; "
            "falling back to the unedited photo"
        )
        return ImagePreparationOutcome(image_bytes, mime_type, False, "rejected")

    return ImagePreparationOutcome(result.image_bytes, result.mime_type, True, "success")


def suggest_metadata(
    db: Session, intake_id: UUID, *, metadata_provider: MetadataLLMProvider, category_slugs: list[str]
) -> JewelleryAIIntake:
    intake = get_session(db, intake_id)
    if intake.catalogue_image_storage_key is None:
        raise MissingRequiredFieldError("Upload and prepare a photo before requesting metadata suggestions.")

    storage = get_object_storage()
    image_bytes = storage.download(intake.catalogue_image_storage_key)

    try:
        suggestion = metadata_provider.suggest_metadata(image_bytes, "image/png", category_slugs=category_slugs)
        suggested = {
            "name": suggestion.name,
            "category_slug": suggestion.category_slug if suggestion.category_slug in category_slugs else None,
            "size": suggestion.size,
            "style": suggestion.style,
            "material": suggestion.material,
            "stone": suggestion.stone,
            "description": suggestion.description,
            "tags": suggestion.tags,
        }
    except AIServiceNotConfiguredError as exc:
        intake.error_message = str(exc)
        db.commit()
        db.refresh(intake)
        raise
    except AIServiceError:
        logger.warning("AI metadata suggestion failed", exc_info=True)
        raise

    intake.suggested_metadata = suggested
    if not intake.user_metadata:
        intake.user_metadata = dict(suggested)
    intake.status = IntakeStatus.metadata_ready
    intake.error_message = None
    db.commit()
    db.refresh(intake)
    return intake


def update_user_metadata(db: Session, intake_id: UUID, patch: dict) -> JewelleryAIIntake:
    """Plain DB merge -- never calls an AI provider (spec: editing a field must not
    re-trigger the LLM)."""
    intake = get_session(db, intake_id)
    merged = dict(intake.user_metadata)
    for key, value in patch.items():
        if value is not None:
            merged[key] = value
    intake.user_metadata = merged
    db.commit()
    db.refresh(intake)
    return intake


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    base = _SLUG_RE.sub("-", name.lower()).strip("-") or "jewellery-item"
    return base[:180]


def submit(db, redis_client, intake_id: UUID) -> JewelleryAIIntake:
    """Validates required fields, creates the real Jewellery row (auto-generating a
    slug/SKU -- the customer never has to invent either), uploads the prepared image as
    the catalogue `original` asset via the EXISTING asset_service path (which enqueues
    the existing worker job exactly as an admin upload would), and marks this intake
    submitted."""
    intake = get_session(db, intake_id)
    if intake.catalogue_image_storage_key is None:
        raise MissingRequiredFieldError("Prepare a photo before adding this item to the catalogue.")

    metadata = intake.user_metadata or {}
    name = (metadata.get("name") or "").strip()
    if not name:
        raise MissingRequiredFieldError("A name is required before adding this item to the catalogue.")
    category_slug = metadata.get("category_slug")
    if not category_slug:
        raise MissingRequiredFieldError("A category is required before adding this item to the catalogue.")

    category = db.query(JewelleryCategory).filter(JewelleryCategory.slug == category_slug).first()
    if category is None:
        raise InvalidCategoryError(str(category_slug))

    extra_measurements = {
        k: metadata[k] for k in ("size", "style", "material", "stone", "tags") if metadata.get(k)
    }

    base_slug = _slugify(name)
    jewellery: Optional[Jewellery] = None
    last_error: Optional[Exception] = None
    for _attempt in range(5):
        candidate_slug = f"{base_slug}-{uuid.uuid4().hex[:6]}"
        candidate_sku = f"AI-{uuid.uuid4().hex[:8].upper()}"
        payload = JewelleryCreateRequest(
            category_id=category.id,
            name=name,
            slug=candidate_slug,
            description=metadata.get("description"),
            sku=candidate_sku,
            physical_width_mm=metadata.get("physical_width_mm"),
            physical_height_mm=metadata.get("physical_height_mm"),
            physical_depth_mm=metadata.get("physical_depth_mm"),
            weight_g=metadata.get("weight_g"),
            extra_measurements=extra_measurements,
        )
        try:
            jewellery = jewellery_service.create_jewellery(db, payload)
            break
        except (
            jewellery_service.JewellerySlugAlreadyExistsError,
            jewellery_service.JewellerySkuAlreadyExistsError,
        ) as exc:
            last_error = exc
            continue
    if jewellery is None:
        raise last_error or RuntimeError("Could not create jewellery item.")

    storage = get_object_storage()
    prepared_bytes = storage.download(intake.catalogue_image_storage_key)
    asset_service.upload_original_asset(db, redis_client, jewellery.id, prepared_bytes)

    intake.jewellery_id = jewellery.id
    intake.status = IntakeStatus.submitted
    intake.error_message = None
    db.commit()
    db.refresh(intake)
    return intake


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)


def _api_key_for_provider(settings: Settings, provider_name: str) -> str:
    # Gemini is a separate account/credentials from the generic AI_API_KEY (which
    # targets an OpenAI-compatible provider) -- see Settings.GEMINI_API_KEY's comment.
    if provider_name == "gemini":
        return settings.GEMINI_API_KEY
    return settings.AI_API_KEY


def build_image_provider(settings: Settings) -> ImageGenerationProvider:
    from ai.jewellery_assistant.providers.factory import get_image_provider

    return get_image_provider(
        provider_name=settings.AI_IMAGE_PROVIDER,
        api_key=_api_key_for_provider(settings, settings.AI_IMAGE_PROVIDER),
        model=settings.AI_IMAGE_MODEL,
    )


def build_metadata_provider(settings: Settings) -> MetadataLLMProvider:
    from ai.jewellery_assistant.providers.factory import get_metadata_provider

    return get_metadata_provider(
        provider_name=settings.AI_TEXT_PROVIDER,
        api_key=_api_key_for_provider(settings, settings.AI_TEXT_PROVIDER),
        model=settings.AI_TEXT_MODEL,
    )
