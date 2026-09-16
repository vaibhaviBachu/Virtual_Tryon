"""
compute_rotation() — spec §10, §15, §28: derive rotation from real detected
orientation, never a fixed angle. Falls back to a documented, explicitly-labeled
neutral rotation when the landmark data does not support a reliable estimate (spec
§10: "if the Milestone 3 landmark representation does not contain enough information
for reliable rotation, document the limitation rather than inventing a value").

KNOWN LIMITATION (read before assuming this is a full 3D head-pose solve): Milestone 3
does not compute a calibrated 3D head pose (no solvePnP, no camera intrinsics) — see
ai/landmarks/face.py's own docstring. What IS available is genuine 2D landmark geometry:
the line between the two face-oval edge landmarks (234/454) for in-plane face roll, and
the line between the two detected shoulder landmarks for body/shoulder tilt. Both are
real, computed angles from real landmark positions — not fabricated — but they estimate
IN-PLANE (roll) rotation only, not the yaw/pitch a true 3D pose would give. This is
documented here, in ai/geometry/constants.py (the rotation caps), and in
docs/milestone-4-verification.md's "Rotation assumptions" section.
"""
import math
from typing import Optional

from ai.geometry.constants import MAX_EARRING_ROTATION_DEGREES, MAX_NECKLACE_ROTATION_DEGREES
from ai.geometry.schemas import RotationResult
from ai.landmarks.schemas import ConfidenceLevel, FaceLandmarkResult, PoseLandmarkResult

_LEFT_EDGE_IDX = 234
_RIGHT_EDGE_IDX = 454
_LEFT_SHOULDER_IDX = 11
_RIGHT_SHOULDER_IDX = 12


def compute_rotation(
    category_slug: str,
    face: Optional[FaceLandmarkResult],
    pose: Optional[PoseLandmarkResult],
    image_width_px: int,
    image_height_px: int,
) -> RotationResult:
    if category_slug == "earrings":
        return _compute_earring_rotation(face, image_width_px, image_height_px)
    if category_slug == "necklace":
        return _compute_necklace_rotation(pose, image_width_px, image_height_px)
    return RotationResult(success=False, method="unsupported_category")


def _compute_earring_rotation(
    face: Optional[FaceLandmarkResult], image_width_px: int, image_height_px: int
) -> RotationResult:
    if (
        face is None
        or not face.success
        or len(face.landmarks) <= max(_LEFT_EDGE_IDX, _RIGHT_EDGE_IDX)
    ):
        # Documented limitation, not an invented value: with no usable landmarks the
        # honest choice is a neutral (0deg) rotation — a frontal-face assumption, not a
        # claim that the head is actually frontal.
        return RotationResult(
            success=False,
            rotation_degrees=0.0,
            method="neutral_fallback_no_landmarks",
            assumptions=["No face-mesh landmarks were available; assumed a neutral (0deg) earring rotation."],
        )

    left = face.landmarks[_LEFT_EDGE_IDX]
    right = face.landmarks[_RIGHT_EDGE_IDX]
    # Convert to pixel space before computing the angle so a non-square image's aspect
    # ratio does not distort the measured angle (spec §29's "be extremely careful about
    # width vs height" rule).
    dx = (right.x - left.x) * image_width_px
    dy = (right.y - left.y) * image_height_px
    raw_degrees = math.degrees(math.atan2(dy, dx))
    clamped = max(-MAX_EARRING_ROTATION_DEGREES, min(MAX_EARRING_ROTATION_DEGREES, raw_degrees))

    assumptions = [
        "Rotation estimated from the in-plane angle between face-mesh edge landmarks "
        "234/454 (a 2D roll estimate, not a calibrated 3D head pose — see module "
        "docstring)."
    ]
    if clamped != raw_degrees:
        assumptions.append(
            f"Raw estimate {raw_degrees:.2f}deg was clamped to +/-{MAX_EARRING_ROTATION_DEGREES}deg as a safety bound."
        )

    confidence = 0.6 if face.confidence_level in (ConfidenceLevel.high, ConfidenceLevel.medium) else 0.3
    return RotationResult(
        success=True,
        rotation_degrees=clamped,
        method="face_edge_landmark_roll",
        confidence=confidence,
        assumptions=assumptions,
    )


def _compute_necklace_rotation(
    pose: Optional[PoseLandmarkResult], image_width_px: int, image_height_px: int
) -> RotationResult:
    if pose is None or not pose.success or len(pose.landmarks) <= max(_LEFT_SHOULDER_IDX, _RIGHT_SHOULDER_IDX):
        return RotationResult(
            success=False,
            rotation_degrees=0.0,
            method="neutral_fallback_no_landmarks",
            assumptions=["No shoulder landmarks were available; assumed a neutral (0deg) necklace rotation."],
        )

    left = pose.landmarks[_LEFT_SHOULDER_IDX]
    right = pose.landmarks[_RIGHT_SHOULDER_IDX]
    dx = (right.x - left.x) * image_width_px
    dy = (right.y - left.y) * image_height_px
    raw_degrees = math.degrees(math.atan2(dy, dx))
    clamped = max(-MAX_NECKLACE_ROTATION_DEGREES, min(MAX_NECKLACE_ROTATION_DEGREES, raw_degrees))

    assumptions = [
        "Rotation estimated from the in-plane angle of the line between the detected "
        "left/right shoulder landmarks (a 2D tilt estimate, not a calibrated 3D body "
        "pose — see module docstring)."
    ]
    if clamped != raw_degrees:
        assumptions.append(
            f"Raw estimate {raw_degrees:.2f}deg was clamped to +/-{MAX_NECKLACE_ROTATION_DEGREES}deg as a safety bound."
        )

    confidence = 0.6 if pose.confidence_level in (ConfidenceLevel.high, ConfidenceLevel.medium) else 0.3
    return RotationResult(
        success=True,
        rotation_degrees=clamped,
        method="shoulder_landmark_tilt",
        confidence=confidence,
        assumptions=assumptions,
    )
