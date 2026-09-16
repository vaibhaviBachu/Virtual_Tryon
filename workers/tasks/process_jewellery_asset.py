"""
Catalogue asset processing job consumer (Milestone 2 spec §9, §26-27).

Flow for one job:
    1. Dequeue a CatalogueAssetProcessingJob (blocking, with timeout so the loop can
       check the stop event periodically).
    2. Load the `processed` placeholder JewelleryAsset row (created synchronously by
       apps/api/v1/services/asset_service.upload_original_asset) and mark it
       `processing`.
    3. Find the sibling `original` asset row for the same jewellery item, download its
       bytes from object storage.
    4. Run ai.catalogue.processor.CatalogueAssetProcessor (background removal -> alpha
       cleanup -> padded crop -> thumbnail).
    5. Upload the processed PNG and thumbnail PNG to fresh, collision-proof storage
       keys.
    6. Update the `processed` row in place (storage_key/mime_type/dimensions/
       file_size_bytes/status=ready) and create a new `thumbnail` JewelleryAsset row.
    7. On any failure, mark the `processed` row `failed` with a safe, generic
       `processing_error` message — the real exception is logged server-side only,
       never persisted to the database or exposed to the frontend (spec's
       error-handling rule, mirrored from apps/api).

This module owns all I/O (storage, database, queue). ai.catalogue.processor is pure
image-in/image-out logic and is unit-tested independently without any of this.
"""
import logging
import time
from dataclasses import dataclass
from typing import Optional

import redis
from sqlalchemy.orm import Session

from ai.catalogue.background_remover import get_remover
from ai.catalogue.processor import CatalogueAssetProcessor, ProcessingFailedError
from db.models import AssetType, JewelleryAsset, ProcessingStatus
from jobqueue import CatalogueAssetProcessingJob, dequeue_job
from storage.base import ObjectStorage
from storage.keys import jewellery_asset_key
from workers.db import session_scope
from workers.storage import get_object_storage

logger = logging.getLogger("worker.tasks.process_jewellery_asset")

# A safe, generic message stored on the asset row itself. Never the raw exception text —
# that could leak internal paths, library names, or stack details to the admin UI.
_GENERIC_FAILURE_MESSAGE = (
    "Automatic background removal failed for this image. Try a different photo with "
    "better contrast between the jewellery and its background, or contact support."
)


@dataclass
class JobTimings:
    """Per-stage timing breakdown, logged for every processed job (spec §27
    observability requirement) — never fabricated, always measured with
    time.monotonic() around the actual work."""

    queue_wait_seconds: float
    download_seconds: float
    processing_seconds: float
    upload_seconds: float
    db_seconds: float

    @property
    def total_seconds(self) -> float:
        return (
            self.queue_wait_seconds
            + self.download_seconds
            + self.processing_seconds
            + self.upload_seconds
            + self.db_seconds
        )


class AssetRowMissingError(Exception):
    """The processed placeholder row (or its sibling original) no longer exists. This
    can legitimately happen if an admin deleted the jewellery item or the asset between
    enqueue and dequeue — not a bug, just a race to log and drop."""


def _load_rows(db: Session, job: CatalogueAssetProcessingJob) -> tuple[JewelleryAsset, JewelleryAsset]:
    processed_asset = db.get(JewelleryAsset, job.asset_id)
    if processed_asset is None:
        raise AssetRowMissingError(f"processed asset {job.asset_id} not found")

    original_asset = (
        db.query(JewelleryAsset)
        .filter(
            JewelleryAsset.jewellery_id == processed_asset.jewellery_id,
            JewelleryAsset.asset_type == AssetType.original,
        )
        .order_by(JewelleryAsset.created_at.desc())
        .first()
    )
    if original_asset is None:
        raise AssetRowMissingError(
            f"no original asset found for jewellery {processed_asset.jewellery_id}"
        )
    return processed_asset, original_asset


