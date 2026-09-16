"""
Try-on render (jewellery placement) job consumer — Milestone 4 (spec §22-24).

Flow for one job:
    1. Dequeue a TryOnRenderJob.
    2. Load the TryOnRender row + its TryOnRequest + Jewellery (+category) + the
       processed JewelleryAsset to place, mark `processing`.
    3. Validate (spec §20-21): category supported, asset ready with a usable alpha
       channel, the underlying TryOnRequest finished Milestone 3 analysis, and the
       CATEGORY-SPECIFIC readiness flag from that analysis is true. Any failure here is
       a `blocked` result with a structured `error_code` — never a poor/best-effort
       render (spec §21: "do not silently create a poor result").
    4. Download the user photo + jewellery asset bytes, call
       `GeometryTryOnEngine.render_with_debug(...)` (always computes the debug overlay
       too — spec §27 — cheap relative to the rest of the pipeline; only the API layer
       decides whether to ever expose it).
    5. On success: upload the result PNG (and debug PNG) to private storage
       (storage/keys.py's tryon_render_result_key/tryon_render_debug_key, spec §24),
       persist placement_metadata + metrics, mark `ready`.
    6. On a structured engine failure that corresponds to a readiness/asset problem,
       mark `blocked` with that error_code (defense in depth — the same checks already
       ran in step 3, but the engine enforces them again independently). Any other
       failure (unexpected exception) is marked `failed` with a safe, generic message,
       exactly like Milestone 3's process_tryon_request.py never leaves a row stuck.

This module owns all I/O (storage, database, queue, and the one place `ai.engines.
geometry` is imported to register GeometryTryOnEngine — see ai/engines/registry.py).
"""
import io
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Optional

import redis
from sqlalchemy.orm import Session

import ai.engines.geometry  # noqa: F401 — import side effect registers GeometryTryOnEngine
from ai.engines.registry import get_engine
from db.models import AssetType, Jewellery, JewelleryAsset, ProcessingStatus, TryOnRender, TryOnRenderStatus, TryOnRequest, TryOnRequestStatus, UserImage
from jobqueue import TryOnRenderJob, dequeue_render_job
from storage.base import ObjectStorage
from storage.keys import tryon_render_debug_key, tryon_render_result_key
from workers.db import session_scope
from workers.storage import get_object_storage

logger = logging.getLogger("worker.tasks.process_tryon_render")

_GENERIC_FAILURE_MESSAGE = (
    "We couldn't generate your try-on image. Please try again, or contact support if "
    "the problem continues."
)

# Engine error codes that reflect a readiness/asset/category precondition failing
# rather than an unexpected crash — these map to TryOnRenderStatus.blocked (spec §21),
# not `failed`, even though they are surfaced defensively at render time (the same
# checks already ran in `_validate` below; this is defense in depth, not the primary
# gate).
_BLOCKED_ERROR_CODES = {
    "FACE_NOT_VISIBLE",
    "EAR_NOT_VISIBLE",
    "LOW_EAR_CONFIDENCE",
    "NECK_NOT_VISIBLE",
    "UNSUPPORTED_CATEGORY",
    "ASSET_INVALID",
    "ASSET_NOT_READY",
    "REQUEST_NOT_READY",
}


class RenderRowMissingError(Exception):
    pass


@dataclass
class RenderJobTimings:
    queue_wait_seconds: float = 0.0
    load_seconds: float = 0.0
    render_seconds: float = 0.0
    upload_seconds: float = 0.0
    db_seconds: float = 0.0

    @property
    def total_seconds(self) -> float:
        return self.queue_wait_seconds + self.load_seconds + self.render_seconds + self.upload_seconds + self.db_seconds

    def as_dict(self) -> dict:
        d = asdict(self)
        d["total_seconds"] = self.total_seconds
        return {k: round(v, 4) for k, v in d.items()}


