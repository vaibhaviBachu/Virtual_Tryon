import pytest

from ai.geometry.constants import NECKLACE_MIN_REQUIRED_VERTICAL_SPACE_FRACTION
from ai.geometry.framing import CATEGORY_FRAMING_EVALUATORS, evaluate_necklace_framing
from ai.landmarks.schemas import ConfidenceLevel, NormalizedPoint, PoseLandmarkResult


def _pose_with_shoulders(left_x=0.35, right_x=0.65, y=0.4) -> PoseLandmarkResult:
    landmarks = [NormalizedPoint(x=0.5, y=0.1, visibility=0.9) for _ in range(13)]
    landmarks[11] = NormalizedPoint(x=left_x, y=y, visibility=0.9)
    landmarks[12] = NormalizedPoint(x=right_x, y=y, visibility=0.9)
    return PoseLandmarkResult(
        success=True,
        landmarks=landmarks,
        shoulder_confidence=0.9,
        confidence_level=ConfidenceLevel.high,
        neck_anchor=NormalizedPoint(x=(left_x + right_x) / 2, y=y),
        body_orientation="frontal",
    )


def test_registry_only_registers_necklace_this_milestone():
    # Spec §26: rings/bangles/bracelets/maang tikka/nose ring are explicitly out of
    # scope this milestone and must not silently appear as "functional" here.
    assert set(CATEGORY_FRAMING_EVALUATORS.keys()) == {"necklace"}
    assert CATEGORY_FRAMING_EVALUATORS["necklace"] is evaluate_necklace_framing


def test_flags_insufficient_framing_matching_real_production_bug():
    """Reproduces the exact real photo that started this investigation: shoulders
    confidently detected (shoulder_confidence=0.9 >= NECK_CONFIDENCE_THRESHOLD) but
    framed close enough to the bottom edge that, after the documented collarbone
    offset, there is negative space left below the anchor in a 640x480 photo (measured
    real numbers: shoulder_width_px~=381.42, anchor_px.y~=526.32)."""
    pose = _pose_with_shoulders(left_x=0.202, right_x=0.798, y=0.9217)
    result = evaluate_necklace_framing(pose, image_width_px=640, image_height_px=480)

    assert result.ready is False
    assert result.reason_code == "INSUFFICIENT_FRAMING"
    assert result.user_message == "Please retake the photo with more of your upper chest visible."
    assert "Predicted necklace anchor" in result.technical_reason
    assert result.metrics["shoulder_width_px"] == pytest.approx(381.42, abs=0.5)
    assert result.metrics["available_below_px"] < 0


def test_allows_comfortably_framed_photo():
    """The SAME shoulder width as the failing case above, but shoulders framed near the
    vertical middle of the photo (spec §11: 'do not overreject' — a photo with
    comfortable room must be accepted)."""
    pose = _pose_with_shoulders(left_x=0.202, right_x=0.798, y=0.4)
    result = evaluate_necklace_framing(pose, image_width_px=640, image_height_px=480)

    assert result.ready is True
    assert result.reason_code is None
    assert result.metrics["available_below_px"] > result.metrics["required_vertical_space_px"]


@pytest.mark.parametrize("width,height", [(640, 480), (1280, 720), (1920, 1080), (1080, 1920), (1000, 1000)])
def test_ready_decision_is_resolution_independent_for_the_same_normalized_framing(width, height):
    """Spec §14: 'Do not introduce resolution-specific pixel constants' — the same
    NORMALIZED shoulder position/width must produce the same accept/reject decision
    regardless of the photo's actual pixel dimensions (640x480 through 1920x1080,
    portrait and square included)."""
    comfortable = _pose_with_shoulders(left_x=0.3, right_x=0.7, y=0.4)
    tight = _pose_with_shoulders(left_x=0.3, right_x=0.7, y=0.95)

    assert evaluate_necklace_framing(comfortable, width, height).ready is True
    assert evaluate_necklace_framing(tight, width, height).ready is False


@pytest.mark.parametrize("center_x", [0.5, 0.2, 0.8, 0.1, 0.9])
def test_ready_decision_is_independent_of_horizontal_shoulder_position(center_x):
    """Spec §15: 'different body positions... left/right-of-center... the algorithm
    must adapt' — holding the shoulder WIDTH (0.3 of the frame) and vertical position
    fixed, only where the pair sits horizontally changes; the accept/reject decision
    must not."""
    half_width = 0.15
    pose = _pose_with_shoulders(left_x=center_x - half_width, right_x=center_x + half_width, y=0.4)
    result = evaluate_necklace_framing(pose, image_width_px=640, image_height_px=480)
    assert result.ready is True


def test_wider_shoulders_require_proportionally_more_vertical_space():
    """The required-space threshold scales with the REAL, measured shoulder width
    (closer subject / larger shoulder-width-in-pixels), not a fixed pixel constant —
    spec §15's 'different user distances' requirement."""
    close_up = _pose_with_shoulders(left_x=0.1, right_x=0.9, y=0.75)  # wide shoulders, closer subject
    far_away = _pose_with_shoulders(left_x=0.4, right_x=0.6, y=0.75)  # narrow shoulders, distant subject

    close_result = evaluate_necklace_framing(close_up, image_width_px=640, image_height_px=480)
    far_result = evaluate_necklace_framing(far_away, image_width_px=640, image_height_px=480)

    assert close_result.metrics["required_vertical_space_px"] > far_result.metrics["required_vertical_space_px"]
    assert close_result.ready is False  # a close-up subject needs much more room below the same anchor fraction
    assert far_result.ready is True


def test_required_space_is_documented_fraction_of_shoulder_width():
    pose = _pose_with_shoulders(left_x=0.3, right_x=0.7, y=0.4)
    result = evaluate_necklace_framing(pose, image_width_px=640, image_height_px=480)
    expected_shoulder_width_px = 0.4 * 640
    expected_required = NECKLACE_MIN_REQUIRED_VERTICAL_SPACE_FRACTION * expected_shoulder_width_px
    assert result.metrics["required_vertical_space_px"] == pytest.approx(expected_required)


def test_no_pose_fails_with_structured_neck_not_visible_code():
    result = evaluate_necklace_framing(None, image_width_px=640, image_height_px=480)
    assert result.ready is False
    assert result.reason_code == "NECK_NOT_VISIBLE"
    assert result.metrics == {}


def test_low_confidence_pose_fails_with_structured_code_from_the_shared_anchor_model():
    """This pre-check reuses ai.geometry.anchors.compute_anchor directly (spec §12: not
    a second, inconsistent reference frame), so an unsuccessful pose also fails here
    with the same error_code that function already produces."""
    pose = PoseLandmarkResult(success=False, error_message="Pose analysis failed unexpectedly.")
    result = evaluate_necklace_framing(pose, image_width_px=640, image_height_px=480)
    assert result.ready is False
    assert result.reason_code == "NECK_NOT_VISIBLE"
