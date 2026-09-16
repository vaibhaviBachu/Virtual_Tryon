"""
CatalogueAssetProcessor: the full pipeline from a stored original image to a
transparent processed cutout + thumbnail (Milestone 2 spec §13).

    validate (done at upload time, ai/preprocessing/image_validation.py)
    -> normalize (done at upload time)
    -> background removal (BackgroundRemover)
    -> alpha cleanup
    -> bounding-box detection with padding
    -> transparent output
    -> thumbnail generation
    -> metadata extraction

Deliberately framework-free: no FastAPI, no SQLAlchemy, no Redis import here. The
worker task (workers/tasks/process_jewellery_asset.py) is the only caller, and it owns
loading bytes from storage and writing the DB/storage side effects — this class is pure
image-in, image-out logic, which is what makes it unit-testable without a database or a
queue (Milestone 2 spec §13's "keep it testable independently").
"""
import io
import logging
from dataclasses import dataclass

import numpy as np
from PIL import Image

from ai.catalogue.background_remover import BackgroundRemover

logger = logging.getLogger("ai.catalogue.processor")

THUMBNAIL_MAX_DIMENSION_PX = 512
# Padding added around the detected jewellery bounding box, as a fraction of the box's
# own size, so a thin chain or a hook doesn't get cropped flush against the edge
# (Milestone 2 spec §14: "avoid aggressive cropping", "maintain appropriate padding").
BBOX_PADDING_FRACTION = 0.08
# Alpha values below this are treated as "definitely background" noise and zeroed out
# rather than left as a faint gray halo around the jewellery.
ALPHA_CLEANUP_THRESHOLD = 8


class ProcessingFailedError(Exception):
    """Raised when any pipeline stage fails. The message is safe for
    JewelleryAsset.processing_error (never a stack trace) — the technical cause is
    logged separately by the caller."""


@dataclass
class ProcessedAssetResult:
    processed_png_bytes: bytes
    thumbnail_png_bytes: bytes
    processed_width_px: int
    processed_height_px: int
    thumbnail_width_px: int
    thumbnail_height_px: int


class CatalogueAssetProcessor:
    def __init__(self, background_remover: BackgroundRemover) -> None:
        self._background_remover = background_remover

    def process(self, original_image_bytes: bytes) -> ProcessedAssetResult:
        removal_result = self._background_remover.remove_background(original_image_bytes)
        if not removal_result.success or removal_result.rgba_png_bytes is None:
            raise ProcessingFailedError(
                removal_result.error_message or "Background removal failed."
            )

        image = Image.open(io.BytesIO(removal_result.rgba_png_bytes)).convert("RGBA")
        image = self._clean_alpha(image)
        image = self._crop_to_padded_bounding_box(image)

        processed_bytes = self._encode_png(image)
        thumbnail = self._make_thumbnail(image)
        thumbnail_bytes = self._encode_png(thumbnail)

        return ProcessedAssetResult(
            processed_png_bytes=processed_bytes,
            thumbnail_png_bytes=thumbnail_bytes,
            processed_width_px=image.width,
            processed_height_px=image.height,
            thumbnail_width_px=thumbnail.width,
            thumbnail_height_px=thumbnail.height,
        )

    def _clean_alpha(self, image: Image.Image) -> Image.Image:
        arr = np.array(image)
        alpha = arr[:, :, 3]
        alpha = np.where(alpha < ALPHA_CLEANUP_THRESHOLD, 0, alpha)
        arr[:, :, 3] = alpha
        return Image.fromarray(arr, mode="RGBA")

    def _crop_to_padded_bounding_box(self, image: Image.Image) -> Image.Image:
        alpha = np.array(image)[:, :, 3]
        nonzero_rows = np.any(alpha > 0, axis=1)
        nonzero_cols = np.any(alpha > 0, axis=0)

        if not nonzero_rows.any() or not nonzero_cols.any():
            # Background removal produced an entirely transparent image — nothing to
            # crop to. This is a real failure (an empty cutout is useless for try-on),
            # not something to silently paper over with the original frame.
            raise ProcessingFailedError(
                "Background removal produced no visible foreground content."
            )

        top, bottom = np.where(nonzero_rows)[0][[0, -1]]
        left, right = np.where(nonzero_cols)[0][[0, -1]]

        box_width = right - left
        box_height = bottom - top
        pad_x = max(int(box_width * BBOX_PADDING_FRACTION), 4)
        pad_y = max(int(box_height * BBOX_PADDING_FRACTION), 4)

        left = max(left - pad_x, 0)
        top = max(top - pad_y, 0)
        right = min(right + pad_x, image.width - 1)
        bottom = min(bottom + pad_y, image.height - 1)

        return image.crop((left, top, right + 1, bottom + 1))

    def _make_thumbnail(self, image: Image.Image) -> Image.Image:
        thumbnail = image.copy()
        # Image.thumbnail mutates in place, preserves aspect ratio, and never upscales —
        # exactly the "do not stretch jewellery images" requirement.
        thumbnail.thumbnail((THUMBNAIL_MAX_DIMENSION_PX, THUMBNAIL_MAX_DIMENSION_PX), Image.LANCZOS)
        return thumbnail

    def _encode_png(self, image: Image.Image) -> bytes:
        buffer = io.BytesIO()
        # PNG is lossless — Milestone 2 spec §14 explicitly forbids aggressive
        # compression of the processed asset (thin chains/small stones must survive).
        image.save(buffer, format="PNG", optimize=False)
        return buffer.getvalue()
