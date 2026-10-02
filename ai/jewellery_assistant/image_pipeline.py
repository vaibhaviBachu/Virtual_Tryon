"""
Deterministic (non-AI) image preparation for the AI Jewellery Assistant's catalogue
preview.

This is intentionally plain PIL work -- resize, pad, white background, format
conversion -- never a generative API call. An AI image-generation call (see
`providers/image_provider.py`) is only worth its cost for the genuinely hard part
(removing a hand/person/background the customer's own photo happens to include); a
square white-background crop is not that, and burning a paid API call on it would
violate the "don't waste a generative AI call simply to resize an image" rule.

This produces the 200x200 CATALOGUE PREVIEW shown in the assistant's chat UI only. It is
never the asset handed to the real try-on/AR pipeline -- see
apps/api/v1/services/jewellery_ai_service.py's submit step, which uploads the
full-resolution prepared image (AI-enhanced if a provider ran, otherwise this same
deterministic cleanup at full size) through the existing catalogue asset pipeline,
exactly the path admin-created items already go through.
"""
import io
from dataclasses import dataclass

from PIL import Image

CATALOGUE_PREVIEW_SIZE_PX = 200
# Fraction of the canvas left as margin around the jewellery on every side, so the item
# never touches the frame edge -- matches the padded-crop convention already used by
# ai/catalogue/processor.py for the real worker pipeline, applied here independently
# since this preview must stand alone without a transparent-background input.
PREVIEW_PADDING_FRACTION = 0.08
WHITE = (255, 255, 255, 255)


class ImagePreparationError(ValueError):
    """Raised when the input cannot be prepared at all (e.g. genuinely unreadable).
    Upload-time format/size/corruption checks happen earlier, in
    ai.preprocessing.image_validation -- this is a second, narrower failure mode:
    an image that passed basic validation but PIL still can't process for some reason."""


@dataclass
class PreparedCataloguePreview:
    png_bytes: bytes
    width_px: int
    height_px: int


def make_catalogue_preview(
    image_bytes: bytes, *, size_px: int = CATALOGUE_PREVIEW_SIZE_PX
) -> PreparedCataloguePreview:
    """Centers the image on a white square canvas, preserving aspect ratio (never
    distorting/stretching), with padding so the jewellery occupies the useful central
    area without touching the edge. Pure resize/pad/composite -- no cropping of the
    source content, no background removal (the source is expected to already be
    reasonably clean by this point, either because the customer's photo already was or
    because an AI image-generation provider cleaned it up first)."""
    try:
        source = Image.open(io.BytesIO(image_bytes))
        source.load()
    except Exception as exc:
        raise ImagePreparationError("The image could not be prepared for the catalogue preview.") from exc

    if source.mode != "RGBA":
        source = source.convert("RGBA")

    usable_px = max(1, round(size_px * (1 - 2 * PREVIEW_PADDING_FRACTION)))
    scale = min(usable_px / source.width, usable_px / source.height)
    scaled_width = max(1, round(source.width * scale))
    scaled_height = max(1, round(source.height * scale))
    resized = source.resize((scaled_width, scaled_height), Image.LANCZOS)

    canvas = Image.new("RGBA", (size_px, size_px), WHITE)
    offset = ((size_px - scaled_width) // 2, (size_px - scaled_height) // 2)
    # alpha_composite needs the pasted layer to be the same size as the canvas with the
    # content positioned via its own transparent padding, not a plain paste -- this
    # keeps any transparency in `resized` (e.g. a provider output with a transparent
    # background) blending onto the white canvas correctly instead of showing black.
    layer = Image.new("RGBA", (size_px, size_px), (255, 255, 255, 0))
    layer.paste(resized, offset, resized if resized.mode == "RGBA" else None)
    canvas.alpha_composite(layer)

    flattened = Image.new("RGB", (size_px, size_px), WHITE[:3])
    flattened.paste(canvas, mask=canvas.split()[3])

    output = io.BytesIO()
    flattened.save(output, format="PNG")
    return PreparedCataloguePreview(png_bytes=output.getvalue(), width_px=size_px, height_px=size_px)


# --- AI output validation ---
#
# A real, observed failure mode: when the AI image step isn't configured, errors out, or
# simply fails to follow instructions, the unedited original (a full photo -- person,
# background, everything) can silently end up looking like a "successful" result if
# nothing checks it. This is a cheap, honest, deterministic sanity check -- NOT a
# full object/face detector (out of scope) -- that catches the common, obvious case: a
# real isolated-product-on-white-background photo has a LARGE near-white background
# area; a full photo of a person in a normal room/setting essentially never does.
# Same lightness/chroma convention as ai/catalogue/background_remover.py's white-
# background cutout (kept independent rather than imported, since that module is
# worker-only and pulls in rembg/onnxruntime as a side effect of import).
_WHITE_LIGHTNESS_THRESHOLD = 0.85
_WHITE_CHROMA_THRESHOLD = 0.10
MIN_WHITE_BACKGROUND_FRACTION = 0.30


def looks_like_isolated_product_photo(image_bytes: bytes) -> bool:
    """Returns True only if a large enough fraction of the image is near-white --
    the minimum honest signal that background removal actually happened. False means
    "this still looks like the original, un-isolated photo" and the caller must not
    present it to the customer as a successful AI result."""
    try:
        import numpy as np

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        arr = np.asarray(image).astype(np.float32) / 255.0
        maxc = arr.max(axis=-1)
        minc = arr.min(axis=-1)
        lightness = (maxc + minc) / 2
        chroma = maxc - minc
        is_white = (lightness > _WHITE_LIGHTNESS_THRESHOLD) & (chroma < _WHITE_CHROMA_THRESHOLD)
        return bool(is_white.mean() >= MIN_WHITE_BACKGROUND_FRACTION)
    except Exception:
        # Validation itself failing is not a reason to reject an otherwise-valid image
        # outright -- but it also isn't a reason to trust it blindly, so this is logged
        # by the caller as "validation could not run," treated the same as "failed."
        return False
