import numpy as np
import pytest

from ai.geometry.schemas import AnchorResult, JewelleryAssetGeometry, Point, RotationResult, ScaleResult
from ai.geometry.transform import apply_transform, compute_transform, mirror_asset_geometry


def _asset_geometry(anchor=(50.0, 20.0), bbox=(20, 10, 80, 60)):
    return JewelleryAssetGeometry(
        width_px=100, height_px=100, alpha_bbox=bbox,
        anchor_px=Point(*anchor), anchor_source="test", attachment_point=None,
        mirrorable=True, physical_width_mm=None, physical_height_mm=None,
    )


def test_transform_maps_jewellery_anchor_exactly_onto_body_anchor():
    geometry = _asset_geometry()
    anchor = AnchorResult(success=True, anchor_px=Point(300.0, 400.0), reference_measurement_px=1.0)
    scale = ScaleResult(success=True, scale_factor=2.0)
    rotation = RotationResult(success=True, rotation_degrees=0.0)

    transform = compute_transform(geometry, anchor, scale, rotation)
    a11, a12, bx = transform.matrix[0]
    a21, a22, by = transform.matrix[1]
    projected_x = a11 * geometry.anchor_px.x + a12 * geometry.anchor_px.y + bx
    projected_y = a21 * geometry.anchor_px.x + a22 * geometry.anchor_px.y + by
    assert projected_x == pytest.approx(anchor.anchor_px.x, abs=1e-6)
    assert projected_y == pytest.approx(anchor.anchor_px.y, abs=1e-6)


def test_transform_scales_bbox_by_the_given_scale_factor():
    geometry = _asset_geometry()
    anchor = AnchorResult(success=True, anchor_px=Point(0.0, 0.0), reference_measurement_px=1.0)
    scale = ScaleResult(success=True, scale_factor=3.0)
    rotation = RotationResult(success=True, rotation_degrees=0.0)

    transform = compute_transform(geometry, anchor, scale, rotation)
    left, top, right, bottom = transform.transformed_bbox_px
    original_width = geometry.alpha_bbox[2] - geometry.alpha_bbox[0]
    original_height = geometry.alpha_bbox[3] - geometry.alpha_bbox[1]
    assert (right - left) == pytest.approx(original_width * 3.0, abs=1e-6)
    assert (bottom - top) == pytest.approx(original_height * 3.0, abs=1e-6)


def test_rotation_by_90_degrees_swaps_bbox_extents():
    geometry = _asset_geometry(anchor=(50.0, 35.0), bbox=(20, 30, 80, 40))  # wide, short box
    anchor = AnchorResult(success=True, anchor_px=Point(50.0, 35.0), reference_measurement_px=1.0)
    scale = ScaleResult(success=True, scale_factor=1.0)
    rotation = RotationResult(success=True, rotation_degrees=90.0)

    transform = compute_transform(geometry, anchor, scale, rotation)
    left, top, right, bottom = transform.transformed_bbox_px
    original_width = geometry.alpha_bbox[2] - geometry.alpha_bbox[0]
    original_height = geometry.alpha_bbox[3] - geometry.alpha_bbox[1]
    # After a 90deg rotation, extents approximately swap (bbox is axis-aligned around
    # the rotated corners so this is an approx check on the overall footprint size).
    assert (bottom - top) == pytest.approx(original_width, abs=1e-6)
    assert (right - left) == pytest.approx(original_height, abs=1e-6)


def test_apply_transform_places_pixels_at_the_target_anchor_and_leaves_rest_transparent():
    asset = np.zeros((20, 20, 4), dtype=np.uint8)
    asset[5:15, 5:15, :3] = 255
    asset[5:15, 5:15, 3] = 255
    geometry = JewelleryAssetGeometry(
        width_px=20, height_px=20, alpha_bbox=(5, 5, 15, 15),
        anchor_px=Point(10.0, 5.0), anchor_source="test", attachment_point=None,
        mirrorable=False, physical_width_mm=None, physical_height_mm=None,
    )
    anchor = AnchorResult(success=True, anchor_px=Point(50.0, 50.0), reference_measurement_px=1.0)
    scale = ScaleResult(success=True, scale_factor=1.0)
    rotation = RotationResult(success=True, rotation_degrees=0.0)
    transform = compute_transform(geometry, anchor, scale, rotation)

    warped = apply_transform(asset, transform, output_width=100, output_height=100)
    assert warped.shape == (100, 100, 4)
    # The anchor point (10,5) in source maps to (50,50) — the pixel just below/right of
    # it (which was opaque in source) should now be opaque near (50,50).
    assert warped[51, 51, 3] > 0
    # Far from the placed asset, the canvas must remain fully transparent (spec §17:
    # only the jewellery's own pixels are added).
    assert warped[0, 0, 3] == 0
    assert warped[99, 99, 3] == 0


def test_mirror_asset_geometry_flips_bbox_and_anchor_without_changing_shape():
    asset = np.zeros((10, 20, 4), dtype=np.uint8)
    asset[:, 2:8, :3] = [10, 20, 30]
    asset[:, 2:8, 3] = 255
    geometry = JewelleryAssetGeometry(
        width_px=20, height_px=10, alpha_bbox=(2, 0, 8, 10),
        anchor_px=Point(5.0, 0.0), anchor_source="default_bbox_top_center",
        attachment_point=None, mirrorable=True, physical_width_mm=None, physical_height_mm=None,
    )
    flipped, mirrored_geometry = mirror_asset_geometry(asset, geometry)
    assert flipped.shape == asset.shape
    # Original color block was columns [2,8); after a horizontal flip of a 20-wide
    # image that block moves to columns [12,18).
    assert np.all(flipped[:, 12:18, 3] == 255)
    assert np.all(flipped[:, :12, 3] == 0)
    assert mirrored_geometry.alpha_bbox == (12, 0, 18, 10)
    assert mirrored_geometry.anchor_px.x == pytest.approx(20 - 5.0)
