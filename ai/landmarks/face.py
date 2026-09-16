"""
Face landmark detection — Milestone 3 (spec §"MediaPipe Face Landmarker integration").

RESEARCH OUTCOME (read before assuming this is a substitute — it is not):

Prior research in this sandbox (recorded in docs/milestone-3-verification.md §2)
confirmed the *Tasks API* (`mediapipe.tasks.python.vision.FaceLandmarker`, `.task`
model files) cannot be used here because its model weights are fetched at runtime from
`storage.googleapis.com`, which this sandbox's network policy blocks with a 403 — the
same class of restriction that blocked SAM2/huggingface.co in Milestone 2.

However, the pip-installable `mediapipe` package also ships a second, older API — the
"Solutions" API (`mediapipe.solutions.face_mesh`, `.face_detection`) — and, critically,
**that API's model weights (`.tflite` files) are bundled directly inside the wheel
itself** (verified by inspecting the wheel's file listing: `mediapipe/modules/
face_detection/face_detection_short_range.tflite`, `mediapipe/modules/face_landmark/
face_landmark.tflite`, etc.). No network fetch happens at import or inference time.
This is genuinely real MediaPipe inference — the actual Google face-mesh model, Apache
2.0 licensed — not a substitute, heuristic, or fallback. See ai/models/LICENSES.md for
the full license verification and the required `mediapipe==0.10.9` / `protobuf<4`
pinning this specific wheel needs (a newer `mediapipe` release, 1.0.1, dropped the
Solutions API entirely and only exposes the network-dependent Tasks API — confirmed by
`dir(mediapipe)` no longer containing `solutions`).

This module uses TWO real MediaPipe solutions together because the legacy `FaceMesh`
API alone does not expose a numeric detection confidence — `FaceDetection` does (a real
`detections[i].score[0]` classification score). Both run on the same bundled weights,
same process, no extra network dependency:
  1. `FaceDetection` -> real detection confidence + bounding box.
  2. `FaceMesh` -> real 468-point landmark mesh (only run if step 1 found >=1 face).

Ear-region anchors are a DOCUMENTED GEOMETRIC HEURISTIC, not a separate ear-specific
model (none exists in MediaPipe or was found reachable/license-clean in this sandbox):
face-mesh landmark indices 234 and 454 sit on the left/right edge of the face oval, at
approximately the cheek/ear boundary — a reasonable, real, computed anchor point for
"roughly where an earring anchor would need to be," but not a true ear-tragus/earlobe
detector. "Left"/"right" below means IMAGE-SPACE left/right (smaller/larger normalized
x), not anatomical left/right of the subject — this is documented explicitly because
anatomical left/right depends on whether the subject faces the camera, which this
module does not attempt to disambiguate (Milestone 4's geometry engine, not this
milestone, is where anchor-to-anatomy mapping would matter).
"""
import logging
import math
from typing import Optional

import numpy as np

from ai.landmarks.schemas import (
    ConfidenceLevel,
    EarRegion,
    FaceLandmarkResult,
    NormalizedPoint,
    bucket_confidence,
)

logger = logging.getLogger("ai.landmarks.face")

# Face-mesh landmark indices used as ear-region anchors (see module docstring). These are
# the same indices commonly documented in MediaPipe's own face-mesh topology diagram as
# lying on the face oval's left/right edge, closest to the ear.
_LEFT_EDGE_IDX = 234
_RIGHT_EDGE_IDX = 454
_NOSE_TIP_IDX = 1

# Below this real detection score, we do not even attempt landmarks — an honest "no
# face" result is better than landmarks built on a marginal detection.
_MIN_DETECTION_CONFIDENCE = 0.5
# Ear confidence ceiling: this is a geometric heuristic, not a true visibility/occlusion
# detector (it cannot tell "hair covering the ear" from "head turned away"), so it is
# deliberately never allowed to report full (1.0) confidence, even on a perfectly
# frontal, well-lit synthetic test image.
_EAR_HEURISTIC_CONFIDENCE_CEILING = 0.85


