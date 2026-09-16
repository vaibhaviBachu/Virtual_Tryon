"""
Real HandLandmarker tests. Positive-path detection uses the real, appropriately
licensed photograph documented in evaluation/data/test_images/SOURCES.md (the synthetic
PIL-drawn hand shapes in evaluation/users/hand_visible/ were NOT detected by the real
model — an honest, reported finding, see docs/milestone-3-verification.md §9 — so a
real photograph is used here instead of a shape MediaPipe correctly does not treat as a
hand).
"""
import os

import numpy as np
import pytest
from PIL import Image

from ai.landmarks.hand import HandLandmarker

REAL_PHOTO = os.path.join(
    os.path.dirname(__file__), "..", "..", "evaluation", "data", "test_images", "opencv_sample_person.jpg"
)


@pytest.fixture(scope="module")
def landmarker():
    hl = HandLandmarker()
    yield hl
    hl.close()


def _load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def test_no_hand_on_pure_noise(landmarker):
    noise = (np.random.RandomState(1).rand(400, 400, 3) * 255).astype(np.uint8)
    result = landmarker.detect(noise)
    assert result.success is True  # "no hand" is a legitimate success, not a failure
    assert result.hands_detected == 0
    assert result.state == "no_hand_detected"
    assert result.hands == []


def test_real_photo_detects_at_least_one_hand(landmarker):
    image = _load(REAL_PHOTO)
    result = landmarker.detect(image)
    assert result.success is True
    assert result.hands_detected >= 1
    assert result.state in ("one_hand", "two_hands", "low_confidence")
    for hand in result.hands:
        assert len(hand.landmarks) == 21  # real MediaPipe hand topology
        assert 0.0 <= hand.handedness_confidence <= 1.0
        assert hand.side in ("left", "right")


def test_state_distinguishes_hand_counts(landmarker):
    """Contract test: state must accurately reflect hands_detected, never claim
    "two_hands" for a single detection or vice versa."""
    image = _load(REAL_PHOTO)
    result = landmarker.detect(image)
    if result.hands_detected == 1:
        assert result.state != "two_hands"
    if result.hands_detected == 0:
        assert result.state == "no_hand_detected"


def test_never_fabricates_landmarks_when_none_detected(landmarker):
    noise = (np.random.RandomState(2).rand(300, 300, 3) * 255).astype(np.uint8)
    result = landmarker.detect(noise)
    assert result.hands == []
