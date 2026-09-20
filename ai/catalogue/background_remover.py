"""
Background-removal abstraction for the catalogue asset-processing pipeline.

IMPORTANT STATUS NOTE (see ai/models/LICENSES.md and docs/milestone-2-verification.md
for the full account): Milestone 0's research selected SAM2 for this admin-only asset
path. SAM2 itself is NOT integrated in this milestone — its model weights are hosted on
huggingface.co, and this build/runtime environment's network policy blocks that host
outright (verified directly, not assumed). Rather than fake SAM2 working, or leave
background removal unimplemented and unverifiable, this milestone ships a real, tested,
commercially-licensed alternative: rembg (MIT license) running the U-2-Net salient
object segmentation model (Apache 2.0 license, verified from the model's own repository
— see LICENSES.md). Both licenses were fetched and read directly, not assumed from
memory.

This is exposed behind the same kind of interface/registry pattern as `ai/engines/` so
swapping in SAM2 later (once weights are reachable, e.g. self-hosted or mirrored) is a
new class + a registry entry, not a rewrite of the processing pipeline.
"""
import io
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict

logger = logging.getLogger("ai.catalogue.background_remover")

# --- White-background color-threshold cutout ---
#
# Added after two real catalogue uploads (both thin gold chains photographed as a large
# open loop on a plain white background) came back from RembgBackgroundRemover with the
# ENCLOSED WHITE AREA INSIDE THE CHAIN kept opaque and the actual gold chain cut away --
# confirmed by visual inspection of the real output, not assumed. This is a known
# failure mode of salient-object segmentation on thin/ring-shaped subjects: the model
# favors the large contiguous region over the thin border around it. Tried first: a
# different rembg model (isnet-general-use) and alpha-matting edge refinement -- both
# reproduced the identical wrong cutout, confirming the problem is which region gets
# selected as foreground, not edge quality.
#
# This catalogue's photos are conventionally shot on a plain white/near-white
# background (every real upload so far), so a direct color-threshold cutout --
# "background is anything near-white and low-saturation" -- sidesteps the
# saliency-model's region-selection mistake entirely for that common case. It is
# deliberately narrow: only attempted when near-white/low-saturation pixels already
# cover a large share of the WHOLE image (WHITE_BG_MIN_BACKGROUND_FRACTION below), not
# just a thin border strip -- a real catalogue photo (verified against these two
# failures plus the working necklace example) can have a thin dark watermark/frame
# artifact right at its own edge pixels, which made an earlier border-only version of
# this check miss real near-white photos. Its result is sanity-checked before being
# trusted; RembgBackgroundRemover falls through to the general rembg model otherwise,
# so this never replaces rembg for a genuinely different (colored/patterned) background.
WHITE_BG_LIGHTNESS_THRESHOLD = 0.80
WHITE_BG_SATURATION_THRESHOLD = 0.25
# This method is only attempted when near-white pixels already cover a large share of
# the whole image -- real near-white-background catalogue photos measured at 41-57%;
# a colored/patterned-background photo would measure far lower.
WHITE_BG_MIN_BACKGROUND_FRACTION = 0.25
# A real jewellery-on-white photo's cut-out subject is a modest fraction of the frame.
# Outside this range the threshold result is treated as unreliable (nothing found, or
# it swallowed the whole photo because the background wasn't actually near-white) and
# RembgBackgroundRemover falls back to the general model instead of trusting it.
WHITE_BG_PLAUSIBLE_FOREGROUND_FRACTION = (0.02, 0.85)
# A closed-loop item's real hole (bangle, ring, a necklace shot as a fully closed
# circle) is expected to be a substantial fraction of the frame; a genuine gap/pinhole
# (chain clasp, small link gap) is not. 1% of the image's total pixels safely separates
# the two without needing per-category logic here.
SMALL_HOLE_MAX_FRACTION = 0.01


