import pytest

from ai.geometry.constants import (
    AVERAGE_ADULT_FACE_WIDTH_MM,
    AVERAGE_ADULT_SHOULDER_WIDTH_MM,
    EARRING_RELATIVE_SCALE_OF_FACE_WIDTH,
    MAX_SCALE_FACTOR,
    MIN_SCALE_FACTOR,
    NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH,
)
from ai.geometry.scale import compute_scale
from ai.geometry.schemas import AnchorResult, JewelleryAssetGeometry, Point


def _asset_geometry(width_px=200, height_px=200, bbox=(50, 50, 150, 150), physical_width_mm=None, physical_height_mm=None):
    return JewelleryAssetGeometry(
        width_px=width_px, height_px=height_px, alpha_bbox=bbox,
        anchor_px=Point(x=(bbox[0] + bbox[2]) / 2, y=bbox[1]),
        anchor_source="default_bbox_top_center", attachment_point=None, mirrorable=False,
        physical_width_mm=physical_width_mm, physical_height_mm=physical_height_mm,
    )


def test_earring_relative_scale_used_when_no_physical_dimensions():
    geometry = _asset_geometry()  # effective width 100px
    anchor = AnchorResult(success=True, anchor_px=Point(0, 0), reference_measurement_px=400.0)
    result = compute_scale("earrings", geometry, anchor)
    assert result.success is True
    assert result.used_physical_dimensions is False
    expected_target = EARRING_RELATIVE_SCALE_OF_FACE_WIDTH * 400.0
    assert result.target_width_px == pytest.approx(expected_target)
    assert result.scale_factor == pytest.approx(expected_target / 100.0)


def test_earring_physical_scale_used_when_available():
    geometry = _asset_geometry(physical_width_mm=14.0)
    anchor = AnchorResult(success=True, anchor_px=Point(0, 0), reference_measurement_px=400.0)
    result = compute_scale("earrings", geometry, anchor)
    assert result.success is True
    assert result.used_physical_dimensions is True
    px_per_mm = 400.0 / AVERAGE_ADULT_FACE_WIDTH_MM
    expected_target = 14.0 * px_per_mm
    assert result.target_width_px == pytest.approx(expected_target)
    assert any("anthropometric" in a for a in result.assumptions)


def test_necklace_relative_scale_used_when_no_physical_dimensions():
    geometry = _asset_geometry()
    anchor = AnchorResult(success=True, anchor_px=Point(0, 0), reference_measurement_px=500.0)
    result = compute_scale("necklace", geometry, anchor)
    assert result.success is True
    expected_target = NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH * 500.0
    assert result.target_width_px == pytest.approx(expected_target)


def test_necklace_physical_scale_used_when_available():
    geometry = _asset_geometry(physical_width_mm=200.0)
    anchor = AnchorResult(success=True, anchor_px=Point(0, 0), reference_measurement_px=500.0)
    result = compute_scale("necklace", geometry, anchor)
    assert result.used_physical_dimensions is True
    px_per_mm = 500.0 / AVERAGE_ADULT_SHOULDER_WIDTH_MM
    assert result.target_width_px == pytest.approx(200.0 * px_per_mm)


def test_scale_is_deterministic():
    geometry = _asset_geometry(physical_width_mm=14.0)
    anchor = AnchorResult(success=True, anchor_px=Point(0, 0), reference_measurement_px=400.0)
    r1 = compute_scale("earrings", geometry, anchor)
    r2 = compute_scale("earrings", geometry, anchor)
    assert r1.scale_factor == r2.scale_factor


def test_scale_factor_clamped_to_safety_bounds_for_extreme_asset():
    # A near-zero effective width would otherwise blow up the scale factor.
    geometry = _asset_geometry(bbox=(99, 99, 100, 100))  # 1px wide
    anchor = AnchorResult(success=True, anchor_px=Point(0, 0), reference_measurement_px=400.0)
    result = compute_scale("earrings", geometry, anchor)
    assert MIN_SCALE_FACTOR <= result.scale_factor <= MAX_SCALE_FACTOR


def test_scale_fails_without_reference_measurement():
    geometry = _asset_geometry()
    anchor = AnchorResult(success=False)
    result = compute_scale("earrings", geometry, anchor)
    assert result.success is False
