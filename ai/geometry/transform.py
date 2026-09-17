"""
compute_transform() / apply_transform() — spec §16, §28: affine transformation
(translation + rotation + scale) built so JEWELLERY_ANCHOR coincides with BODY_ANCHOR
(spec §8, §13), using OpenCV for the actual pixel resampling. No generative image
transformation anywhere in this module.
"""
import math
from typing import Tuple

import cv2
import numpy as np

from ai.geometry.schemas import AnchorResult, JewelleryAssetGeometry, Point, RotationResult, ScaleResult, TransformResult


def compute_transform(
    asset_geometry: JewelleryAssetGeometry,
    anchor: AnchorResult,
    scale: ScaleResult,
    rotation: RotationResult,
    mirrored: bool = False,
) -> TransformResult:
    """Builds the 2x3 affine matrix M = T(target) . R(theta) . S(scale) . T(-source),
    i.e.: move the asset's own anchor to the origin, scale it, rotate it, then move it
    to the BODY_ANCHOR's pixel position. Composing in this order (rather than e.g.
    rotating about the asset's center) is exactly what keeps JEWELLERY_ANCHOR and
    BODY_ANCHOR coincident after the transform (spec §8's anchor-coincidence
    requirement), which is the property ai/tests/test_geometry_transform.py asserts
    directly by re-projecting the source anchor through the returned matrix."""
    assert anchor.success and anchor.anchor_px is not None
    theta = math.radians(rotation.rotation_degrees)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    s = scale.scale_factor

    a11 = s * cos_t
    a12 = -s * sin_t
    a21 = s * sin_t
    a22 = s * cos_t

    source_anchor = asset_geometry.anchor_px
    target_anchor = anchor.anchor_px

    bx = target_anchor.x - (a11 * source_anchor.x + a12 * source_anchor.y)
    by = target_anchor.y - (a21 * source_anchor.x + a22 * source_anchor.y)

    matrix = [[a11, a12, bx], [a21, a22, by]]

    corners = _bbox_corners(asset_geometry.alpha_bbox)
    transformed_corners = [_apply_point(matrix, x, y) for x, y in corners]
    xs = [p[0] for p in transformed_corners]
    ys = [p[1] for p in transformed_corners]
    transformed_bbox = (min(xs), min(ys), max(xs), max(ys))

    return TransformResult(
        matrix=matrix,
        scale_factor=s,
        rotation_degrees=rotation.rotation_degrees,
        anchor_px=Point(x=target_anchor.x, y=target_anchor.y),
        transformed_bbox_px=transformed_bbox,
        mirrored=mirrored,
    )


def apply_transform(
    asset_rgba: np.ndarray, transform: TransformResult, output_width: int, output_height: int
) -> np.ndarray:
    """Warps `asset_rgba` (HxWx4 uint8) onto an output_width x output_height canvas
    using the given affine transform. `borderValue=(0,0,0,0)` guarantees the only new
    pixels introduced outside the asset's own footprint are fully transparent (spec
    §17: "the transparent jewellery pixels should be the only added pixels")."""
    matrix_np = np.array(transform.matrix, dtype=np.float64)
    warped = cv2.warpAffine(
        asset_rgba,
        matrix_np,
        (output_width, output_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    return warped


def mirror_asset_geometry(
    asset_rgba: np.ndarray, asset_geometry: JewelleryAssetGeometry
) -> Tuple[np.ndarray, JewelleryAssetGeometry]:
    """Spec §11: "provide an explicit transformation option for mirroring" for a
    symmetric single-asset earring design. Flips the asset image horizontally and
    returns an updated JewelleryAssetGeometry whose anchor/bbox are re-expressed in the
    flipped image's own coordinate space (NOT a translation trick that tries to keep
    the anchor's pixel position fixed — that would only work for anchors exactly on the
    image's vertical center line). The caller (ai.engines.geometry.engine) is
    responsible for only calling this when JewelleryAssetGeometry.mirrorable is True
    (spec §11: never auto-mirror an asset not marked mirrorable)."""
    flipped = np.ascontiguousarray(asset_rgba[:, ::-1, :])
    width = asset_geometry.width_px
    left, top, right, bottom = asset_geometry.alpha_bbox
    mirrored_bbox = (width - right, top, width - left, bottom)
    mirrored_anchor = Point(x=width - asset_geometry.anchor_px.x, y=asset_geometry.anchor_px.y)

    from dataclasses import replace

    mirrored_geometry = replace(
        asset_geometry,
        alpha_bbox=mirrored_bbox,
        anchor_px=mirrored_anchor,
        anchor_source=asset_geometry.anchor_source + "_mirrored",
    )
    return flipped, mirrored_geometry


def bbox_overlap_fraction(
    bbox: Tuple[float, float, float, float], image_width_px: int, image_height_px: int
) -> float:
    """What fraction of `bbox`'s own area actually falls within a
    0,0 -> image_width_px,image_height_px canvas. Used by
    ai.engines.geometry.engine to catch a real, previously-unhandled failure mode
    (found on a live deployment, not hypothetical): an anchor derived from real
    landmarks (ai.geometry.anchors) can legitimately land very close to an edge of the
    photo — e.g. a webcam photo framed close on the face/shoulders, where the
    necklace's documented collarbone-offset (NECKLACE_ANCHOR_VERTICAL_OFFSET_FRACTION,
    ai/geometry/constants.py) then pushes the placement entirely past the bottom edge.
    `compute_transform`/`apply_transform`/`alpha_composite` all still "succeed" in that
    case — cv2.warpAffine simply produces a fully-transparent result outside its output
    canvas — producing a render that reports success but is pixel-identical to the
    input. This function lets the caller detect that condition and fail honestly
    instead (spec §21: "do not silently create a poor result")."""
    left, top, right, bottom = bbox
    overlap_left = max(left, 0.0)
    overlap_top = max(top, 0.0)
    overlap_right = min(right, float(image_width_px))
    overlap_bottom = min(bottom, float(image_height_px))
    overlap_width = max(overlap_right - overlap_left, 0.0)
    overlap_height = max(overlap_bottom - overlap_top, 0.0)
    overlap_area = overlap_width * overlap_height

    bbox_area = max((right - left) * (bottom - top), 1e-9)
    return overlap_area / bbox_area


def _bbox_corners(bbox: Tuple[float, float, float, float]):
    left, top, right, bottom = bbox
    return [(left, top), (right, top), (left, bottom), (right, bottom)]


def _apply_point(matrix, x: float, y: float) -> Tuple[float, float]:
    a11, a12, bx = matrix[0]
    a21, a22, by = matrix[1]
    return (a11 * x + a12 * y + bx, a21 * x + a22 * y + by)