def _load_rows(db: Session, job: TryOnRenderJob):
    render = db.get(TryOnRender, job.render_id)
    if render is None:
        raise RenderRowMissingError(f"tryon render {job.render_id} not found")
    request = db.get(TryOnRequest, render.request_id)
    if request is None:
        raise RenderRowMissingError(f"tryon request {render.request_id} not found")
    jewellery = db.get(Jewellery, render.jewellery_id)
    if jewellery is None:
        raise RenderRowMissingError(f"jewellery {render.jewellery_id} not found")

    if render.asset_id:
        asset = db.get(JewelleryAsset, render.asset_id)
    else:
        asset = (
            db.query(JewelleryAsset)
            .filter(
                JewelleryAsset.jewellery_id == jewellery.id,
                JewelleryAsset.asset_type == AssetType.processed,
                JewelleryAsset.processing_status == ProcessingStatus.ready,
            )
            .order_by(JewelleryAsset.created_at.desc())
            .first()
        )

    user_image = db.get(UserImage, request.user_image_id)
    if user_image is None:
        raise RenderRowMissingError(f"user image {request.user_image_id} not found")

    return render, request, jewellery, asset, user_image


def _validate(request: TryOnRequest, jewellery: Jewellery, asset: Optional[JewelleryAsset]):
    """Returns (category_slug, error_code, error_message) — error_code is None when
    validation passes. Mirrors ai/landmarks/readiness.py's category-aware philosophy:
    a photo/asset can be valid for one category and not another."""
    category_slug = jewellery.category.slug if jewellery.category else None
    if category_slug not in ("earrings", "necklace"):
        return category_slug, "UNSUPPORTED_CATEGORY", (
            f"Try-on rendering for category {category_slug!r} is not available yet."
        )

    if asset is None or asset.processing_status != ProcessingStatus.ready or asset.storage_key.startswith("pending/"):
        return category_slug, "ASSET_NOT_READY", "This jewellery item's image is not ready for try-on yet."

    if request.status != TryOnRequestStatus.ready:
        return category_slug, "REQUEST_NOT_READY", "Your photo analysis has not finished yet."

    readiness = request.readiness or {}
    if category_slug == "earrings" and not readiness.get("ears_ready"):
        reason = (readiness.get("reasons") or {}).get("ears") or "Your ears aren't clearly visible in this photo."
        return category_slug, "EAR_NOT_VISIBLE", reason
    if category_slug == "necklace" and not readiness.get("neck_ready"):
        reason = (readiness.get("reasons") or {}).get("neck") or "Your neck/shoulders aren't clearly visible in this photo."
        return category_slug, "NECK_NOT_VISIBLE", reason

    return category_slug, None, None


