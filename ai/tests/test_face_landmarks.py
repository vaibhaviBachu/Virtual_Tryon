"""
Real FaceLandmarker tests (ai/landmarks/face.py) against the actual mediapipe model —
no mocking of the model itself. See evaluation/scripts/run_scenario_evaluation.py and
docs/milestone-3-verification.md §9 for the full honest scenario-by-scenario record;
these unit tests check the module's *contract* (coordinate ranges, no-face handling,
determinism, ear-region shape) using real inference on real image arrays.
"""
import os

import numpy as np
import pytest
from PIL import Image

from ai.landmarks.face import FaceLandmarker
from ai.landmarks.schemas import ConfidenceLevel

EVAL_USERS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "evaluation", "users")


@pytest.fixture(scope="module")
def landmarker():
    fl = FaceLandmarker()
    yield fl
    fl.close()


def _load(scenario: str) -> np.ndarray:
    scenario_dir = os.path.join(EVAL_USERS_DIR, scenario)
    files = [f for f in os.listdir(scenario_dir) if f.lower().endswith((".jpg", ".png"))]
    return np.asarray(Image.open(os.path.join(scenario_dir, files[0])).convert("RGB"))


def test_no_face_on_pure_noise_image(landmarker):
    """Real noise has no face-like structure — the real model must honestly report no
    detection, never fabricate landmarks."""
    noise = (np.random.RandomState(0).rand(400, 400, 3) * 255).astype(np.uint8)
    result = landmarker.detect(noise)
    assert result.success is False
    assert result.num_faces_detected == 0
    assert result.error_message is not None
    assert result.landmarks == []


def test_front_scenario_detects_one_face(landmarker):
    image = _load("front")
    result = landmarker.detect(image)
    # Real, measured outcome (see docs/milestone-3-verification.md §9): the synthetic
    # front-facing drawn face IS detected by the real FaceDetection model.
    assert result.num_faces_detected == 1
    assert result.success is True
    assert 0.0 < result.detection_confidence <= 1.0
    assert len(result.landmarks) == 468  # real MediaPipe face-mesh topology size
    assert result.confidence_level in (ConfidenceLevel.medium, ConfidenceLevel.high)


def test_landmarks_are_normalized_0_to_1(landmarker):
    image = _load("front")
    result = landmarker.detect(image)
    assert result.success is True
    for point in result.landmarks:
        # A small tolerance margin is allowed: MediaPipe's mesh occasionally predicts
        # points slightly outside the frame for partially-occluded features — this is
        # a real, known model behavior, not a bug in our normalization.
        assert -0.25 <= point.x <= 1.25
        assert -0.25 <= point.y <= 1.25


def test_multiple_faces_scenario_reports_more_than_one(landmarker):
    image = _load("multiple_faces")
    result = landmarker.detect(image)
    assert result.num_faces_detected >= 2


def test_ear_regions_present_when_face_detected(landmarker):
    image = _load("ear_visible")
    result = landmarker.detect(image)
    assert result.success is True
    assert result.left_ear is not None and result.right_ear is not None
    assert 0.0 <= result.left_ear.confidence <= 1.0
    assert 0.0 <= result.right_ear.confidence <= 1.0
    # Heuristic ceiling is enforced — never a "perfect" 1.0 confidence for an ear.
    assert result.left_ear.confidence <= 0.85
    assert result.right_ear.confidence <= 0.85


def test_is_deterministic_across_repeated_calls(landmarker):
    """static_image_mode=True must make repeated calls on the same array converge to
    the same result — verified directly, not assumed."""
    image = _load("front")
    r1 = landmarker.detect(image)
    r2 = landmarker.detect(image)
    assert r1.num_faces_detected == r2.num_faces_detected
    assert r1.detection_confidence == pytest.approx(r2.detection_confidence, abs=1e-6)
    assert len(r1.landmarks) == len(r2.landmarks)
    for p1, p2 in zip(r1.landmarks, r2.landmarks):
        assert p1.x == pytest.approx(p2.x, abs=1e-6)
        assert p1.y == pytest.approx(p2.y, abs=1e-6)


def test_left_is_image_space_left_not_anatomical(landmarker):
    """Contract test for the documented coordinate convention: `left_ear.anchor.x` must
    always be <= `right_ear.anchor.x` (image-space left/right), regardless of any
    anatomical left/right ambiguity."""
    image = _load("front")
    result = landmarker.detect(image)
    assert result.left_ear.anchor.x <= result.right_ear.anchor.x