def _cutout_against_white_background(image_bytes: bytes) -> tuple[bytes, float] | None:
    """Returns (rgba_png_bytes, foreground_fraction), or None if this image doesn't
    look like a near-white-background photo in the first place (WHITE_BG_MIN_
    BACKGROUND_FRACTION not met) -- the caller should fall back to rembg in that case.
    The fraction is for the caller's own further sanity check, not persisted anywhere.
    """
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.asarray(image).astype(np.float32) / 255.0
    maxc = arr.max(axis=-1)
    minc = arr.min(axis=-1)
    lightness = (maxc + minc) / 2
    # HSL saturation formula; the +1e-6 avoids a 0/0 on fully achromatic (pure
    # black/white/gray) pixels, which should read as saturation 0 anyway.
    saturation = np.where(maxc == minc, 0, (maxc - minc) / (1 - np.abs(2 * lightness - 1) + 1e-6))

    is_background = (lightness > WHITE_BG_LIGHTNESS_THRESHOLD) & (saturation < WHITE_BG_SATURATION_THRESHOLD)
    if is_background.mean() < WHITE_BG_MIN_BACKGROUND_FRACTION:
        return None
    foreground = ~is_background
    # Morphological cleanup: drop speckle noise, then close small gaps along the
    # subject's own boundary (a chain's clasp, a gap between links).
    foreground = ndimage.binary_opening(foreground, structure=np.ones((2, 2)))
    foreground = ndimage.binary_closing(foreground, structure=np.ones((4, 4)))
    # Fill only SMALL fully-enclosed background pockets (noise, tiny gaps) -- NOT a
    # blanket binary_fill_holes. A bangle, ring, or a necklace photographed as a
    # genuinely closed loop has a large enclosed hole that is meaningful and must stay
    # transparent (it's core to how that category renders); only an open loop's
    # connection to the outer background would survive an unfiltered fill_holes call
    # untouched, so a closed-loop item would otherwise get its real hole silently
    # painted over. Only pockets smaller than SMALL_HOLE_MAX_FRACTION of the whole
    # image are treated as noise and filled.
    filled = ndimage.binary_fill_holes(foreground)
    newly_filled = filled & ~foreground
    labeled, num_pockets = ndimage.label(newly_filled)
    if num_pockets > 0:
        pocket_sizes = ndimage.sum(newly_filled, labeled, index=range(1, num_pockets + 1))
        small_pocket_labels = [i + 1 for i, size in enumerate(pocket_sizes) if size < foreground.size * SMALL_HOLE_MAX_FRACTION]
        if small_pocket_labels:
            foreground = foreground | np.isin(labeled, small_pocket_labels)

    alpha = (foreground * 255).astype(np.uint8)
    rgba = np.dstack([np.asarray(image), alpha])
    buffer = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buffer, format="PNG")
    return buffer.getvalue(), float(foreground.mean())


@dataclass
class BackgroundRemovalResult:
    success: bool
    rgba_png_bytes: bytes | None = None
    error_message: str | None = None


class BackgroundRemover(ABC):
    remover_name: str = "base"

    @abstractmethod
    def remove_background(self, image_bytes: bytes) -> BackgroundRemovalResult:
        """Takes an arbitrary-format image and returns an RGBA PNG with the background
        made transparent. Must never fabricate a plausible-looking output on failure —
        return success=False instead (see ai/engines/base.py's RenderResult for the same
        "honest failure" convention used by the try-on engines)."""
        raise NotImplementedError


class RembgBackgroundRemover(BackgroundRemover):
    """CPU-only, MIT-licensed background removal via the U-2-Net ONNX model."""

    remover_name = "rembg_u2net"

    def __init__(self) -> None:
        # Imported lazily so importing this module (e.g. from apps/api, which never
        # calls it) doesn't require onnxruntime/rembg to be installed there.
        from rembg import new_session

        self._session = new_session("u2net")

    def remove_background(self, image_bytes: bytes) -> BackgroundRemovalResult:
        try:
            white_bg_result = _cutout_against_white_background(image_bytes)
            if white_bg_result is not None:
                cutout_bytes, foreground_fraction = white_bg_result
                low, high = WHITE_BG_PLAUSIBLE_FOREGROUND_FRACTION
                if low < foreground_fraction < high:
                    return BackgroundRemovalResult(success=True, rgba_png_bytes=cutout_bytes)
                logger.info(
                    "White-background cutout produced an implausible foreground "
                    "fraction (%.3f); falling back to rembg",
                    foreground_fraction,
                )
        except Exception:  # noqa: BLE001 — this is a best-effort first attempt; any
            # failure here must fall through to rembg below, never abort the job.
            logger.exception("White-background color-threshold cutout failed; falling back to rembg")

        from rembg import remove

        try:
            output = remove(image_bytes, session=self._session)
            return BackgroundRemovalResult(success=True, rgba_png_bytes=output)
        except Exception as exc:  # noqa: BLE001 — this boundary must never raise into the worker
            logger.exception("Background removal failed")
            return BackgroundRemovalResult(success=False, error_message=str(exc))


_registry: Dict[str, BackgroundRemover] = {}


def register_remover(name: str, remover: BackgroundRemover) -> None:
    _registry[name] = remover


def get_remover(name: str = "rembg_u2net") -> BackgroundRemover:
    if name not in _registry:
        if name == "rembg_u2net":
            _registry[name] = RembgBackgroundRemover()
        else:
            raise ValueError(f"No background remover registered under name {name!r}")
    return _registry[name]
