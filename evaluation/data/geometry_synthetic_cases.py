"""
Milestone 4 evaluation dataset — synthetic landmark cases with known expected geometry.

PROVENANCE (spec §32: "document dataset provenance"): every case below is a hand-built
`ai.landmarks.schemas` dataclass (the same application-level shape Milestone 3's real
FaceLandmarker/PoseLandmarker produce), not a photograph, not a customer image, and not
downloaded from anywhere. `expected_anchor_px`/`expected_rotation_degrees`/
`expected_relative_scale_factor` are computed BY HAND in this file, directly from the
documented formulas in ai/geometry/anchors.py, ai/geometry/rotation.py, and
ai/geometry/scale.py's docstrings/constants — i.e. the same arithmetic a human reviewer
would do with a calculator, independent of calling the implementation itself. This is
the evaluation-harness-scale version of what ai/tests/test_geometry_anchors.py etc.
already do per-function; this file exists to give evaluation/run_geometry.py a larger,
parameterized batch (varying face/shoulder size, position, and tilt) to aggregate error
metrics over, per spec §33-34.

Each case also carries a synthetic JewelleryAssetGeometry-equivalent (effective width in
pixels) so scale can be evaluated too, using the SAME relative-scaling constants as the
real engine (ai/geometry/constants.py) — these cases do not exercise the
physical-mm-dimensions path (that path is exercised directly by
ai/tests/test_geometry_scale.py's dedicated physical-scale tests) so this dataset stays
focused on the anchor/rotation geometry every category always goes through.
"""
import math
from dataclasses import dataclass
from typing import Optional

from ai.geometry.constants import (
    EAR_ANCHOR_VERTICAL_OFFSET_FRACTION,
    EARRING_RELATIVE_SCALE_OF_FACE_WIDTH,
    NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION,
    NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH,
)
from ai.landmarks.schemas import ConfidenceLevel, EarRegion, FaceLandmarkResult, NormalizedPoint, PoseLandmarkResult


@dataclass
class GeometrySyntheticCase:
    name: str
    category_slug: str
    side: Optional[str]
    image_width_px: int
    image_height_px: int
    face: Optional[FaceLandmarkResult]
    pose: Optional[PoseLandmarkResult]
    asset_effective_width_px: float
    expect_success: bool
    expected_anchor_px: Optional[tuple] = None  # (x, y)
    expected_rotation_degrees: Optional[float] = None
    expected_scale_factor: Optional[float] = None
    expected_error_code: Optional[str] = None


def _face(
    left_x=0.3, left_y=0.5, right_x=0.7, right_y=0.5, bbox=(0.3, 0.2, 0.7, 0.8),
    left_conf=0.8, right_conf=0.8, edge_left=(0.3, 0.5), edge_right=(0.7, 0.5),
):
    """`edge_left`/`edge_right` populate the two face-mesh landmarks (indices 234/454)
    compute_rotation reads for in-plane roll — kept independently settable from the ear
    anchors themselves so rotation cases can vary tilt without changing anchor cases."""
    landmarks = [NormalizedPoint(x=0.5, y=0.5) for _ in range(455)]
    landmarks[234] = NormalizedPoint(x=edge_left[0], y=edge_left[1])
    landmarks[454] = NormalizedPoint(x=edge_right[0], y=edge_right[1])
    return FaceLandmarkResult(
        success=True,
        landmarks=landmarks,
        confidence_level=ConfidenceLevel.high,
        detection_confidence=0.9,
        face_bounding_box={"x_min": bbox[0], "y_min": bbox[1], "x_max": bbox[2], "y_max": bbox[3]},
        left_ear=EarRegion(
            side="left", anchor=NormalizedPoint(x=left_x, y=left_y), confidence=left_conf,
            confidence_level=ConfidenceLevel.high, sufficiently_visible=left_conf >= 0.5,
        ),
        right_ear=EarRegion(
            side="right", anchor=NormalizedPoint(x=right_x, y=right_y), confidence=right_conf,
            confidence_level=ConfidenceLevel.high, sufficiently_visible=right_conf >= 0.5,
        ),
    )