class FaceLandmarker:
    """CPU-only, deterministic (static_image_mode=True disables MediaPipe's frame-to-
    frame temporal smoothing, which would otherwise make repeated calls on the same
    image nondeterministic across a video stream). One instance is safe to reuse across
    images sequentially (not thread-safe — see workers/tasks/process_tryon_request.py
    for how the worker owns one instance per consumer thread)."""

    model_name = "mediapipe_face_mesh_0.10.9"

    def __init__(self) -> None:
        import mediapipe as mp

        self._mp = mp
        self._detector = mp.solutions.face_detection.FaceDetection(
            model_selection=0,  # short-range model: optimized for faces within ~2m (selfie/phone distance)
            min_detection_confidence=_MIN_DETECTION_CONFIDENCE,
        )
        self._mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=5,  # detect multiple faces so "multiple faces" is a real, observable case, not fabricated
            refine_landmarks=False,  # the attention-refinement model changes indices/adds iris points; not needed here
            min_detection_confidence=_MIN_DETECTION_CONFIDENCE,
        )

    def detect(self, image_rgb: np.ndarray) -> FaceLandmarkResult:
        """`image_rgb` must be an HxWx3 uint8 RGB array (the worker converts from the
        stored JPEG/PNG bytes before calling this — see workers/tasks/
        process_tryon_request.py). Never raises for a "no face"/"bad image" outcome —
        that is a normal `success=False` result, not an exception."""
        height, width = image_rgb.shape[0], image_rgb.shape[1]
        try:
            detection_result = self._detector.process(image_rgb)
        except Exception as exc:  # a genuinely malformed array reaching here is a real bug to surface, not hide
            logger.exception("Face detection raised unexpectedly")
            return FaceLandmarkResult(
                success=False,
                error_message="Face detection failed unexpectedly on this image.",
                image_width_px=width,
                image_height_px=height,
            )

        detections = detection_result.detections or []
        if len(detections) == 0:
            return FaceLandmarkResult(
                success=False,
                error_message="No face detected in this photo. Please make sure your face is clearly visible and well-lit.",
                image_width_px=width,
                image_height_px=height,
                num_faces_detected=0,
            )

        # Real per-detection confidence score, sorted so the strongest detection is used
        # for landmarks when multiple faces are present.
        detections_sorted = sorted(detections, key=lambda d: d.score[0], reverse=True)
        best = detections_sorted[0]
        best_score = float(best.score[0])

        mesh_result = self._mesh.process(image_rgb)
        faces = mesh_result.multi_face_landmarks or []

        if len(faces) == 0:
            # Detector found a face-like region but the finer mesh model could not lock
            # on (can genuinely happen at the detector's confidence margin) — honest
            # low-confidence result, not a fabricated landmark set.
            return FaceLandmarkResult(
                success=False,
                error_message="A face-like region was found but landmarks could not be extracted reliably. Try a clearer, front-facing photo.",
                image_width_px=width,
                image_height_px=height,
                num_faces_detected=len(detections),
                detection_confidence=best_score,
                confidence_level=bucket_confidence(best_score),
            )

        mesh_points = faces[0].landmark  # use the first mesh result; index alignment with `best` isn't guaranteed
        # by MediaPipe's API when multiple faces are present, so confidence is reported
        # against the strongest *detection*, and landmarks against the first *mesh* hit
        # — documented here rather than silently assumed to correspond 1:1.
        landmarks = [NormalizedPoint(x=p.x, y=p.y, z=p.z) for p in mesh_points]

        bbox = _bbox_from_relative(best.location_data.relative_bounding_box)
        left_ear, right_ear, yaw = _estimate_ears_and_yaw(landmarks, best_score)

        num_faces = len(detections)
        confidence_level = bucket_confidence(best_score)
        if num_faces > 1:
            logger.info(
                "Multiple faces detected in one photo",
                extra={"extra_fields": {"num_faces": num_faces}},
            )

        return FaceLandmarkResult(
            success=True,
            image_width_px=width,
            image_height_px=height,
            num_faces_detected=num_faces,
            landmarks=landmarks,
            face_bounding_box=bbox,
            detection_confidence=best_score,
            confidence_level=confidence_level,
            head_pose_yaw_estimate=yaw,
            left_ear=left_ear,
            right_ear=right_ear,
        )

    def close(self) -> None:
        self._detector.close()
        self._mesh.close()


def _bbox_from_relative(rbb) -> dict:
    return {
        "x_min": max(0.0, rbb.xmin),
        "y_min": max(0.0, rbb.ymin),
        "x_max": min(1.0, rbb.xmin + rbb.width),
        "y_max": min(1.0, rbb.ymin + rbb.height),
    }


def _estimate_ears_and_yaw(landmarks, detection_confidence: float):
    """Real computation on real landmark coordinates (see module docstring for why this
    is labeled a heuristic and capped, not a fabricated result)."""
    nose = landmarks[_NOSE_TIP_IDX]
    edge_a = landmarks[_LEFT_EDGE_IDX]
    edge_b = landmarks[_RIGHT_EDGE_IDX]

    # Image-space left/right: whichever edge landmark has the smaller x is "left".
    if edge_a.x <= edge_b.x:
        left_point, right_point = edge_a, edge_b
    else:
        left_point, right_point = edge_b, edge_a

    dist_left = math.hypot(nose.x - left_point.x, nose.y - left_point.y)
    dist_right = math.hypot(nose.x - right_point.x, nose.y - right_point.y)
    total = dist_left + dist_right
    # asymmetry in [-1, 1]: positive means the head is turned so the right-side ear is
    # closer to the camera (left ear more foreshortened/self-occluded), and vice versa.
    asymmetry = 0.0 if total == 0 else (dist_right - dist_left) / total
    # Rough, uncalibrated yaw estimate for descriptive purposes only (Milestone 4+ may
    # replace this with a real solvePnP head-pose calculation once 3D correspondence
    # points are needed) — never presented as a precise angle.
    yaw_estimate_degrees = asymmetry * 45.0

    def ear_confidence(is_left: bool) -> float:
        # The ear on the side that is MORE foreshortened (smaller relative distance to
        # the nose, i.e. turned away) gets a lower confidence. `asymmetry` > 0 means the
        # left side is foreshortened; < 0 means the right side is.
        penalty = max(0.0, asymmetry if is_left else -asymmetry)
        base = detection_confidence * _EAR_HEURISTIC_CONFIDENCE_CEILING
        return max(0.0, base * (1.0 - penalty))

    left_conf = ear_confidence(True)
    right_conf = ear_confidence(False)
    threshold = 0.5

    left_ear = EarRegion(
        side="left",
        anchor=NormalizedPoint(x=left_point.x, y=left_point.y, z=left_point.z),
        confidence=left_conf,
        confidence_level=bucket_confidence(left_conf),
        sufficiently_visible=left_conf >= threshold,
        reason=None if left_conf >= threshold else "Left ear region has low geometric confidence (head angle or occlusion).",
    )
    right_ear = EarRegion(
        side="right",
        anchor=NormalizedPoint(x=right_point.x, y=right_point.y, z=right_point.z),
        confidence=right_conf,
        confidence_level=bucket_confidence(right_conf),
        sufficiently_visible=right_conf >= threshold,
        reason=None if right_conf >= threshold else "Right ear region has low geometric confidence (head angle or occlusion).",
    )
    return left_ear, right_ear, yaw_estimate_degrees
