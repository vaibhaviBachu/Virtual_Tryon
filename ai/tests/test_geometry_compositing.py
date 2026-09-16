import numpy as np
import pytest

from ai.geometry.compositing import alpha_composite


def test_fully_transparent_overlay_leaves_base_unchanged():
    base = np.full((10, 10, 3), 100, dtype=np.uint8)
    overlay = np.zeros((10, 10, 4), dtype=np.uint8)
    result = alpha_composite(base, overlay)
    assert np.array_equal(result, base)


def test_fully_opaque_overlay_replaces_base_pixels():
    base = np.full((10, 10, 3), 100, dtype=np.uint8)
    overlay = np.zeros((10, 10, 4), dtype=np.uint8)
    overlay[:, :, :3] = [10, 20, 30]
    overlay[:, :, 3] = 255
    result = alpha_composite(base, overlay)
    assert np.array_equal(result, np.full((10, 10, 3), [10, 20, 30], dtype=np.uint8))


def test_half_alpha_blends_proportionally():
    base = np.zeros((1, 1, 3), dtype=np.uint8)
    overlay = np.array([[[200, 200, 200, 128]]], dtype=np.uint8)
    result = alpha_composite(base, overlay)
    expected = 200 * (128 / 255.0)
    assert result[0, 0, 0] == pytest.approx(expected, abs=1.0)


def test_no_rectangular_artifact_from_partially_transparent_overlay():
    """A jewellery cutout is a small opaque region on an otherwise fully-transparent
    canvas — compositing it must not leave any visible trace (e.g. a faint box) outside
    that opaque region (spec §17: 'do not create ... rectangular image overlays')."""
    base = np.full((20, 20, 3), 50, dtype=np.uint8)
    overlay = np.zeros((20, 20, 4), dtype=np.uint8)
    overlay[8:12, 8:12, :3] = 255
    overlay[8:12, 8:12, 3] = 255
    result = alpha_composite(base, overlay)
    outside_mask = np.ones((20, 20), dtype=bool)
    outside_mask[8:12, 8:12] = False
    assert np.array_equal(result[outside_mask], base[outside_mask])


def test_mismatched_dimensions_raise_value_error():
    base = np.zeros((10, 10, 3), dtype=np.uint8)
    overlay = np.zeros((5, 5, 4), dtype=np.uint8)
    with pytest.raises(ValueError):
        alpha_composite(base, overlay)
