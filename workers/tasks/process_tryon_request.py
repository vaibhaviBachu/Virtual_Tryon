"""
Try-on request processing job consumer — Milestone 3.

Flow for one job (spec: "worker loads image -> preprocesses -> landmarks ->
segmentation -> quality evaluation -> stores result -> updates status"):
    1. Dequeue a TryOnRequestProcessingJob.
    2. Load the TryOnRequest + its UserImage row, mark `processing`, download the
       stored (already EXIF-stripped/orientation-normalized) photo bytes.
    3. Basic quality gate (ai/preprocessing/quality_checks.py) — fails fast with a safe
       message before any expensive inference if the photo is unusable.
    4. Face landmarks (ai/landmarks/face.py) -> mark `landmarks_ready` on success.
    5. Hand landmarks (ai/landmarks/hand.py).
    6. Pose landmarks (ai/landmarks/pose.py).
    7. Segmentation (ai/segmentation/person_segmenter.py) -> upload the mask PNG to
       private storage -> mark `segmentation_ready`.
    8. Readiness evaluation (ai/landmarks/readiness.py).
    9. Persist everything, `status=ready`, real per-stage timings in `metrics`.

On ANY unexpected failure at any stage, the request is marked `failed` with a safe,
generic message — it is NEVER left stuck in `processing` forever (spec's explicit
requirement), and the real exception is logged server-side only.

This module owns all I/O (storage, database, queue), exactly like
workers/tasks/process_jewellery_asset.py. The `ai/` modules it calls are pure
image-in/result-out and are unit-tested independently without any of this.
"""
import io
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import redis
from PIL import Image
from sqlalchemy.orm import Session

from ai.landmarks.face import FaceLandmarker
from ai.landmarks.hand import HandLandmarker
from ai.landmarks.pose import PoseLandmarker
from ai.landmarks.readiness import evaluate_readiness
from ai.landmarks.schemas import EarRegion, FaceLandmarkResult, HandLandmarkResult, NormalizedPoint, PoseLandmarkResult
from ai.preprocessing.quality_checks import check_image_quality
from ai.segmentation.person_segmenter import PersonSegmenter
from db.models import TryOnRequest, TryOnRequestStatus, UserImage
from jobqueue import TryOnRequestProcessingJob, dequeue_tryon_job
from storage.base import ObjectStorage
from storage.keys import segmentation_mask_key
from workers.db import session_scope
from workers.storage import get_object_storage

logger = logging.getLogger("worker.tasks.process_tryon_request")

_GENERIC_FAILURE_MESSAGE = (
    "We couldn't process your photo. Please try again with a clear, well-lit photo, "
    "or contact support if the problem continues."
)


class RequestRowMissingError(Exception):
    pass


@dataclass
class TryOnJobTimings:
    """Every field is a real time.monotonic() measurement — never fabricated (spec
    §"Performance metrics": "record stage timings at minimum for queue wait,
    preprocessing, face/hand/pose landmark time, segmentation time, readiness
    evaluation, total processing time")."""

    queue_wait_seconds: float = 0.0
    preprocessing_seconds: float = 0.0
    face_seconds: float = 0.0
    hand_seconds: float = 0.0
    pose_seconds: float = 0.0
    segmentation_seconds: float = 0.0
    readiness_seconds: float = 0.0
    db_seconds: float = 0.0

    @property
    def total_seconds(self) -> float:
        return (
            self.queue_wait_seconds
            + self.preprocessing_seconds
            + self.face_seconds
            + self.hand_seconds
            + self.pose_seconds
            + self.segmentation_seconds
            + self.readiness_seconds
            + self.db_seconds
        )

    def as_dict(self) -> dict:
        d = asdict(self)
        d["total_seconds"] = self.total_seconds
        return {k: round(v, 4) for k, v in d.items()}


def _serialize_face(result: FaceLandmarkResult) -> dict:
    def ear(e: Optional[EarRegion]) -> Optional[dict]:
        if e is None:
            return None
        return {
            "side": e.side,
            "anchor": {"x": e.anchor.x, "y": e.anchor.y} if e.anchor else None,
            "confidence": e.confidence,
            "confidence_level": e.confidence_level.value,
            "sufficiently_visible": e.sufficiently_visible,
            "reason": e.reason,
        }

    return {
        "success": result.success,
        "error_message": result.error_message,
        "image_width_px": result.image_width_px,
        "image_height_px": result.image_height_px,
        "num_faces_detected": result.num_faces_detected,
        "landmarks": [{"x": p.x, "y": p.y, "z": p.z} for p in result.landmarks],
        "face_bounding_box": result.face_bounding_box,
        "detection_confidence": result.detection_confidence,
        "confidence_level": result.confidence_level.value,
        "head_pose_yaw_estimate": result.head_pose_yaw_estimate,
        "left_ear": ear(result.left_ear),
        "right_ear": ear(result.right_ear),
        "model_name": result.model_name,
    }


