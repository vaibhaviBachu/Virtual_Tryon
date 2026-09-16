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

from ai.geometry.schemas import PlacementRecord

_ANCHOR_COLOR_BGR = (0, 0, 255)  # red
_BBOX_COLOR_BGR = (0, 200, 0)  # green
_TEXT_COLOR_BGR = (255, 255, 0)  # cyan


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
