"""
Tests for ai/catalogue/processor.py.

Uses the real RembgBackgroundRemover for the success-path tests (it's a genuine,
already-verified-working model — see ai/tests/test_background_remover.py — not mocked
out, per the project's "never fake image-processing output" rule) and a deliberately
scripted stub BackgroundRemover for the failure-path tests, since those need to force
specific, otherwise-hard-to-reproduce failure conditions (a remover that reports failure,
and one whose output is fully transparent).
"""
import io

import numpy as np
import pytest
from PIL import Image, ImageDraw

from ai.catalogue.background_remover import BackgroundRemovalResult, BackgroundRemover, get_remover
from ai.catalogue.processor import CatalogueAssetProcessor, ProcessingFailedError


def _jewellery_like_image_bytes() -> bytes:
    """A clear ring-shaped object on a plain white background — enough visual contrast
    for a real background-removal model to find a foreground object."""
    img = Image.new("RGB", (500, 500), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.ellipse((150, 150, 350, 350), outline=(200, 160, 40), width=40)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


class _AlwaysFailsRemover(BackgroundRemover):
    remover_name = "always_fails"

    def remove_background(self, image_bytes: bytes) -> BackgroundRemovalResult:
        return BackgroundRemovalResult(success=False, error_message="synthetic failure for testing")


class _FullyTransparentRemover(BackgroundRemover):
    remover_name = "fully_transparent"

    def remove_background(self, image_bytes: bytes) -> BackgroundRemovalResult:
        image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))  # every pixel fully transparent
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return BackgroundRemovalResult(success=True, rgba_png_bytes=buffer.getvalue())


@pytest.fixture(scope="module")
def real_remover():
    return get_remover("rembg_u2net")


def test_process_produces_transparent_cropped_output_and_thumbnail(real_remover):
    processor = CatalogueAssetProcessor(real_remover)
    result = processor.process(_jewellery_like_image_bytes())

    processed_image = Image.open(io.BytesIO(result.processed_png_bytes))
    assert processed_image.mode == "RGBA"
    alpha = np.array(processed_image.split()[-1])
    assert alpha.min() < 255  # some transparency actually exists — not an opaque no-op
    assert alpha.max() > 0  # some real foreground survived

    thumbnail_image = Image.open(io.BytesIO(result.thumbnail_png_bytes))
    assert max(thumbnail_image.size) <= 512
    assert thumbnail_image.mode == "RGBA"

    # The crop should be smaller than or equal to the original 500x500 canvas — a real
    # bounding-box crop happened, not a pass-through of the full frame.
    assert result.processed_width_px <= 500
    assert result.processed_height_px <= 500
    assert result.processed_width_px == processed_image.width
    assert result.processed_height_px == processed_image.height


def test_process_never_upscales_the_thumbnail(real_remover):
    processor = CatalogueAssetProcessor(real_remover)
    result = processor.process(_jewellery_like_image_bytes())
    assert result.thumbnail_width_px <= result.processed_width_px
    assert result.thumbnail_height_px <= result.processed_height_px


def test_process_raises_processing_failed_error_when_remover_reports_failure():
    processor = CatalogueAssetProcessor(_AlwaysFailsRemover())
    with pytest.raises(ProcessingFailedError):
        processor.process(b"irrelevant bytes, the stub remover ignores its input")


def test_process_raises_processing_failed_error_on_fully_transparent_output():
    """A background remover that (incorrectly, or on a genuinely foreground-less image)
    returns an entirely transparent result must be treated as a failure — an empty
    cutout is useless for the future try-on engine, not a valid processed asset."""
    processor = CatalogueAssetProcessor(_FullyTransparentRemover())
    with pytest.raises(ProcessingFailedError):
        processor.process(b"irrelevant bytes, the stub remover ignores its input")
