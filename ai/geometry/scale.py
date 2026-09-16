"""
compute_scale() — spec §9, §14, §31: mathematically derived scale, using physical
jewellery dimensions where available and a documented relative-scaling fallback
otherwise. Never an arbitrary pixel multiplier chosen per-image.

See ai/geometry/constants.py's module docstring for the honest limitation this module
is built around: a single RGB photo cannot yield true metric scale, so the
"physical-dimensions" path uses a documented anthropometric calibration constant
instead of a per-user measurement, and every result records `used_physical_dimensions`
plus the exact assumption text (spec §31: "record the assumption in the placement
metadata").
"""
from ai.geometry.constants import (
    AVERAGE_ADULT_FACE_WIDTH_MM,
    AVERAGE_ADULT_SHOULDER_WIDTH_MM,
    EARRING_RELATIVE_SCALE_OF_FACE_WIDTH,
    MAX_SCALE_FACTOR,
    MIN_SCALE_FACTOR,
    NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH,
)
from ai.geometry.schemas import AnchorResult, JewelleryAssetGeometry, ScaleResult


def compute_scale(
    category_slug: str,
    asset_geometry: JewelleryAssetGeometry,
    anchor: AnchorResult,
) -> ScaleResult:
    if not anchor.success or not anchor.reference_measurement_px:
        return ScaleResult(success=False, method="no_reference_measurement")

    effective_width_px = asset_geometry.effective_width_px
    if effective_width_px <= 0:
        return ScaleResult(success=False, method="asset_has_no_measurable_width")

    if category_slug == "earrings":
        target_width_px, used_physical, assumptions = _earring_target_width(
            asset_geometry, anchor.reference_measurement_px
        )
        method = "physical_mm_via_face_width_calibration" if used_physical else "relative_to_face_width"
    elif category_slug == "necklace":
        target_width_px, used_physical, assumptions = _necklace_target_width(
            asset_geometry, anchor.reference_measurement_px
        )
        method = "physical_mm_via_shoulder_width_calibration" if used_physical else "relative_to_shoulder_width"
    else:
        return ScaleResult(success=False, method="unsupported_category")

    raw_scale_factor = target_width_px / effective_width_px
    clamped_scale_factor = min(max(raw_scale_factor, MIN_SCALE_FACTOR), MAX_SCALE_FACTOR)
    if clamped_scale_factor != raw_scale_factor:
        assumptions.append(
            f"Computed scale factor {raw_scale_factor:.4f} was clamped to "
            f"[{MIN_SCALE_FACTOR}, {MAX_SCALE_FACTOR}] as a safety bound against noisy landmarks."
        )

    return ScaleResult(
        success=True,
        scale_factor=clamped_scale_factor,
        target_width_px=target_width_px,
        used_physical_dimensions=used_physical,
        assumptions=assumptions,
        method=method,
    )


def _earring_target_width(asset_geometry: JewelleryAssetGeometry, face_width_px: float):
    if asset_geometry.physical_width_mm:
        px_per_mm = face_width_px / AVERAGE_ADULT_FACE_WIDTH_MM
        target_width_px = asset_geometry.physical_width_mm * px_per_mm
        assumptions = [
            f"Assumed average adult face width of {AVERAGE_ADULT_FACE_WIDTH_MM}mm "
            "(documented anthropometric constant, not measured from this specific photo) "
            "to convert the catalogue item's physical_width_mm into pixels via the "
            "detected face bounding-box width. A single RGB photo cannot recover true "
            "metric scale (spec §31); this is a documented approximation, not a claim "
            "of millimeter-accurate placement."
        ]
        return target_width_px, True, assumptions

    target_width_px = EARRING_RELATIVE_SCALE_OF_FACE_WIDTH * face_width_px
    assumptions = [
        f"No physical_width_mm was available for this catalogue item; scaled the "
        f"earring to {EARRING_RELATIVE_SCALE_OF_FACE_WIDTH:.0%} of the detected face "
        "bounding-box width instead (documented relative-scaling fallback, see "
        "ai/geometry/constants.py)."
    ]
    return target_width_px, False, assumptions


def _necklace_target_width(asset_geometry: JewelleryAssetGeometry, shoulder_width_px: float):
    if asset_geometry.physical_width_mm:
        px_per_mm = shoulder_width_px / AVERAGE_ADULT_SHOULDER_WIDTH_MM
        target_width_px = asset_geometry.physical_width_mm * px_per_mm
        assumptions = [
            f"Assumed average adult shoulder width of {AVERAGE_ADULT_SHOULDER_WIDTH_MM}mm "
            "(documented anthropometric constant, not measured from this specific photo) "
            "to convert the catalogue item's physical_width_mm into pixels via the "
            "detected shoulder-width. A single RGB photo cannot recover true metric "
            "scale (spec §31); this is a documented approximation."
        ]
        return target_width_px, True, assumptions

    target_width_px = NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH * shoulder_width_px
    assumptions = [
        f"No physical_width_mm was available for this catalogue item; scaled the "
        f"necklace to {NECKLACE_RELATIVE_SCALE_OF_SHOULDER_WIDTH:.0%} of the detected "
        "shoulder width instead (documented relative-scaling fallback, see "
        "ai/geometry/constants.py)."
    ]
    return target_width_px, False, assumptions
