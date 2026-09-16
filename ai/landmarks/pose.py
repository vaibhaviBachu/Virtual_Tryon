"""
Pose landmark detection — Milestone 3 (shoulders/neck/torso for necklace/haaram
context; never full try-on placement, per this milestone's scope boundary).

As with face.py and hand.py, real MediaPipe Pose weights
(`mediapipe/modules/pose_landmark/pose_landmark_full.tflite`, Apache 2.0) are bundled
inside the `mediapipe==0.10.9` wheel and run with no network access — so this is a real
pose detector, not the segmentation-derived shoulder-line heuristic the spec authorized
as a fallback. That heuristic is a genuinely useful fallback and IS still implemented
below (`estimate_from_segmentation`) for the situation the spec anticipated (no real
pose detector reachable) — kept and tested so the honest-degradation path exists and is
exercised, in case a future environment loses access to the bundled-weights wheel (e.g.
if MediaPipe's own packaging changes) and needs a documented fallback instead of a
sudden hard failure.

Confidence is the real, MediaPipe-provided per-landmark `visibility` score for the
shoulder landmarks (indices 11/12 in MediaPipe Pose's 33-point topology) — not
invented.
"""
import logging
from typing import Optional

import numpy as np

from ai.landmarks.schemas import ConfidenceLevel, NormalizedPoint, PoseLandmarkResult, bucket_confidence

logger = logging.getLogger("ai.landmarks.pose")

_MIN_DETECTION_CONFIDENCE = 0.5
_LEFT_SHOULDER_IDX = 11
_RIGHT_SHOULDER_IDX = 12


class PoseLandmarker:
    model_name = "mediapipe_pose_0.10.9"

    def __init__(self) -> None:
        import mediapipe as mp

        self._mp = mp
        self._pose = mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            min_detection_confidence=_MIN_DETECTION_CONFIDENCE,
        )

    def detect(self, image_rgb: np.ndarray) -> PoseLandmarkResult:
        height, width = image_rgb.shape[0], image_rgb.shape[1]
        try:
            result = self._pose.process(image_rgb)
        except Exception:
            logger.exception("Pose detection raised unexpectedly")
            return PoseLandmarkResult(
                success=False,
                error_message="Pose detection failed unexpectedly on this image.",
                image_width_px=width,
                image_height_px=height,
            )

        if result.pose_landmarks is None:
            return PoseLandmarkResult(
                success=False,
                error_message="No body pose detected. Please make sure your shoulders are visible in the photo.",
                image_width_px=width,
                image_height_px=height,
            )

        raw = result.pose_landmarks.landmark
        landmarks = [
            NormalizedPoint(x=p.x, y=p.y, z=p.z, visibility=p.visibility) for p in raw
        ]

        left_shoulder = raw[_LEFT_SHOULDER_IDX]
        right_shoulder = raw[_RIGHT_SHOULDER_IDX]
        shoulder_confidence = float((left_shoulder.visibility + right_shoulder.visibility) / 2.0)

        neck_anchor = NormalizedPoint(
            x=(left_shoulder.x + right_shoulder.x) / 2.0,
            y=(left_shoulder.y + right_shoulder.y) / 2.0,
        )
        # Real derived signal: a large z-difference between the two shoulders indicates
        # the body is rotated relative to the camera rather than facing it frontally.
        z_delta = abs(left_shoulder.z - right_shoulder.z)
        body_orientation = "turned" if z_delta > 0.15 else "frontal"

        return PoseLandmarkResult(
            success=True,
            image_width_px=width,
            image_height_px=height,
            landmarks=landmarks,
            shoulder_confidence=shoulder_confidence,
            confidence_level=bucket_confidence(shoulder_confidence),
            neck_anchor=neck_anchor,
            body_orientation=body_orientation,
            method="mediapipe_pose_0.10.9",
        )

    def close(self) -> None:
        self._pose.close()


def estimate_from_segmentation(
    person_mask: np.ndarray, image_width_px: int, image_height_px: int, face_bbox: Optional[dict]
) -> PoseLandmarkResult:
    """Fallback path (spec-authorized): derives an approximate shoulder line from real
    segmentation-mask geometry — the widest point of the person mask below the detected
    face region — rather than any true joint detector. Capped at a low/medium
    confidence ceiling and labeled `method="segmentation_heuristic"` throughout, never
    presented as equivalent to real pose-landmark output. Not used by default in this
    build (PoseLandmarker above succeeds using real bundled MediaPipe weights) — kept
    and unit-tested as the documented honest-degradation path.
    """
    _CONFIDENCE_CEILING = 0.55
    if person_mask is None or person_mask.max() <= 0:
        return PoseLandmarkResult(
            success=False,
            error_message="No person detected in segmentation; cannot estimate shoulder line.",
            image_width_px=image_width_px,
            image_height_px=image_height_px,
            method="segmentation_heuristic",
        )

    binary = person_mask > 0.5
    face_bottom_y = 0.35 if face_bbox is None else face_bbox.get("y_max", 0.35)
    search_start_row = int(face_bottom_y * binary.shape[0])
    search_start_row = min(max(search_start_row, 0), binary.shape[0] - 1)

    best_row = None
    best_width = 0
    for row in range(search_start_row, min(search_start_row + int(0.25 * binary.shape[0]) + 1, binary.shape[0])):
        cols = np.where(binary[row])[0]
        if cols.size == 0:
            continue
        width_px = cols.max() - cols.min()
        if width_px > best_width:
            best_width = width_px
            best_row = (row, cols.min(), cols.max())

    if best_row is None:
        return PoseLandmarkResult(
            success=False,
            error_message="Could not locate a plausible shoulder line from segmentation.",
            image_width_px=image_width_px,
            image_height_px=image_height_px,
            method="segmentation_heuristic",
        )

    row, x_min, x_max = best_row
    left_shoulder = NormalizedPoint(x=x_min / binary.shape[1], y=row / binary.shape[0])
    right_shoulder = NormalizedPoint(x=x_max / binary.shape[1], y=row / binary.shape[0])
    neck_anchor = NormalizedPoint(x=(left_shoulder.x + right_shoulder.x) / 2, y=left_shoulder.y)

    # Confidence is proportional to how much wider the shoulder row is than the face
    # bounding box (a real, measured geometric ratio), capped at the low/medium ceiling.
    face_width = 0.2 if face_bbox is None else max(face_bbox.get("x_max", 0.5) - face_bbox.get("x_min", 0.3), 0.05)
    measured_width = (x_max - x_min) / binary.shape[1]
    ratio = min(measured_width / max(face_width, 1e-3), 3.0) / 3.0
    confidence = min(ratio, 1.0) * _CONFIDENCE_CEILING

    return PoseLandmarkResult(
        success=True,
        image_width_px=image_width_px,
        image_height_px=image_height_px,
        landmarks=[left_shoulder, right_shoulder],
        shoulder_confidence=confidence,
        confidence_level=bucket_confidence(confidence),
        neck_anchor=neck_anchor,
        body_orientation=None,
        method="segmentation_heuristic",
    )
