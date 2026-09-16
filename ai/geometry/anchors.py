"""
compute_anchor() — spec §7, §8, §12, §13, §28: derive the BODY_ANCHOR from real
Milestone 3 landmarks, never a hard-coded pixel coordinate.

Normalized [0,1] -> pixel conversion happens ONLY here (spec §29) — every other module
in ai/geometry receives/produces pixel coordinates already.
"""
from typing import Optional

from ai.geometry.constants import (
    EAR_ANCHOR_VERTICAL_OFFSET_FRACTION,
    NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION,
)
from ai.geometry.schemas import AnchorResult, Point
from ai.landmarks.schemas import FaceLandmarkResult, PoseLandmarkResult


def compute_anchor(
    category_slug: str,
    side: Optional[str],
    face: Optional[FaceLandmarkResult],
    pose: Optional[PoseLandmarkResult],
    image_width_px: int,
    image_height_px: int,
) -> AnchorResult:
    """Category-specific BODY_ANCHOR derivation (spec §19: category-specific anchor
    models are expected, not a single generic rule). Every returned anchor_px is in the
    user PHOTO's pixel space (image_width_px x image_height_px)."""
    if category_slug == "earring":
        return _compute_ear_anchor(side, face, image_width_px, image_height_px)
    if category_slug == "necklace":
        return _compute_necklace_anchor(pose, image_width_px, image_height_px)
    return AnchorResult(
        success=False,
        error_code="UNSUPPORTED_CATEGORY",
        error_message=f"Geometry engine has no anchor model for category {category_slug!r} in Milestone 4.",
    )


def _compute_ear_anchor(
    side: Optional[str],
    face: Optional[FaceLandmarkResult],
    image_width_px: int,
    image_height_px: int,
) -> AnchorResult:
    if face is None or not face.success:
        return AnchorResult(
            success=False,
            error_code="FACE_NOT_VISIBLE",
            error_message="No face was detected in this photo, so an ear anchor cannot be computed.",
        )

    ear = face.left_ear if side == "left" else face.right_ear if side == "right" else None
    if ear is None:
        return AnchorResult(
            success=False,
            error_code="EAR_NOT_VISIBLE",
            error_message=f"Unknown or missing ear side {side!r}.",
        )
    if not ear.sufficiently_visible or ear.anchor is None:
        return AnchorResult(
            success=False,
            error_code="EAR_NOT_VISIBLE" if ear.confidence <= 0 else "LOW_EAR_CONFIDENCE",
            error_message=ear.reason or f"{side} ear is not clearly visible.",
        )

    bbox = face.face_bounding_box or {}
    face_width_px = (bbox.get("x_max", 0.0) - bbox.get("x_min", 0.0)) * image_width_px
    face_height_px = (bbox.get("y_max", 0.0) - bbox.get("y_min", 0.0)) * image_height_px

    # Denormalize (spec §29: the one place this happens for this anchor).
    raw_x_px = ear.anchor.x * image_width_px
    raw_y_px = ear.anchor.y * image_height_px

    # Documented correction (see ai/geometry/constants.py's
    # EAR_ANCHOR_VERTICAL_OFFSET_FRACTION docstring): landmarks 234/454 sit at the
    # cheek/ear boundary, not the earlobe, so nudge down using the face's own measured
    # height as the reference scale — never an absolute pixel offset (which would not
    # scale with face size/image resolution, per spec §36's "different face sizes,
    # different image resolutions" test requirement).
    anchor_px = Point(x=raw_x_px, y=raw_y_px + EAR_ANCHOR_VERTICAL_OFFSET_FRACTION * face_height_px)

    return AnchorResult(
        success=True,
        anchor_px=anchor_px,
        reference_measurement_px=face_width_px,
        method="face_mesh_edge_landmark_with_earlobe_offset",
    )


def _compute_necklace_anchor(
    pose: Optional[PoseLandmarkResult],
    image_width_px: int,
    image_height_px: int,
) -> AnchorResult:
    if pose is None or not pose.success or pose.neck_anchor is None:
        return AnchorResult(
            success=False,
            error_code="NECK_NOT_VISIBLE",
            error_message="Shoulders/neck were not clearly detected in this photo, so a necklace anchor cannot be computed.",
        )

    landmarks = pose.landmarks
    if len(landmarks) < 13:
        return AnchorResult(
            success=False,
            error_code="NECK_NOT_VISIBLE",
            error_message="Pose landmarks did not include both shoulders.",
        )

    left_shoulder = landmarks[11]
    right_shoulder = landmarks[12]
    shoulder_width_px = abs(right_shoulder.x - left_shoulder.x) * image_width_px

    raw_x_px = pose.neck_anchor.x * image_width_px
    raw_y_px = pose.neck_anchor.y * image_height_px

    # Documented correction (see constants.py's NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION
    # docstring): the shoulder midpoint sits at shoulder height, not at the
    # collarbone/upper-chest resting point of a necklace — offset scaled by the
    # measured shoulder width (a real, per-photo body-scale reference), not a fixed
    # pixel constant.
    anchor_px = Point(
        x=raw_x_px,
        y=raw_y_px + NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION * shoulder_width_px,
    )

    return AnchorResult(
        success=True,
        anchor_px=anchor_px,
        reference_measurement_px=shoulder_width_px,
        method="pose_shoulder_midpoint_with_collarbone_offset",
    )
