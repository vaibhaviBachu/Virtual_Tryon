import numpy as np
import pytest

from ai.geometry.asset_geometry import InvalidAssetError, compute_asset_geometry


def _rgba_with_square(size=100, square=(20, 30, 60, 70)) -> np.ndarray:
    arr = np.zeros((size, size, 4), dtype=np.uint8)
    left, top, right, bottom = square
    arr[top:bottom, left:right, :3] = 200
    arr[top:bottom, left:right, 3] = 255
    return arr


def test_alpha_bbox_matches_visible_square_exactly():
    asset = _rgba_with_square()
    geometry = compute_asset_geometry(
        asset, anchor_x=None, anchor_y=None, attachment_point=None, mirrorable=False,
        physical_width_mm=None, physical_height_mm=None,
    )
    assert geometry.alpha_bbox == (20, 30, 60, 70)
    assert geometry.effective_width_px == 40
    assert geometry.effective_height_px == 40


def test_default_anchor_is_bbox_top_center_when_no_metadata():
    asset = _rgba_with_square()
    geometry = compute_asset_geometry(
        asset, anchor_x=None, anchor_y=None, attachment_point=None, mirrorable=False,
        physical_width_mm=None, physical_height_mm=None,
    )
    assert geometry.anchor_source == "default_bbox_top_center"
    assert geometry.anchor_px.x == pytest.approx(40.0)
    assert geometry.anchor_px.y == pytest.approx(30.0)


def test_explicit_catalogue_anchor_overrides_default():
    asset = _rgba_with_square(size=100)
    geometry = compute_asset_geometry(
        asset, anchor_x=0.5, anchor_y=0.1, attachment_point="ear_hook", mirrorable=True,
        physical_width_mm=12.0, physical_height_mm=20.0,
    )
    assert geometry.anchor_source == "catalogue_metadata"
    assert geometry.anchor_px.x == pytest.approx(50.0)
    assert geometry.anchor_px.y == pytest.approx(10.0)
    assert geometry.attachment_point == "ear_hook"
    assert geometry.mirrorable is True
    assert geometry.physical_width_mm == 12.0


def test_fully_transparent_asset_raises_invalid_asset_error():
    asset = np.zeros((50, 50, 4), dtype=np.uint8)
    with pytest.raises(InvalidAssetError):
        compute_asset_geometry(
            asset, anchor_x=None, anchor_y=None, attachment_point=None, mirrorable=False,
            physical_width_mm=None, physical_height_mm=None,
        )


def test_rgb_without_alpha_channel_raises_invalid_asset_error():
    asset = np.zeros((50, 50, 3), dtype=np.uint8)
    with pytest.raises(InvalidAssetError):
        compute_asset_geometry(
            asset, anchor_x=None, anchor_y=None, attachment_point=None, mirrorable=False,
            physical_width_mm=None, physical_height_mm=None,
        )