def process_one_job(
    job: CatalogueAssetProcessingJob,
    *,
    processor: CatalogueAssetProcessor,
    storage: ObjectStorage,
    queue_wait_seconds: float,
) -> JobTimings:
    """Runs the full pipeline for a single job against real storage/database
    dependencies (or test doubles that satisfy the same interfaces). Raises nothing to
    the caller under normal failure conditions — pipeline failures are captured and
    written to the asset row's processing_error, exactly like a successful run writes
    its output. Only truly unexpected errors (e.g. the DB is unreachable) propagate."""
    download_seconds = 0.0
    processing_seconds = 0.0
    upload_seconds = 0.0
    db_seconds = 0.0

    with session_scope() as db:
        t0 = time.monotonic()
        try:
            processed_asset, original_asset = _load_rows(db, job)
        except AssetRowMissingError as exc:
            logger.warning(
                "Skipping job: asset row missing (likely deleted after enqueue)",
                extra={"extra_fields": {"job_id": job.job_id, "reason": str(exc)}},
            )
            db_seconds += time.monotonic() - t0
            return JobTimings(queue_wait_seconds, download_seconds, processing_seconds, upload_seconds, db_seconds)

        processed_asset.processing_status = ProcessingStatus.processing
        db.flush()
        db_seconds += time.monotonic() - t0

        t0 = time.monotonic()
        try:
            original_bytes = storage.download(original_asset.storage_key)
        except Exception as exc:
            logger.exception(
                "Failed to download original asset from storage",
                extra={"extra_fields": {"job_id": job.job_id, "asset_id": job.asset_id}},
            )
            processed_asset.processing_status = ProcessingStatus.failed
            processed_asset.processing_error = _GENERIC_FAILURE_MESSAGE
            return JobTimings(queue_wait_seconds, time.monotonic() - t0, processing_seconds, upload_seconds, db_seconds)
        download_seconds += time.monotonic() - t0

        t0 = time.monotonic()
        try:
            result = processor.process(original_bytes)
        except ProcessingFailedError as exc:
            logger.warning(
                "Catalogue asset processing failed",
                extra={"extra_fields": {"job_id": job.job_id, "asset_id": job.asset_id, "reason": str(exc)}},
            )
            processed_asset.processing_status = ProcessingStatus.failed
            processed_asset.processing_error = _GENERIC_FAILURE_MESSAGE
            return JobTimings(queue_wait_seconds, download_seconds, time.monotonic() - t0, upload_seconds, db_seconds)
        except Exception:
            logger.exception(
                "Unexpected error during catalogue asset processing",
                extra={"extra_fields": {"job_id": job.job_id, "asset_id": job.asset_id}},
            )
            processed_asset.processing_status = ProcessingStatus.failed
            processed_asset.processing_error = _GENERIC_FAILURE_MESSAGE
            return JobTimings(queue_wait_seconds, download_seconds, time.monotonic() - t0, upload_seconds, db_seconds)
        processing_seconds += time.monotonic() - t0

        t0 = time.monotonic()
        try:
            processed_key = jewellery_asset_key(processed_asset.jewellery_id, AssetType.processed.value, "image/png")
            thumbnail_key = jewellery_asset_key(processed_asset.jewellery_id, AssetType.thumbnail.value, "image/png")
            storage.upload(processed_key, _bytes_io(result.processed_png_bytes), content_type="image/png")
            storage.upload(thumbnail_key, _bytes_io(result.thumbnail_png_bytes), content_type="image/png")
        except Exception:
            logger.exception(
                "Failed to upload processed/thumbnail assets to storage",
                extra={"extra_fields": {"job_id": job.job_id, "asset_id": job.asset_id}},
            )
            processed_asset.processing_status = ProcessingStatus.failed
            processed_asset.processing_error = _GENERIC_FAILURE_MESSAGE
            return JobTimings(queue_wait_seconds, download_seconds, processing_seconds, time.monotonic() - t0, db_seconds)
        upload_seconds += time.monotonic() - t0

        t0 = time.monotonic()
        processed_asset.storage_key = processed_key
        processed_asset.mime_type = "image/png"
        processed_asset.width_px = result.processed_width_px
        processed_asset.height_px = result.processed_height_px
        processed_asset.file_size_bytes = len(result.processed_png_bytes)
        processed_asset.processing_status = ProcessingStatus.ready
        processed_asset.processing_error = None

        thumbnail_asset = JewelleryAsset(
            jewellery_id=processed_asset.jewellery_id,
            asset_type=AssetType.thumbnail,
            storage_key=thumbnail_key,
            mime_type="image/png",
            width_px=result.thumbnail_width_px,
            height_px=result.thumbnail_height_px,
            file_size_bytes=len(result.thumbnail_png_bytes),
            processing_status=ProcessingStatus.ready,
        )
        db.add(thumbnail_asset)
        db_seconds += time.monotonic() - t0

    timings = JobTimings(queue_wait_seconds, download_seconds, processing_seconds, upload_seconds, db_seconds)
    logger.info(
        "Catalogue asset processing job completed",
        extra={
            "extra_fields": {
                "job_id": job.job_id,
                "asset_id": job.asset_id,
                "queue_wait_seconds": round(timings.queue_wait_seconds, 3),
                "download_seconds": round(timings.download_seconds, 3),
                "processing_seconds": round(timings.processing_seconds, 3),
                "upload_seconds": round(timings.upload_seconds, 3),
                "db_seconds": round(timings.db_seconds, 3),
                "total_seconds": round(timings.total_seconds, 3),
            }
        },
    )
    return timings


def run_consumer_loop(redis_client: redis.Redis, stop_event, poll_timeout_seconds: int = 5) -> None:
    """Blocking loop: dequeue -> process -> repeat, until stop_event is set. Meant to
    run on its own thread (mirrors workers/main.py's heartbeat-thread pattern) so the
    worker's FastAPI health/ready endpoints keep serving while jobs are processed."""
    remover = get_remover("rembg_u2net")
    processor = CatalogueAssetProcessor(remover)
    storage = get_object_storage()

    logger.info("Catalogue asset processing consumer loop started")
    while not stop_event.is_set():
        wait_start = time.monotonic()
        try:
            job = dequeue_job(redis_client, timeout_seconds=poll_timeout_seconds)
        except Exception:
            logger.exception("Failed to dequeue job (is Redis reachable?)")
            stop_event.wait(poll_timeout_seconds)
            continue
        queue_wait_seconds = time.monotonic() - wait_start

        if job is None:
            continue  # normal timeout, no job waiting — loop back and block again

        try:
            process_one_job(
                job, processor=processor, storage=storage, queue_wait_seconds=queue_wait_seconds
            )
        except Exception:
            # Only reaches here for genuinely unexpected errors (e.g. DB connection
            # lost) that process_one_job's internal try/excepts didn't already convert
            # into a `failed` asset row. Log and keep the loop alive for the next job.
            logger.exception(
                "Unhandled error processing catalogue asset job",
                extra={"extra_fields": {"job_id": job.job_id}},
            )

    logger.info("Catalogue asset processing consumer loop stopped")


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)
