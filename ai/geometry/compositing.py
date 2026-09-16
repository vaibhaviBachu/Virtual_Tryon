"""
alpha_composite() — spec §17: "Use proper alpha compositing. Do not create white
boxes, black backgrounds, rectangular image overlays." Standard "over" operator, done
in floating point for correctness, converted back to uint8 once at the end.
"""
import numpy as np


def alpha_composite(base_rgb: np.ndarray, overlay_rgba: np.ndarray) -> np.ndarray:
    """`base_rgb`: HxWx3 uint8. `overlay_rgba`: HxWx4 uint8, same H/W as base — the
    caller (ai.engines.geometry.engine) is responsible for warping the jewellery asset
    onto a canvas matching the user photo's dimensions before calling this (see
    ai.geometry.transform.apply_transform). Only pixels with overlay alpha > 0
    contribute anything to the output — a fully-transparent overlay pixel leaves the
    base pixel completely unchanged, which is what prevents any rectangular
    background/border artifact from ever appearing."""
    if base_rgb.shape[:2] != overlay_rgba.shape[:2]:
        raise ValueError(
            f"alpha_composite requires matching dimensions, got base {base_rgb.shape[:2]} "
            f"vs overlay {overlay_rgba.shape[:2]}"
        )

    base_f = base_rgb.astype(np.float64)
    overlay_rgb_f = overlay_rgba[:, :, :3].astype(np.float64)
    alpha_f = (overlay_rgba[:, :, 3:4].astype(np.float64)) / 255.0

    composed = overlay_rgb_f * alpha_f + base_f * (1.0 - alpha_f)
    return np.clip(composed, 0, 255).astype(np.uint8)