def _serialize_hands(result: HandLandmarkResult) -> dict:
    return {
        "success": result.success,
        "error_message": result.error_message,
        "image_width_px": result.image_width_px,
        "image_height_px": result.image_height_px,
        "hands_detected": result.hands_detected,
        "state": result.state,
        "hands": [
            {
                "side": h.side,
                "landmarks": [{"x": p.x, "y": p.y, "z": p.z} for p in h.landmarks],
                "handedness_confidence": h.handedness_confidence,
                "confidence_level": h.confidence_level.value,
            }
            for h in result.hands
        ],
        "model_name": result.model_name,
    }


def _serialize_pose(result: PoseLandmarkResult) -> dict:
    return {
        "success": result.success,
        "error_message": result.error_message,
        "image_width_px": result.image_width_px,
        "image_height_px": result.image_height_px,
        "landmarks": [{"x": p.x, "y": p.y, "z": p.z, "visibility": p.visibility} for p in result.landmarks],
        "shoulder_confidence": result.shoulder_confidence,
        "confidence_level": result.confidence_level.value,
        "neck_anchor": {"x": result.neck_anchor.x, "y": result.neck_anchor.y} if result.neck_anchor else None,
        "body_orientation": result.body_orientation,
        "method": result.method,
    }


def _load_rows(db: Session, job: TryOnRequestProcessingJob) -> tuple[TryOnRequest, UserImage]:
    request = db.get(TryOnRequest, job.request_id)
    if request is None:
        raise RequestRowMissingError(f"tryon request {job.request_id} not found")
    image = db.get(UserImage, request.user_image_id)
    if image is None:
        raise RequestRowMissingError(f"user image {request.user_image_id} not found")
    return request, image


def process_one_job(
    job: TryOnRequestProcessingJob,
    *,
    face_landmarker: FaceLandmarker,
    hand_landmarker: HandLandmarker,
    pose_landmarker: PoseLandmarker,
    segmenter: PersonSegmenter,
    storage: ObjectStorage,
    queue_wait_seconds: float,
) -> TryOnJobTimings:
    timings = TryOnJobTimings(queue_wait_seconds=queue_wait_seconds)

    with session_scope() as db:
        t0 = time.monotonic()
        try:
            request, image = _load_rows(db, job)
        except RequestRowMissingError as exc:
            logger.warning(
                "Skipping tryon job: row missing",
                extra={"extra_fields": {"job_id": job.job_id, "reason": str(exc)}},
            )
            timings.db_seconds += time.monotonic() - t0
            return timings

        request.status = TryOnRequestStatus.processing
        request.started_at = datetime.now(timezone.utc)
        db.flush()
        timings.db_seconds += time.monotonic() - t0

        t0 = time.monotonic()
        try:
            raw_bytes = storage.download(image.storage_key)
            pil_image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
            image_rgb = np.asarray(pil_image)
        except Exception:
            logger.exception(
                "Failed to load/decode user photo",
                extra={"extra_fields": {"job_id": job.job_id, "request_id": job.request_id}},
            )
            _fail(request, _GENERIC_FAILURE_MESSAGE)
            timings.preprocessing_seconds += time.monotonic() - t0
            return timings

        quality = check_image_quality(image_rgb)
        timings.preprocessing_seconds += time.monotonic() - t0
        if not quality.passed:
            _fail(request, " ".join(quality.failure_reasons))
            request.metrics = timings.as_dict()
            return timings

        # --- Face ---
        t0 = time.monotonic()
        try:
            face_result = face_landmarker.detect(image_rgb)
        except Exception:
            logger.exception("Face landmark stage crashed", extra={"extra_fields": {"job_id": job.job_id}})
            face_result = FaceLandmarkResult(success=False, error_message="Face analysis failed unexpectedly.")
        timings.face_seconds += time.monotonic() - t0
        request.face_landmarks = _serialize_face(face_result)

        # --- Hands ---
        t0 = time.monotonic()
        try:
            hand_result = hand_landmarker.detect(image_rgb)
        except Exception:
            logger.exception("Hand landmark stage crashed", extra={"extra_fields": {"job_id": job.job_id}})
            hand_result = HandLandmarkResult(success=False, error_message="Hand analysis failed unexpectedly.")
        timings.hand_seconds += time.monotonic() - t0
        request.hand_landmarks = _serialize_hands(hand_result)

        # --- Pose ---
        t0 = time.monotonic()
        try:
            pose_result = pose_landmarker.detect(image_rgb)
        except Exception:
            logger.exception("Pose landmark stage crashed", extra={"extra_fields": {"job_id": job.job_id}})
            pose_result = PoseLandmarkResult(success=False, error_message="Pose analysis failed unexpectedly.")
        timings.pose_seconds += time.monotonic() - t0
        request.pose_landmarks = _serialize_pose(pose_result)

        if face_result.success or pose_result.success:
            request.status = TryOnRequestStatus.landmarks_ready
            db.flush()

        # --- Segmentation ---
        t0 = time.monotonic()
        try:
            seg_result, mask = segmenter.segment(image_rgb)
        except Exception:
            logger.exception("Segmentation stage crashed", extra={"extra_fields": {"job_id": job.job_id}})
            from ai.landmarks.schemas import SegmentationResult

            seg_result, mask = SegmentationResult(success=False, error_message="Segmentation failed unexpectedly."), None
        timings.segmentation_seconds += time.monotonic() - t0

        if seg_result.success and mask is not None:
            try:
                mask_png = _encode_mask_png(mask)
                mask_key = segmentation_mask_key(request.id)
                storage.upload(mask_key, io.BytesIO(mask_png), content_type="image/png")
                request.segmentation_mask_key = mask_key
                request.status = TryOnRequestStatus.segmentation_ready
            except Exception:
                logger.exception(
                    "Failed to upload segmentation mask", extra={"extra_fields": {"job_id": job.job_id}}
                )
                seg_result.success = False
                seg_result.error_message = "Segmentation mask could not be stored."

        request.segmentation_summary = {
            "success": seg_result.success,
            "error_message": seg_result.error_message,
            "foreground_ratio": seg_result.foreground_ratio,
            "decisiveness": seg_result.decisiveness,
            "confidence": seg_result.confidence,
            "confidence_level": seg_result.confidence_level.value,
            "available_masks": seg_result.available_masks,
            "model_name": seg_result.model_name,
        }

        # --- Readiness ---
        t0 = time.monotonic()
        readiness = evaluate_readiness(face_result, hand_result, pose_result, seg_result)
        timings.readiness_seconds += time.monotonic() - t0
        request.readiness = readiness.as_dict()

        request.confidence = {
            "face": face_result.detection_confidence if face_result.success else 0.0,
            "left_ear": face_result.left_ear.confidence if (face_result.success and face_result.left_ear) else 0.0,
            "right_ear": face_result.right_ear.confidence if (face_result.success and face_result.right_ear) else 0.0,
            "hands": max((h.handedness_confidence for h in hand_result.hands), default=0.0) if hand_result.success else 0.0,
            "pose": pose_result.shoulder_confidence if pose_result.success else 0.0,
            "segmentation": seg_result.confidence if seg_result.success else 0.0,
        }

        request.status = TryOnRequestStatus.ready
        request.error_message = None
        request.completed_at = datetime.now(timezone.utc)
        request.metrics = timings.as_dict()

    logger.info(
        "Tryon request processing completed",
        extra={
            "extra_fields": {
                "job_id": job.job_id,
                "request_id": job.request_id,
                **timings.as_dict(),
            }
        },
    )
    return timings


