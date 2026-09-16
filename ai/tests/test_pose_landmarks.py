"""
Real PoseLandmarker tests, plus tests of the documented segmentation-derived fallback
heuristic (`estimate_from_segmentation`) — kept and tested even though the real
detector is used by default, per the spec's requirement to have and test an honest
degradation path.
"""
import os

import numpy as np
import pytest
from PIL import Image

from ai.landmarks.pose import PoseLandmarker, estimate_from_segmentation

REAL_PHOTO = os.path.join(
    os.path.dirname(__file__), "..", "..", "evaluation", "data", "test_images", "opencv_sample_person.jpg"
)


@pytest.fixture(scope="module")
def landmarker():
    pl = PoseLandmarker()
    yield pl
    pl.close()


def _load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def test_no_pose_on_pure_noise(landmarker):
    noise = (np.random.RandomState(3).rand(400, 400, 3) * 255).astype(np.uint8)
    result = landmarker.detect(noise)
    assert result.success is False
    assert result.landmarks == []
    assert result.error_message is not None


def test_real_photo_detects_pose(landmarker):
    image = _load(REAL_PHOTO)
    result = landmarker.detect(image)
    assert result.success is True
    assert len(result.landmarks) == 33  # real MediaPipe Pose topology
    assert 0.0 <= result.shoulder_confidence <= 1.0
    assert result.neck_anchor is not None
    assert result.method == "mediapipe_pose_0.10.9"


def test_visibility_is_real_per_landmark_value(landmarker):
    image = _load(REAL_PHOTO)
    result = landmarker.detect(image)
    assert result.success is True
    visibilities = [p.visibility for p in result.landmarks]
    assert all(v is not None for v in visibilities)
    assert all(0.0 <= v <= 1.0 for v in visibilities)
    # A real model should not report every single landmark as perfectly, identically
    # visible on a natural photo — some variance is expected.
    assert len(set(round(v, 3) for v in visibilities)) > 1


# --- Segmentation-derived fallback heuristic ---


def test_segmentation_heuristic_returns_failure_on_empty_mask():
    empty_mask = np.zeros((200, 200), dtype=np.float32)
    result = estimate_from_segmentation(empty_mask, 200, 200, face_bbox=None)
    assert result.success is False
    assert result.method == "segmentation_heuristic"


def test_segmentation_heuristic_finds_a_shoulder_line_and_caps_confidence():
    mask = np.zeros((200, 200), dtype=np.float32)
    # A person-shaped mask: narrow head (rows 0-60), wide shoulders (rows 60-140).
    mask[0:60, 80:120] = 1.0
    mask[60:140, 40:160] = 1.0
    face_bbox = {"x_min": 0.4, "y_max": 0.3, "x_max": 0.6}
    result = estimate_from_segmentation(mask, 200, 200, face_bbox=face_bbox)
    assert result.success is True
    assert result.method == "segmentation_heuristic"
    assert len(result.landmarks) == 2
    # Documented ceiling: never presented as equivalent to real pose-landmark confidence.
    assert result.shoulder_confidence <= 0.55