def process_one_job(
    job: TryOnRenderJob,
    *,
    storage: ObjectStorage,
    queue_wait_seconds: float,
) -> RenderJobTimings:
    timings = RenderJobTimings(queue_wait_seconds=queue_wait_seconds)

    with session_scope() as db:
        t0 = time.monotonic()
        try:
            render, request, jewellery, asset, user_image = _load_rows(db, job)
        except RenderRowMissingError as exc:
            logger.warning(
                "Skipping render job: row missing",
                extra={"extra_fields": {"job_id": job.job_id, "reason": str(exc)}},
            )
            timings.db_seconds += time.monotonic() - t0
            return timings

        render.status = TryOnRenderStatus.processing
        render.started_at = datetime.now(timezone.utc)
        db.flush()
        timings.db_seconds += time.monotonic() - t0

        category_slug, error_code, error_message = _validate(request, jewellery, asset)
        render.category_slug = category_slug or "unknown"
        if error_code is not None:
            render.status = TryOnRenderStatus.blocked
            render.error_code = error_code
            render.error_message = error_message
            render.completed_at = datetime.now(timezone.utc)
            render.metrics = timings.as_dict()
            logger.info(
                "Tryon render blocked by readiness/asset validation",
                extra={"extra_fields": {"job_id": job.job_id, "render_id": job.render_id, "error_code": error_code}},
            )
            return timings

        render.asset_id = asset.id

        t0 = time.monotonic()
        try:
            image_bytes = storage.download(user_image.storage_key)
            asset_bytes = storage.download(asset.storage_key)
        except Exception:
            logger.exception(
                "Failed to download image/asset bytes for render",
                extra={"extra_fields": {"job_id": job.job_id, "render_id": job.render_id}},
            )
            _fail(render, _GENERIC_FAILURE_MESSAGE, "RENDER_EXCEPTION")
            render.metrics = timings.as_dict()
            return timings
        timings.load_seconds += time.monotonic() - t0

        placement_config = {
            "category_slug": category_slug,
            "side": "both" if category_slug == "earrings" else None,
            "face_landmarks": request.face_landmarks,
            "pose_landmarks": request.pose_landmarks,
            "asset_anchor_x": asset.anchor_x,
            "asset_anchor_y": asset.anchor_y,
            "attachment_point": asset.attachment_point,
            "mirrorable": asset.mirrorable,
            "physical_width_mm": float(jewellery.physical_width_mm) if jewellery.physical_width_mm else None,
            "physical_height_mm": float(jewellery.physical_height_mm) if jewellery.physical_height_mm else None,
            "readiness": request.readiness,
        }

        t0 = time.monotonic()
        engine = get_engine("geometry")
        try:
            geometry_result = engine.render_with_debug(image_bytes, asset_bytes, placement_config)
            result = engine.adapt_result(geometry_result)
        except Exception:
            logger.exception(
                "Geometry engine raised unexpectedly",
                extra={"extra_fields": {"job_id": job.job_id, "render_id": job.render_id}},
            )
            _fail(render, _GENERIC_FAILURE_MESSAGE, "RENDER_EXCEPTION")
            render.metrics = timings.as_dict()
            return timings
        timings.render_seconds += time.monotonic() - t0

        if not result.success:
            status = TryOnRenderStatus.blocked if result.error_code in _BLOCKED_ERROR_CODES else TryOnRenderStatus.failed
            render.status = status
            render.error_code = result.error_code or "RENDER_EXCEPTION"
            render.error_message = result.error_message or _GENERIC_FAILURE_MESSAGE
            render.placement_metadata = result.placement_metadata
            merged_metrics = timings.as_dict()
            merged_metrics.update({f"engine_{k}": v for k, v in result.metrics.items()})
            render.metrics = merged_metrics
            render.completed_at = datetime.now(timezone.utc)
            return timings

        t0 = time.monotonic()
        try:
            result_key = tryon_render_result_key(request.session_id, request.id)
            storage.upload(result_key, io.BytesIO(result.result_image_bytes), content_type="image/png")
            render.result_storage_key = result_key

            if geometry_result.debug_image_rgb is not None:
                from ai.engines.geometry.engine import encode_rgb_png

                debug_png = encode_rgb_png(geometry_result.debug_image_rgb)
                debug_key = tryon_render_debug_key(request.session_id, request.id)
                storage.upload(debug_key, io.BytesIO(debug_png), content_type="image/png")
                render.debug_storage_key = debug_key
        except Exception:
            logger.exception(
                "Failed to upload render result to storage",
                extra={"extra_fields": {"job_id": job.job_id, "render_id": job.render_id}},
            )
            _fail(render, _GENERIC_FAILURE_MESSAGE, "RENDER_EXCEPTION")
            render.metrics = timings.as_dict()
            return timings
        timings.upload_seconds += time.monotonic() - t0

        merged_metrics = timings.as_dict()
        merged_metrics.update({f"engine_{k}": v for k, v in result.metrics.items()})

        render.status = TryOnRenderStatus.ready
        render.error_code = None
        render.error_message = None
        render.placement_metadata = result.placement_metadata
        render.metrics = merged_metrics
        render.completed_at = datetime.now(timezone.utc)

    logger.info(
        "Tryon render job completed",
        extra={"extra_fields": {"job_id": job.job_id, "render_id": job.render_id, **timings.as_dict()}},
    )
    return timings


def _fail(render: TryOnRender, message: str, error_code: str) -> None:
    render.status = TryOnRenderStatus.failed
    render.error_code = error_code
    render.error_message = message
    render.completed_at = datetime.now(timezone.utc)


def run_consumer_loop(redis_client: redis.Redis, stop_event, poll_timeout_seconds: int = 5) -> None:
    """Mirrors workers/tasks/process_tryon_request.py's run_consumer_loop pattern —
    its own dedicated thread so a slow render never delays photo analysis or catalogue
    asset processing."""
    storage = get_object_storage()

    logger.info("Tryon render processing consumer loop started")
    while not stop_event.is_set():
        wait_start = time.monotonic()
        try:
            job = dequeue_render_job(redis_client, timeout_seconds=poll_timeout_seconds)
        except Exception:
            logger.exception("Failed to dequeue render job (is Redis reachable?)")
            stop_event.wait(poll_timeout_seconds)
            continue
        queue_wait_seconds = time.monotonic() - wait_start

        if job is None:
            continue

        try:
            process_one_job(job, storage=storage, queue_wait_seconds=queue_wait_seconds)
        except Exception:
            logger.exception(
                "Unhandled error processing tryon render job",
                extra={"extra_fields": {"job_id": job.job_id}},
            )

    logger.info("Tryon render processing consumer loop stopped")