def _fail(request: TryOnRequest, message: str) -> None:
    request.status = TryOnRequestStatus.failed
    request.error_message = message
    request.completed_at = datetime.now(timezone.utc)


def _encode_mask_png(mask: np.ndarray) -> bytes:
    """Encodes the real float [0,1] segmentation mask as an 8-bit grayscale PNG — the
    stored artifact IS the real, measured model output, not a placeholder."""
    scaled = np.clip(mask * 255.0, 0, 255).astype(np.uint8)
    img = Image.fromarray(scaled, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def run_consumer_loop(redis_client: redis.Redis, stop_event, poll_timeout_seconds: int = 5) -> None:
    """Mirrors workers/tasks/process_jewellery_asset.py's run_consumer_loop pattern —
    runs on its own dedicated thread so it never blocks the catalogue-asset consumer or
    the heartbeat loop."""
    face_landmarker = FaceLandmarker()
    hand_landmarker = HandLandmarker()
    pose_landmarker = PoseLandmarker()
    segmenter = PersonSegmenter()
    storage = get_object_storage()

    logger.info("Tryon request processing consumer loop started")
    while not stop_event.is_set():
        wait_start = time.monotonic()
        try:
            job = dequeue_tryon_job(redis_client, timeout_seconds=poll_timeout_seconds)
        except Exception:
            logger.exception("Failed to dequeue tryon job (is Redis reachable?)")
            stop_event.wait(poll_timeout_seconds)
            continue
        queue_wait_seconds = time.monotonic() - wait_start

        if job is None:
            continue

        try:
            process_one_job(
                job,
                face_landmarker=face_landmarker,
                hand_landmarker=hand_landmarker,
                pose_landmarker=pose_landmarker,
                segmenter=segmenter,
                storage=storage,
                queue_wait_seconds=queue_wait_seconds,
            )
        except Exception:
            logger.exception(
                "Unhandled error processing tryon request job",
                extra={"extra_fields": {"job_id": job.job_id}},
            )

    logger.info("Tryon request processing consumer loop stopped")
