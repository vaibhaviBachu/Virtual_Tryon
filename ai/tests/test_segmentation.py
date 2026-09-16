"""Real PersonSegmenter tests (ai/segmentation/person_segmenter.py)."""
import os

import numpy as np
import pytest
from PIL import Image

from ai.segmentation.person_segmenter import PersonSegmenter

REAL_PHOTO = os.path.join(
    os.path.dirname(__file__), "..", "..", "evaluation", "data", "test_images", "opencv_sample_person.jpg"
)


@pytest.fixture(scope="module")
def segmenter():
    s = PersonSegmenter()
    yield s
    s.close()


def _load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def test_solid_color_image_has_low_or_no_confident_foreground(segmenter):
    """A flat solid-color image has nothing for a segmenter to distinguish — the result
    must not fabricate a confident person mask."""
    solid = np.full((300, 300, 3), 200, dtype=np.uint8)
    result, mask = segmenter.segment(solid)
    assert mask is not None
    # Either explicitly failed (no person) or succeeded with a low/near-zero confidence
    # — both are honest outcomes for content with no real foreground/background contrast.
    if result.success:
        assert result.foreground_ratio < 0.5 or result.confidence < 0.6


def test_real_photo_produces_a_measured_mask(segmenter):
    image = _load(REAL_PHOTO)
    result, mask = segmenter.segment(image)
    assert mask is not None
    assert mask.shape == (image.shape[0], image.shape[1])
    assert mask.dtype == np.float32
    assert mask.min() >= 0.0 and mask.max() <= 1.0
    # A real, non-uniform mask — not every pixel identical (which would indicate a
    # fabricated/placeholder result).
    assert mask.std() > 0.0
    assert result.available_masks == ["person"]  # honest: no hair/skin/cloth sub-masks


def test_confidence_formula_uses_real_measured_values(segmenter):
    image = _load(REAL_PHOTO)
    result, mask = segmenter.segment(image)
    assert 0.0 <= result.foreground_ratio <= 1.0
    assert 0.0 <= result.decisiveness <= 1.0
    assert 0.0 <= result.confidence <= 1.0
    # Confidence must be a function of decisiveness/coverage, not an independent
    # constant — sanity-check by recomputing the documented formula.
    plausible_coverage = max(0.0, min(1.0, 1.0 - abs(result.foreground_ratio - 0.35) / 0.65))
    expected = max(0.0, min(1.0, 0.7 * result.decisiveness + 0.3 * plausible_coverage))
    assert result.confidence == pytest.approx(expected, abs=1e-6)


def test_never_raises_on_malformed_input(segmenter):
    garbage = np.zeros((5, 5, 3), dtype=np.uint8)
    result, mask = segmenter.segment(garbage)
    assert isinstance(result.success, bool)
