"""
Debug/internal placement visualization — spec §27: "Create an internal/debug mode to
visualize body anchor, jewellery anchor, relevant landmarks, transformed jewellery
bounding box, rotation, scale. Do not expose to normal customers."

This module only draws on a copy of the array it is given; the caller
(ai.engines.geometry.engine.GeometryTryOnEngine, gated by
apps/api/v1/routers/tryon.py's debug endpoint + Settings.ENABLE_TRYON_DEBUG_VIZ) is
responsible for deciding whether a debug image is generated/stored/exposed at all.
"""
from typing import List

import cv2
import numpy as np

from ai.geometry.framing import FramingResult
from ai.geometry.schemas import PlacementRecord

_ANCHOR_COLOR_BGR = (0, 0, 255)  # red
_BBOX_COLOR_BGR = (0, 200, 0)  # green
_TEXT_COLOR_BGR = (255, 255, 0)  # cyan
_VALID_REGION_COLOR_BGR = (0, 200, 0)  # green — required vertical space, framing OK
_INSUFFICIENT_REGION_COLOR_BGR = (0, 0, 255)  # red — required vertical space, framing NOT OK


def render_debug_overlay(base_image_rgb: np.ndarray, placements: List[PlacementRecord]) -> np.ndarray:
    """Returns a NEW RGB array (does not mutate `base_image_rgb`) with anchors,
    transformed bounding boxes, and a one-line scale/rotation label drawn for every
    successfully-transformed placement."""
    canvas_bgr = cv2.cvtColor(base_image_rgb, cv2.COLOR_RGB2BGR).copy()

    for placement in placements:
        if placement.anchor.success and placement.anchor.anchor_px is not None:
            center = (int(round(placement.anchor.anchor_px.x)), int(round(placement.anchor.anchor_px.y)))
            cv2.drawMarker(canvas_bgr, center, _ANCHOR_COLOR_BGR, markerType=cv2.MARKER_CROSS, markerSize=16, thickness=2)

        if placement.transform is not None:
            left, top, right, bottom = placement.transform.transformed_bbox_px
            cv2.rectangle(
                canvas_bgr,
                (int(round(left)), int(round(top))),
                (int(round(right)), int(round(bottom))),
                _BBOX_COLOR_BGR,
                2,
            )
            label = (
                f"{placement.side or 'necklace'} scale={placement.scale.scale_factor:.2f} "
                f"rot={placement.rotation.rotation_degrees:.1f}deg"
            )
            text_origin = (int(round(left)), max(0, int(round(top)) - 8))
            cv2.putText(canvas_bgr, label, text_origin, cv2.FONT_HERSHEY_SIMPLEX, 0.5, _TEXT_COLOR_BGR, 1, cv2.LINE_AA)

    return cv2.cvtColor(canvas_bgr, cv2.COLOR_BGR2RGB)


def render_framing_debug_overlay(base_image_rgb: np.ndarray, framing: FramingResult) -> np.ndarray:
    """Milestone 4 stabilization spec §17: extend the debug visualization to show the
    PRE-SELECTION framing pre-check's own geometry — the computed necklace anchor, the
    required vertical space below it, and the available space actually remaining in the
    photo — with a distinct color for VALID vs INSUFFICIENT_FRAMING. This runs before
    any jewellery item is selected, so (unlike render_debug_overlay above) there is no
    PlacementRecord/transformed asset bounding box to draw yet — only the pre-check's
    own metrics, exactly as computed by ai.geometry.framing.evaluate_necklace_framing.

    Returns a NEW RGB array (does not mutate `base_image_rgb`). If `framing.metrics` is
    empty (the anchor itself could not be computed — NECK_NOT_VISIBLE), only the
    ready/not-ready label is drawn.
    """
    canvas_bgr = cv2.cvtColor(base_image_rgb, cv2.COLOR_RGB2BGR).copy()
    color = _VALID_REGION_COLOR_BGR if framing.ready else _INSUFFICIENT_REGION_COLOR_BGR
    label = "NECKLACE FRAMING: READY" if framing.ready else f"NECKLACE FRAMING: {framing.reason_code}"

    metrics = framing.metrics or {}
    anchor_x = metrics.get("anchor_x_px")
    anchor_y = metrics.get("anchor_y_px")
    required = metrics.get("required_vertical_space_px")

    if anchor_x is not None and anchor_y is not None:
        center = (int(round(anchor_x)), int(round(anchor_y)))
        cv2.drawMarker(canvas_bgr, center, color, markerType=cv2.MARKER_CROSS, markerSize=20, thickness=2)
        if required is not None:
            # Draw the REQUIRED_NECKLACE_REGION (spec §4) as a vertical line straight
            # down from the anchor, exactly `required_vertical_space_px` long — the
            # same real, per-photo pixel value the pre-check itself compared against
            # AVAILABLE_RENDER_REGION (the photo's own remaining height below the
            # anchor), never a re-derived or approximated value.
            required_bottom = (center[0], int(round(anchor_y + required)))
            cv2.line(canvas_bgr, center, required_bottom, color, 2)
            cv2.circle(canvas_bgr, required_bottom, 5, color, -1)

    text_origin = (10, base_image_rgb.shape[0] - 12)
    cv2.putText(canvas_bgr, label, text_origin, cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA)

    return cv2.cvtColor(canvas_bgr, cv2.COLOR_BGR2RGB)