def _pose(left_x=0.35, right_x=0.65, y=0.4, dy=0.0):
    landmarks = [NormalizedPoint(x=0.5, y=0.1, visibility=0.9) for _ in range(13)]
    landmarks[11] = NormalizedPoint(x=left_x, y=y, visibility=0.9)
    landmarks[12] = NormalizedPoint(x=right_x, y=y + dy, visibility=0.9)
    return PoseLandmarkResult(
        success=True,
        landmarks=landmarks,
        confidence_level=ConfidenceLevel.high,
        shoulder_confidence=0.9,
        neck_anchor=NormalizedPoint(x=(left_x + right_x) / 2, y=(y + y + dy) / 2),
        body_orientation="frontal" if dy == 0 else "turned",
    )


def build_cases() -> list[GeometrySyntheticCase]:
    cases: list[GeometrySyntheticCase] = []

    # --- Earrings: vary face size/position, frontal (rotation 0) ---
    for i, (w, h, bx0, by0, bx1, by1, ex, ey) in enumerate(
        [
            (1000, 1200, 0.30, 0.20, 0.70, 0.80, 0.30, 0.50),  # centered, medium face
            (1920, 1080, 0.35, 0.10, 0.65, 0.70, 0.35, 0.35),  # widescreen, small relative face
            (600, 800, 0.20, 0.15, 0.80, 0.85, 0.20, 0.45),  # narrow image, large face
            (2000, 2000, 0.40, 0.25, 0.60, 0.75, 0.40, 0.45),  # square, small face far from camera
            (800, 1000, 0.25, 0.30, 0.75, 0.90, 0.25, 0.55),  # portrait, low in frame
        ]
    ):
        # Right ear placed symmetrically opposite the left ear around the bbox's own
        # horizontal center (bx0+bx1)/2, so `ex` is the only independent free variable.
        # Both ears at the same normalized height `ey` (a real, deliberate parameter —
        # must be passed through to `_face`, not left at its default, or the "expected"
        # anchor below would silently stop matching what the landmarks actually say).
        right_x = bx0 + bx1 - ex
        face = _face(left_x=ex, left_y=ey, right_x=right_x, right_y=ey, bbox=(bx0, by0, bx1, by1))
        face_height_px = (by1 - by0) * h
        face_width_px = (bx1 - bx0) * w
        expected_x = ex * w
        expected_y = ey * h + EAR_ANCHOR_VERTICAL_OFFSET_FRACTION * face_height_px
        expected_scale = EARRING_RELATIVE_SCALE_OF_FACE_WIDTH * face_width_px / 40.0  # asset effective width fixed at 40px below
        cases.append(
            GeometrySyntheticCase(
                name=f"earring_frontal_{i}", category_slug="earrings", side="left",
                image_width_px=w, image_height_px=h, face=face, pose=None,
                asset_effective_width_px=40.0, expect_success=True,
                expected_anchor_px=(expected_x, expected_y), expected_rotation_degrees=0.0,
                expected_scale_factor=expected_scale,
            )
        )

    # --- Earrings: tilted head (nonzero rotation) ---
    for i, dy in enumerate([0.03, -0.05, 0.08]):
        face = _face(edge_left=(0.3, 0.5), edge_right=(0.7, 0.5 + dy))
        dx_px = 0.4 * 1000
        dy_px = dy * 1200

        expected_rotation = math.degrees(math.atan2(dy_px, dx_px))
        expected_rotation = max(-20.0, min(20.0, expected_rotation))
        face_height_px = (0.8 - 0.2) * 1200
        expected_x = 0.3 * 1000
        expected_y = 0.5 * 1200 + EAR_ANCHOR_VERTICAL_OFFSET_FRACTION * face_height_px
        cases.append(
            GeometrySyntheticCase(
                name=f"earring_tilted_{i}", category_slug="earrings", side="left",
                image_width_px=1000, image_height_px=1200, face=face, pose=None,
                asset_effective_width_px=40.0, expect_success=True,
                expected_anchor_px=(expected_x, expected_y), expected_rotation_degrees=expected_rotation,
                expected_scale_factor=EARRING_RELATIVE_SCALE_OF_FACE_WIDTH * (0.4 * 1000) / 40.0,
            )
        )

    # --- Necklaces: vary shoulder width/position ---
    for i, (w, h, lx, rx, y) in enumerate(
        [
            (1000, 1200, 0.35, 0.65, 0.40),
            (1920, 1080, 0.40, 0.60, 0.35),
            (600, 800, 0.25, 0.75, 0.45),
            (2000, 2000, 0.42, 0.58, 0.50),
            (800, 1000, 0.30, 0.70, 0.55),
        ]
    ):
        pose = _pose(left_x=lx, right_x=rx, y=y)
        shoulder_width_px = (rx - lx) * w
        expected_x = ((lx + rx) / 2) * w
        expected_y = y * h + NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION * shoulder_width_px
        expected_scale = NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH * shoulder_width_px / 150.0
        cases.append(
            GeometrySyntheticCase(
                name=f"necklace_frontal_{i}", category_slug="necklace", side=None,
                image_width_px=w, image_height_px=h, face=None, pose=pose,
                asset_effective_width_px=150.0, expect_success=True,
                expected_anchor_px=(expected_x, expected_y), expected_rotation_degrees=0.0,
                expected_scale_factor=expected_scale,
            )
        )

    # --- Necklace: tilted shoulders ---
    for i, dy in enumerate([0.02, -0.04]):
        pose = _pose(left_x=0.35, right_x=0.65, y=0.4, dy=dy)

        dx_px = 0.3 * 1000
        dy_px = dy * 1200
        expected_rotation = max(-25.0, min(25.0, math.degrees(math.atan2(dy_px, dx_px))))
        shoulder_width_px = 0.3 * 1000
        expected_x = 0.5 * 1000
        # pose.neck_anchor.y is the literal MIDPOINT of the two shoulder y-values (see
        # ai/landmarks/pose.py), i.e. y + dy/2 here, not the un-tilted `y` alone — must
        # match ai/geometry/anchors.py's actual input, not the pre-tilt baseline.
        expected_y = (0.4 + dy / 2) * 1200 + NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION * shoulder_width_px
        cases.append(
            GeometrySyntheticCase(
                name=f"necklace_tilted_{i}", category_slug="necklace", side=None,
                image_width_px=1000, image_height_px=1200, face=None, pose=pose,
                asset_effective_width_px=150.0, expect_success=True,
                expected_anchor_px=(expected_x, expected_y), expected_rotation_degrees=expected_rotation,
                expected_scale_factor=NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH * shoulder_width_px / 150.0,
            )
        )

    # --- Failure cases (spec §37): each must produce a controlled, structured error ---
    cases.append(
        GeometrySyntheticCase(
            name="earring_no_face", category_slug="earrings", side="left",
            image_width_px=1000, image_height_px=1200, face=None, pose=None,
            asset_effective_width_px=40.0, expect_success=False, expected_error_code="FACE_NOT_VISIBLE",
        )
    )
    cases.append(
        GeometrySyntheticCase(
            name="earring_low_confidence_ear", category_slug="earrings", side="left",
            image_width_px=1000, image_height_px=1200,
            face=_face(left_conf=0.1), pose=None,
            asset_effective_width_px=40.0, expect_success=False, expected_error_code="LOW_EAR_CONFIDENCE",
        )
    )
    cases.append(
        GeometrySyntheticCase(
            name="necklace_no_pose", category_slug="necklace", side=None,
            image_width_px=1000, image_height_px=1200, face=None, pose=None,
            asset_effective_width_px=150.0, expect_success=False, expected_error_code="NECK_NOT_VISIBLE",
        )
    )

    return cases
