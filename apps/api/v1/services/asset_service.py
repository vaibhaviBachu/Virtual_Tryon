"""
Asset upload + retrieval business logic.

Upload flow (Milestone 2 spec §9, §26): validate the file content synchronously (fast,
must happen before anything is persisted) -> store the validated original privately ->
create the `original` JewelleryAsset row (status=ready — the original doesn't need
processing, it just needs to exist) -> create a `processed` JewelleryAsset row
(status=pending) -> enqueue a job referencing that row's id -> return both rows so the
admin UI can start polling the processed asset's status immediately.

No image processing happens in this module or in the API request — that is the whole
point of the worker architecture (Milestone 2 spec §9's "do not perform expensive image
processing directly inside the FastAPI request").
"""
import logging
from datetime import timedelta
from typing import Optional
from uuid import UUID

import redis
from sqlalchemy.orm import Session

from ai.preprocessing.image_validation import ImageValidationError, validate_and_normalize_upload
from apps.api.storage.s3_storage import get_object_storage
from apps.api.v1.schemas.asset import AssetWithPreviewResponse
from db.models import AssetType, Jewellery, JewelleryAsset, ProcessingStatus
from jobqueue import CatalogueAssetProcessingJob, enqueue_job
from storage.keys import jewellery_asset_key

logger = logging.getLogger("app.assets")

SIGNED_URL_EXPIRY = timedelta(minutes=15)


class AssetNotFoundError(Exception):
    pass


class JewelleryNotFoundForAssetError(Exception):
    pass


def upload_original_asset(
    db: Session,
    redis_client: redis.Redis,
    jewellery_id: UUID,
    raw_bytes: bytes,
) -> tuple[JewelleryAsset, JewelleryAsset]:
    """Returns (original_asset, processed_asset_placeholder). Raises
    ImageValidationError (safe to surface to the admin as-is) or
    JewelleryNotFoundForAssetError."""
    jewellery = db.get(Jewellery, jewellery_id)
    if jewellery is None:
        raise JewelleryNotFoundForAssetError(str(jewellery_id))

    validated = validate_and_normalize_upload(raw_bytes)  # raises ImageValidationError

    storage = get_object_storage()
    original_key = jewellery_asset_key(jewellery_id, AssetType.original.value, validated.mime_type)
    storage.upload(original_key, _bytes_io(validated.content), content_type=validated.mime_type)

    original_asset = JewelleryAsset(
        jewellery_id=jewellery_id,
        asset_type=AssetType.original,
        storage_key=original_key,
        mime_type=validated.mime_type,
        width_px=validated.width_px,
        height_px=validated.height_px,
        file_size_bytes=validated.file_size_bytes,
        processing_status=ProcessingStatus.ready,  # the original itself needs no processing
    )
    db.add(original_asset)
    db.flush()  # obtain original_asset.id without committing yet

    # Placeholder row for the processed (background-removed) variant. The worker fills
    # in storage_key/dimensions/mime_type once it actually produces the output — a
    # pending row exists now so the admin UI has something to poll immediately.
    processed_asset = JewelleryAsset(
        jewellery_id=jewellery_id,
        asset_type=AssetType.processed,
        storage_key=f"pending/{original_asset.id}",  # placeholder, unique, overwritten on success
        processing_status=ProcessingStatus.pending,
    )
    db.add(processed_asset)
    db.commit()
    db.refresh(original_asset)
    db.refresh(processed_asset)

    job = CatalogueAssetProcessingJob.create(
        asset_id=str(processed_asset.id), jewellery_id=str(jewellery_id)
    )
    enqueue_job(redis_client, job)

    logger.info(
        "Uploaded catalogue original asset and enqueued processing",
        extra={
            "extra_fields": {
                "jewellery_id": str(jewellery_id),
                "original_asset_id": str(original_asset.id),
                "processed_asset_id": str(processed_asset.id),
                "job_id": job.job_id,
            }
        },
    )
    return original_asset, processed_asset


def get_asset_with_preview(db: Session, asset_id: UUID) -> AssetWithPreviewResponse:
    asset = db.get(JewelleryAsset, asset_id)
    if asset is None:
        raise AssetNotFoundError(str(asset_id))

    preview_url: Optional[str] = None
    if asset.processing_status == ProcessingStatus.ready and not asset.storage_key.startswith("pending/"):
        storage = get_object_storage()
        preview_url = storage.create_signed_url(asset.storage_key, expires_in=SIGNED_URL_EXPIRY)

    return AssetWithPreviewResponse.model_validate(asset).model_copy(update={"preview_url": preview_url})


def list_assets_for_jewellery(db: Session, jewellery_id: UUID) -> list[JewelleryAsset]:
    return (
        db.query(JewelleryAsset)
        .filter(JewelleryAsset.jewellery_id == jewellery_id)
        .order_by(JewelleryAsset.created_at.desc())
        .all()
    )


def delete_asset(db: Session, asset_id: UUID) -> None:
    asset = db.get(JewelleryAsset, asset_id)
    if asset is None:
        raise AssetNotFoundError(str(asset_id))
    if not asset.storage_key.startswith("pending/"):
        get_object_storage().delete(asset.storage_key)
    db.delete(asset)
    db.commit()


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)
