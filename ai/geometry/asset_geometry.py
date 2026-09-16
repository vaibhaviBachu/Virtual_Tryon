"""
Catalogue asset geometry — spec §18: "Asset padding... do not calculate placement from
the raw image rectangle alone. Use the non-transparent alpha bounding box to determine
actual jewellery bounds, anchor location, effective dimensions."

Deliberately separate from ai/catalogue/processor.py's own alpha-bbox-cropping logic
(Milestone 2): that module crops the STORED asset at processing time; this module reads
geometry from whatever asset bytes it is handed at RENDER time and never mutates them.
The two happen to compute a conceptually similar bounding box, but duplicating the ~10
lines of numpy here (rather than importing ai/catalogue/processor's private method) keeps
Milestone 4 from taking a dependency on Milestone 2's catalogue-processing internals for
what is, from this package's point of view, a completely different concern (spec-mandated
module boundary: ai/geometry must not need ai/catalogue to run).
"""
import numpy as np

from ai.geometry.schemas import JewelleryAssetGeometry, Point


class InvalidAssetError(Exception):
    """Raised when the given asset bytes have no visible (alpha > 0) content at all —
    a real, honest failure (spec §20's "valid alpha channel" validation), never
    papered over with a fabricated bounding box."""


def compute_asset_geometry(
    asset_rgba: np.ndarray,
    *,
    anchor_x: float | None,
    anchor_y: float | None,
    attachment_point: str | None,
    mirrorable: bool,
    physical_width_mm: float | None,
    physical_height_mm: float | None,
) -> JewelleryAssetGeometry:
    """`asset_rgba` must be an HxWx4 uint8 array (the caller is responsible for
    decoding the stored PNG — see ai.engines.geometry.engine). Raises
    InvalidAssetError if the asset has no visible content (spec §20 validation must
    reject this before it ever reaches placement math)."""
    if asset_rgba.ndim != 3 or asset_rgba.shape[2] != 4:
        raise InvalidAssetError("Jewellery asset does not have an RGBA alpha channel.")

    height, width = asset_rgba.shape[0], asset_rgba.shape[1]
    alpha = asset_rgba[:, :, 3]
    nonzero_rows = np.any(alpha > 0, axis=1)
    nonzero_cols = np.any(alpha > 0, axis=0)

    if not nonzero_rows.any() or not nonzero_cols.any():
        raise InvalidAssetError("Jewellery asset has no visible (non-transparent) content.")

    top, bottom = np.where(nonzero_rows)[0][[0, -1]]
    left, right = np.where(nonzero_cols)[0][[0, -1]]
    # bbox is (left, top, right, bottom), right/bottom EXCLUSIVE — +1 on the inclusive
    # last-nonzero index found above.
    bbox = (int(left), int(top), int(right) + 1, int(bottom) + 1)

    if anchor_x is not None and anchor_y is not None:
        anchor_px = Point(x=anchor_x * width, y=anchor_y * height)
        anchor_source = "catalogue_metadata"
    else:
        # Documented default (spec §19: "do not force all jewellery categories into
        # one incorrect anchor model" — but a single sensible default is a reasonable
        # starting point every category in this milestone shares: the top-center of
        # the visible content, which is where a hook/chain/hanging point typically
        # sits for both earrings and necklaces). Catalogue admins can override with
        # explicit anchor_x/anchor_y once evaluation shows this default is wrong for a
        # specific design (documented limitation, not silently assumed correct).
        anchor_px = Point(x=(bbox[0] + bbox[2]) / 2.0, y=float(bbox[1]))
        anchor_source = "default_bbox_top_center"

    return JewelleryAssetGeometry(
        width_px=width,
        height_px=height,
        alpha_bbox=bbox,
        anchor_px=anchor_px,
        anchor_source=anchor_source,
        attachment_point=attachment_point,
        mirrorable=mirrorable,
        physical_width_mm=physical_width_mm,
        physical_height_mm=physical_height_mm,
    )
