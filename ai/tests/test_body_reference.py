import pytest

from ai.geometry.body_reference import compute_body_reference_frame
from ai.landmarks.schemas import ConfidenceLevel, NormalizedPoint, PoseLandmarkResult

IMAGE_W, IMAGE_H = 640, 480


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


def test_frame_reports_real_measured_shoulder_geometry():
    pose = _pose_with_shoulders(left_x=0.35, right_x=0.65, y=0.4)
    frame = compute_body_reference_frame(pose, IMAGE_W, IMAGE_H)

    assert frame is not None
    assert frame.left_shoulder_px.x == pytest.approx(0.35 * IMAGE_W)
    assert frame.right_shoulder_px.x == pytest.approx(0.65 * IMAGE_W)
    assert frame.shoulder_midpoint_px.x == pytest.approx(0.5 * IMAGE_W)
    assert frame.shoulder_midpoint_px.y == pytest.approx(0.4 * IMAGE_H)
    assert frame.shoulder_width_px == pytest.approx(0.3 * IMAGE_W)
    assert frame.vertical_body_direction == (0.0, 1.0)


def test_frame_is_none_without_a_successful_pose():
    assert compute_body_reference_frame(None, IMAGE_W, IMAGE_H) is None
    assert compute_body_reference_frame(PoseLandmarkResult(success=False), IMAGE_W, IMAGE_H) is None


def test_frame_is_none_when_shoulder_landmarks_are_missing():
    pose = PoseLandmarkResult(success=True, landmarks=[NormalizedPoint(x=0.5, y=0.1) for _ in range(5)])
    assert compute_body_reference_frame(pose, IMAGE_W, IMAGE_H) is None
