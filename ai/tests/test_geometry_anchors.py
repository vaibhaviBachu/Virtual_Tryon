"""
Deterministic unit tests for compute_anchor() using synthetic landmark coordinates
(spec §35: "given known landmarks, expected anchor = X,Y, verify compute_anchor()
within a defined tolerance").
"""
import pytest

from ai.geometry.anchors import compute_anchor
from ai.geometry.constants import EAR_ANCHOR_VERTICAL_OFFSET_FRACTION, NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION
from ai.landmarks.schemas import ConfidenceLevel, EarRegion, FaceLandmarkResult, NormalizedPoint, PoseLandmarkResult

IMAGE_W, IMAGE_H = 1000, 1200


def _face_with_ears(left_conf=0.8, right_conf=0.8) -> FaceLandmarkResult:
    return FaceLandmarkResult(
        success=True,
        image_width_px=IMAGE_W,
        image_height_px=IMAGE_H,
        num_faces_detected=1,
        detection_confidence=0.9,
        confidence_level=ConfidenceLevel.high,
        face_bounding_box={"x_min": 0.3, "y_min": 0.2, "x_max": 0.7, "y_max": 0.8},
        left_ear=EarRegion(
            side="left", anchor=NormalizedPoint(x=0.3, y=0.5), confidence=left_conf,
            confidence_level=ConfidenceLevel.high, sufficiently_visible=left_conf >= 0.5,
        ),
        right_ear=EarRegion(
            side="right", anchor=NormalizedPoint(x=0.7, y=0.5), confidence=right_conf,
            confidence_level=ConfidenceLevel.high, sufficiently_visible=right_conf >= 0.5,
        ),
    )


def test_ear_anchor_applies_documented_vertical_offset():
    face = _face_with_ears()
    result = compute_anchor("earrings", "left", face, None, IMAGE_W, IMAGE_H)
    assert result.success is True
    face_height_px = (0.8 - 0.2) * IMAGE_H
    expected_x = 0.3 * IMAGE_W
    expected_y = 0.5 * IMAGE_H + EAR_ANCHOR_VERTICAL_OFFSET_FRACTION * face_height_px
    assert result.anchor_px.x == pytest.approx(expected_x, abs=1e-6)
    assert result.anchor_px.y == pytest.approx(expected_y, abs=1e-6)


def test_ear_anchor_reference_measurement_is_face_bbox_width_px():
    face = _face_with_ears()
    result = compute_anchor("earrings", "right", face, None, IMAGE_W, IMAGE_H)
    expected_face_width_px = (0.7 - 0.3) * IMAGE_W
    assert result.reference_measurement_px == pytest.approx(expected_face_width_px)


def test_ear_anchor_fails_with_structured_code_when_no_face():
    result = compute_anchor("earrings", "left", None, None, IMAGE_W, IMAGE_H)
    assert result.success is False
    assert result.error_code == "FACE_NOT_VISIBLE"


def test_ear_anchor_fails_with_structured_code_when_low_confidence():
    face = _face_with_ears(left_conf=0.1)
    result = compute_anchor("earrings", "left", face, None, IMAGE_W, IMAGE_H)
    assert result.success is False
    assert result.error_code in ("EAR_NOT_VISIBLE", "LOW_EAR_CONFIDENCE")


def _pose_with_shoulders(left_x=0.35, right_x=0.65, y=0.4) -> PoseLandmarkResult:
    landmarks = [NormalizedPoint(x=0.5, y=0.1, visibility=0.9) for _ in range(13)]
    landmarks[11] = NormalizedPoint(x=left_x, y=y, visibility=0.9)
    landmarks[12] = NormalizedPoint(x=right_x, y=y, visibility=0.9)
    return PoseLandmarkResult(
        success=True,
        image_width_px=IMAGE_W,
        image_height_px=IMAGE_H,
        landmarks=landmarks,
        shoulder_confidence=0.9,
        confidence_level=ConfidenceLevel.high,
        neck_anchor=NormalizedPoint(x=(left_x + right_x) / 2, y=y),
        body_orientation="frontal",
    )


def test_necklace_anchor_applies_documented_vertical_offset():
    pose = _pose_with_shoulders()
    result = compute_anchor("necklace", None, None, pose, IMAGE_W, IMAGE_H)
    assert result.success is True
    shoulder_width_px = (0.65 - 0.35) * IMAGE_W
    expected_x = 0.5 * IMAGE_W
    expected_y = 0.4 * IMAGE_H + NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION * shoulder_width_px
    assert result.anchor_px.x == pytest.approx(expected_x, abs=1e-6)
    assert result.anchor_px.y == pytest.approx(expected_y, abs=1e-6)
    assert result.reference_measurement_px == pytest.approx(shoulder_width_px)


def test_necklace_anchor_fails_with_structured_code_when_no_pose():
    result = compute_anchor("necklace", None, None, None, IMAGE_W, IMAGE_H)
    assert result.success is False
    assert result.error_code == "NECK_NOT_VISIBLE"


def test_necklace_length_none_and_medium_are_numerically_identical_to_unchanged_behavior():
    """Calibration spec §4/§13: the necklace-length hook must not silently change
    today's shipped anchor for the default/unspecified case."""
    pose = _pose_with_shoulders()
    baseline = compute_anchor("necklace", None, None, pose, IMAGE_W, IMAGE_H)
    with_none = compute_anchor("necklace", None, None, pose, IMAGE_W, IMAGE_H, necklace_length=None)
    with_medium = compute_anchor("necklace", None, None, pose, IMAGE_W, IMAGE_H, necklace_length="medium")

    assert with_none.anchor_px.y == pytest.approx(baseline.anchor_px.y)
    assert with_medium.anchor_px.y == pytest.approx(baseline.anchor_px.y)


def test_necklace_length_short_and_long_are_distinct_but_uncalibrated_placeholders():
    """These multipliers are explicitly documented in ai.geometry.constants as
    UNCALIBRATED placeholders — this test only guards that the hook wires through
    correctly (short < medium < long), not that the numbers are correct for any real
    photo."""
    pose = _pose_with_shoulders()
    baseline = compute_anchor("necklace", None, None, pose, IMAGE_W, IMAGE_H)
    short = compute_anchor("necklace", None, None, pose, IMAGE_W, IMAGE_H, necklace_length="short")
    long_ = compute_anchor("necklace", None, None, pose, IMAGE_W, IMAGE_H, necklace_length="long")

    assert short.anchor_px.y < baseline.anchor_px.y < long_.anchor_px.y


def test_unsupported_category_returns_structured_error():
    result = compute_anchor("ring", None, None, None, IMAGE_W, IMAGE_H)
    assert result.success is False
    assert result.error_code == "UNSUPPORTED_CATEGORY"
