import math

import pytest

from ai.geometry.constants import MAX_EARRING_ROTATION_DEGREES, MAX_NECKLACE_ROTATION_DEGREES
from ai.geometry.rotation import compute_rotation
from ai.landmarks.schemas import ConfidenceLevel, FaceLandmarkResult, NormalizedPoint, PoseLandmarkResult

IMAGE_W, IMAGE_H = 1000, 1000


def _face_with_edge_landmarks(dy=0.0):
    landmarks = [NormalizedPoint(x=0.5, y=0.5) for _ in range(455)]
    landmarks[234] = NormalizedPoint(x=0.3, y=0.5)
    landmarks[454] = NormalizedPoint(x=0.7, y=0.5 + dy)
    return FaceLandmarkResult(
        success=True, landmarks=landmarks, confidence_level=ConfidenceLevel.high,
        image_width_px=IMAGE_W, image_height_px=IMAGE_H,
    )


def test_frontal_face_rotation_is_near_neutral():
    face = _face_with_edge_landmarks(dy=0.0)
    result = compute_rotation("earring", face, None, IMAGE_W, IMAGE_H)
    assert result.success is True
    assert result.rotation_degrees == pytest.approx(0.0, abs=1e-6)


def test_tilted_face_produces_nonzero_rotation_matching_geometry():
    face = _face_with_edge_landmarks(dy=0.05)
    result = compute_rotation("earring", face, None, IMAGE_W, IMAGE_H)
    dx_px = 0.4 * IMAGE_W
    dy_px = 0.05 * IMAGE_H
    expected = math.degrees(math.atan2(dy_px, dx_px))
    assert result.rotation_degrees == pytest.approx(expected, abs=1e-6)


def test_earring_rotation_is_capped_for_extreme_tilt():
    face = _face_with_edge_landmarks(dy=5.0)  # absurd landmark noise
    result = compute_rotation("earring", face, None, IMAGE_W, IMAGE_H)
    assert abs(result.rotation_degrees) <= MAX_EARRING_ROTATION_DEGREES


def test_earring_rotation_neutral_fallback_when_no_face():
    result = compute_rotation("earring", None, None, IMAGE_W, IMAGE_H)
    assert result.success is False
    assert result.rotation_degrees == 0.0
    assert result.method == "neutral_fallback_no_landmarks"


def _pose_with_shoulders(dy=0.0):
    landmarks = [NormalizedPoint(x=0.5, y=0.1, visibility=0.9) for _ in range(13)]
    landmarks[11] = NormalizedPoint(x=0.35, y=0.4, visibility=0.9)
    landmarks[12] = NormalizedPoint(x=0.65, y=0.4 + dy, visibility=0.9)
    return PoseLandmarkResult(
        success=True, landmarks=landmarks, confidence_level=ConfidenceLevel.high,
        image_width_px=IMAGE_W, image_height_px=IMAGE_H,
    )


def test_frontal_shoulders_rotation_is_neutral():
    pose = _pose_with_shoulders(dy=0.0)
    result = compute_rotation("necklace", None, pose, IMAGE_W, IMAGE_H)
    assert result.rotation_degrees == pytest.approx(0.0, abs=1e-6)


def test_necklace_rotation_capped_for_extreme_tilt():
    pose = _pose_with_shoulders(dy=5.0)
    result = compute_rotation("necklace", None, pose, IMAGE_W, IMAGE_H)
    assert abs(result.rotation_degrees) <= MAX_NECKLACE_ROTATION_DEGREES


def test_necklace_rotation_neutral_fallback_when_no_pose():
    result = compute_rotation("necklace", None, None, IMAGE_W, IMAGE_H)
    assert result.success is False
    assert result.rotation_degrees == 0.0
