"""
Basic user-photo quality checks (Milestone 3 spec: "minimum resolution, excessive blur,
extreme darkness/brightness ... to prevent obviously unusable input reaching expensive
processing — do not overengineer scoring").

Deliberately cheap, deterministic, and separate from `ai/preprocessing/
image_validation.py` (which handles format/corruption/EXIF/size — Milestone 2's
existing, reused-as-is pipeline). This module runs AFTER that validation succeeds and
BEFORE the expensive landmark/segmentation worker stages, so a photo that is
technically a valid JPEG but is pitch black or hopelessly blurred fails fast with an
actionable message instead of wasting a MediaPipe inference pass.

Formulas are intentionally simple, real, and documented — not a tuned ML quality
model:
- Brightness: mean pixel luminance (0-255). Too low = underexposed; too high = blown out.
- Blur: variance of the Laplacian (a standard, well-known real edge-sharpness proxy —
  OpenCV's own documented technique, not invented here) — low variance means few sharp
  edges, i.e. a blurry image.
- Resolution: already enforced by image_validation.py's MIN_DIMENSION_PX, re-checked
  here only for a user-facing minimum tuned for landmark work specifically (portrait
  photos need more resolution than a small catalogue thumbnail).
"""
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

MIN_DIMENSION_FOR_LANDMARKS_PX = 480
MIN_BRIGHTNESS = 25.0  # mean luminance below this is "too dark to be usable"
MAX_BRIGHTNESS = 235.0  # mean luminance above this is "blown out / overexposed"
MIN_LAPLACIAN_VARIANCE = 15.0  # below this, treated as excessively blurred (empirically low bar for MVP)


@dataclass
class QualityCheckResult:
    passed: bool
    brightness_mean: float
    laplacian_variance: float
    width_px: int
    height_px: int
    failure_reasons: List[str]


def check_image_quality(image_rgb: np.ndarray) -> QualityCheckResult:
    height, width = image_rgb.shape[0], image_rgb.shape[1]
    gray = _to_grayscale(image_rgb)
    brightness = float(gray.mean())
    laplacian_var = float(_laplacian_variance(gray))

    reasons: List[str] = []
    if width < MIN_DIMENSION_FOR_LANDMARKS_PX or height < MIN_DIMENSION_FOR_LANDMARKS_PX:
        reasons.append(
            f"Photo resolution ({width}x{height}px) is too low for reliable analysis. "
            f"Please use a photo at least {MIN_DIMENSION_FOR_LANDMARKS_PX}x{MIN_DIMENSION_FOR_LANDMARKS_PX}px."
        )
    if brightness < MIN_BRIGHTNESS:
        reasons.append("Photo is too dark. Please retake it in better lighting.")
    if brightness > MAX_BRIGHTNESS:
        reasons.append("Photo is too bright/overexposed. Please avoid strong backlighting or direct flash.")
    if laplacian_var < MIN_LAPLACIAN_VARIANCE:
        reasons.append("Photo appears too blurry. Please hold the camera steady and retake it.")

    return QualityCheckResult(
        passed=len(reasons) == 0,
        brightness_mean=brightness,
        laplacian_variance=laplacian_var,
        width_px=width,
        height_px=height,
        failure_reasons=reasons,
    )


def _to_grayscale(image_rgb: np.ndarray) -> np.ndarray:
    # Standard luminance weighting (ITU-R BT.601), avoids an OpenCV dependency for this
    # one conversion so this module has no hard cv2 requirement.
    return (
        0.299 * image_rgb[:, :, 0].astype(np.float64)
        + 0.587 * image_rgb[:, :, 1].astype(np.float64)
        + 0.114 * image_rgb[:, :, 2].astype(np.float64)
    )


def _laplacian_variance(gray: np.ndarray) -> float:
    """A discrete Laplacian convolution computed with plain numpy (no cv2 dependency
    here) — same well-known kernel OpenCV's `cv2.Laplacian` uses internally."""
    kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float64)
    padded = np.pad(gray, 1, mode="edge")
    conv = (
        kernel[0, 1] * padded[0:-2, 1:-1]
        + kernel[1, 0] * padded[1:-1, 0:-2]
        + kernel[1, 1] * padded[1:-1, 1:-1]
        + kernel[1, 2] * padded[1:-1, 2:]
        + kernel[2, 1] * padded[2:, 1:-1]
    )
    return float(conv.var())
