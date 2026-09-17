"""
Category-aware PRE-SELECTION framing readiness — Milestone 4 stabilization spec
("FIX NECKLACE FRAMING / PLACEMENT ROBUSTNESS") §2, §3, §4, §11.

This module answers a different question than ai.engines.geometry.engine's per-asset
JEWELLERY_OUT_OF_FRAME check: "before the user has even picked a specific item, does
this photo's framing look wide enough for a typical item in this category?" It is a
fast, category-generic, HEURISTIC pre-flight signal meant to move bad-framing feedback
earlier in the flow (spec §3) — it is never the final word.

The existing render-time check in ai.engines.geometry.engine (bbox_overlap_fraction
measured against the ACTUAL selected asset's real alpha bounding box) remains the sole
AUTHORITATIVE, per-asset gate and is completely unchanged by this module (spec: "DO NOT
simply remove the safety check"). A photo can pass this pre-check and still be rejected
at render time for a specific unusually large/long item — that is correct, expected
behaviour, not a bug (see NECKLACE_MIN_REQUIRED_VERTICAL_SPACE_FRACTION's docstring in
ai.geometry.constants for why this pre-check cannot be asset-specific).

Architecture (spec §2 — "design the readiness system so future categories can use the
same architecture"): every category exposes one evaluate_<category>_framing(...)
function returning a FramingResult, and CATEGORY_FRAMING_EVALUATORS is the single
registry a caller (or a future category) needs to extend. Only "necklace" is registered
and functional this milestone (spec §26 — rings/bangles/bracelets/maang tikka/nose ring
are explicitly out of scope); "earrings" is intentionally NOT registered here — see the
registry's own comment for why its existing readiness signal does not have the gap this
module exists to close.
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from ai.geometry.anchors import compute_anchor
from ai.geometry.constants import NECKLACE_MIN_REQUIRED_VERTICAL_SPACE_FRACTION
from ai.landmarks.schemas import PoseLandmarkResult


@dataclass
class FramingResult:
    """Spec §18, §19's structured failure-reason shape, scoped to this pre-check.
    `technical_reason` is for logs/debugging only and must never be shown to the
    customer — callers surface only `user_message`."""

    ready: bool
    reason_code: Optional[str] = None
    user_message: Optional[str] = None
    technical_reason: Optional[str] = None
    metrics: Dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "ready": self.ready,
            "reason_code": self.reason_code,
            "user_message": self.user_message,
            "technical_reason": self.technical_reason,
            "metrics": self.metrics,
        }


def evaluate_necklace_framing(
    pose: Optional[PoseLandmarkResult],
    image_width_px: int,
    image_height_px: int,
) -> FramingResult:
    """NECKLACE pre-selection framing check (spec §3, §4, §12).

    Reuses the EXACT same ai.geometry.anchors.compute_anchor("necklace", ...) the
    render-time engine will later call for this same photo, so this check reasons about
    the same anchor point and the same real, measured shoulder-width reference frame —
    never a second, independently-invented geometry model (spec §12/§13: do not derive
    a different reference frame for the same body part)."""
    anchor = compute_anchor(
        "necklace", None, face=None, pose=pose, image_width_px=image_width_px, image_height_px=image_height_px
    )

    if not anchor.success or anchor.anchor_px is None:
        return FramingResult(
            ready=False,
            reason_code=anchor.error_code or "NECK_NOT_VISIBLE",
            user_message=(
                "We couldn't clearly find your neck and shoulders in this photo. "
                "Please retake the photo with your shoulders visible."
            ),
            technical_reason=anchor.error_message or "ai.geometry.anchors.compute_anchor(necklace) failed.",
            metrics={},
        )

    shoulder_width_px = anchor.reference_measurement_px or 0.0
    available_below_px = image_height_px - anchor.anchor_px.y
    required_vertical_space_px = NECKLACE_MIN_REQUIRED_VERTICAL_SPACE_FRACTION * shoulder_width_px

    metrics = {
        "anchor_x_px": anchor.anchor_px.x,
        "anchor_y_px": anchor.anchor_px.y,
        "shoulder_width_px": shoulder_width_px,
        "available_below_px": available_below_px,
        "required_vertical_space_px": required_vertical_space_px,
        "image_width_px": float(image_width_px),
        "image_height_px": float(image_height_px),
    }

    if available_below_px < required_vertical_space_px:
        return FramingResult(
            ready=False,
            reason_code="INSUFFICIENT_FRAMING",
            user_message="Please retake the photo with more of your upper chest visible.",
            technical_reason=(
                f"Predicted necklace anchor at y={anchor.anchor_px.y:.1f}px leaves only "
                f"{available_below_px:.1f}px of vertical space below it in a "
                f"{image_height_px}px-tall photo; at least {required_vertical_space_px:.1f}px "
                f"(a documented fraction of the measured {shoulder_width_px:.1f}px shoulder "
                "width) is expected for a typical necklace to fit within the frame."
            ),
            metrics=metrics,
        )

    return FramingResult(ready=True, reason_code=None, user_message=None, technical_reason=None, metrics=metrics)


# Spec §2: single registry a future category adds one entry to. "earrings" is
# deliberately absent — ai.landmarks.readiness's existing ears_ready signal is already
# positional (it comes from a specific detected ear landmark's own sufficiently_visible
# flag, computed per-side in ai.landmarks.face, not merely "a face was detected
# somewhere"), so it does not have the "confidently detected but off-frame" gap this
# module exists to close for necklace. Rings/bangles/bracelets/maang tikka/nose ring are
# explicitly out of scope this milestone (spec §26) and are not registered.
CATEGORY_FRAMING_EVALUATORS: Dict[str, Callable[..., FramingResult]] = {
    "necklace": evaluate_necklace_framing,
}
