"""
Tests the real RembgBackgroundRemover end-to-end against the actual rembg/U-2-Net
model (downloaded once, cached under the model cache directory) — proving background
removal genuinely runs in this environment, since SAM2 itself (Milestone 0's original
pick) is blocked here (huggingface.co returns 403 — verified, documented in
ai/models/LICENSES.md and docs/milestone-2-verification.md, not assumed or faked).
"""
import io

import numpy as np
from PIL import Image, ImageDraw

from ai.catalogue.background_remover import BackgroundRemovalResult, get_remover


def test_get_remover_returns_the_same_cached_instance():
    a = get_remover("rembg_u2net")
    b = get_remover("rembg_u2net")
    assert a is b


def test_remove_background_returns_real_transparent_output():
    img = Image.new("RGB", (400, 400), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.ellipse((100, 100, 300, 300), fill=(212, 175, 55))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=95)

    remover = get_remover("rembg_u2net")
    result = remover.remove_background(buffer.getvalue())

    assert isinstance(result, BackgroundRemovalResult)
    assert result.success is True
    assert result.rgba_png_bytes is not None

    output_image = Image.open(io.BytesIO(result.rgba_png_bytes))
    assert output_image.mode == "RGBA"
    alpha = np.array(output_image.split()[-1])
    # A genuine model output has a real mix of transparent and opaque pixels — not a
    # uniform value, which would indicate a faked/pass-through result.
    assert alpha.min() != alpha.max()


def test_remove_background_never_raises_on_bad_input():
    """The honest-failure contract (ai/engines/base.py's RenderResult pattern, reused
    here): even garbage input must come back as success=False, never an unhandled
    exception escaping into the worker."""
    remover = get_remover("rembg_u2net")
    result = remover.remove_background(b"not a real image at all")
    assert isinstance(result, BackgroundRemovalResult)
    assert result.success is False
    assert result.error_message
