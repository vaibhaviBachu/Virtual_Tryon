"""
BodyReferenceFrame — Milestone 4 stabilization spec ("NECKLACE GEOMETRY CALIBRATION")
§3: "Build the necklace placement around a body reference frame... derive the
necklace anchor from normalized geometry."

This module makes the reference frame ai.geometry.anchors._compute_necklace_anchor
already implicitly used (shoulder midpoint, shoulder width) an explicit, independently
testable object, rather than inline arithmetic buried in the anchor function. Extracting
it does NOT change any anchor numbers by itself (see ai/tests/test_body_reference.py's
regression test) — it is a structural change so the reference frame can be inspected,
debug-visualized (spec §11), and reused if a future category needs the same body
geometry, without duplicating the shoulder-midpoint/width arithmetic.

HONEST LIMITATION (spec §3's own "do not assume... is automatically correct"): Milestone
3's pose landmarks do not include hip/torso landmarks, so `vertical_body_direction` here
is NOT derived from a measured hip position — it is the image's own downward axis (0, 1)
in pixel space. This is a documented assumption (frontal-ish subject, camera roughly
level), not a claim that the code measures actual torso lean. A slightly rotated body is
still handled by the shoulder LINE's own tilt (used by ai.geometry.rotation), but the
vertical reference for offsetting from shoulder-height to collarbone-height remains
image-down. Fixing this properly would require Milestone 3 to expose hip landmarks,
which is out of scope for this task.
"""
from dataclasses import dataclass
from typing import Optional

from ai.geometry.schemas import Point
from ai.landmarks.schemas import PoseLandmarkResult

_LEFT_SHOULDER_IDX = 11
_RIGHT_SHOULDER_IDX = 12


@dataclass
class BodyReferenceFrame:
    """A real, measured normalized body reference frame in the USER PHOTO's pixel
    space (spec §3's "left shoulder, right shoulder, shoulder midpoint, shoulder
    width, vertical body direction").

    NAMING NOTE: `left_shoulder_px`/`right_shoulder_px` are the SUBJECT'S OWN anatomical
    left/right (MediaPipe Pose landmarks 11/12 -- see ai/landmarks/pose.py), not
    screen-position labels. For an ordinary, non-mirrored, front-facing photo,
    `left_shoulder_px` typically has the LARGER x (it appears on the image's right side)
    and `right_shoulder_px` the smaller x. `shoulder_midpoint_px` and `shoulder_width_px`
    are computed order-independently (midpoint/abs-difference) so this labeling doesn't
    affect them, but ai.geometry.rotation's necklace rotation formula IS order-sensitive
    and had a real ~180deg sign bug from assuming the opposite (screen-position)
    convention -- see that module's docstring."""

    left_shoulder_px: Point
    right_shoulder_px: Point
    shoulder_midpoint_px: Point
    shoulder_width_px: float
    # Unit vector, image pixel space, pointing from the shoulder line toward the feet
    # (see module docstring's honest limitation: currently always (0, 1) — image-down
    # — because Milestone 3 does not expose hip/torso landmarks to measure this from).
    vertical_body_direction: "tuple[float, float]"


def compute_body_reference_frame(
    pose: Optional[PoseLandmarkResult],
    image_width_px: int,
    image_height_px: int,
) -> Optional[BodyReferenceFrame]:
    """Returns None (never a fabricated frame) if both shoulder landmarks are not
    available — callers must handle this exactly as ai.geometry.anchors already does
    for a missing pose."""
    if pose is None or not pose.success:
        return None
    landmarks = pose.landmarks
    if len(landmarks) <= max(_LEFT_SHOULDER_IDX, _RIGHT_SHOULDER_IDX):
        return None

    left = landmarks[_LEFT_SHOULDER_IDX]
    right = landmarks[_RIGHT_SHOULDER_IDX]
    left_px = Point(x=left.x * image_width_px, y=left.y * image_height_px)
    right_px = Point(x=right.x * image_width_px, y=right.y * image_height_px)
    midpoint_px = Point(x=(left_px.x + right_px.x) / 2.0, y=(left_px.y + right_px.y) / 2.0)
    shoulder_width_px = abs(right_px.x - left_px.x)

    return BodyReferenceFrame(
        left_shoulder_px=left_px,
        right_shoulder_px=right_px,
        shoulder_midpoint_px=midpoint_px,
        shoulder_width_px=shoulder_width_px,
        vertical_body_direction=(0.0, 1.0),
    )
