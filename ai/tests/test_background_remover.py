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


def test_remove_background_extracts_a_thin_ring_not_its_enclosed_background():
    """Regression test for a real bug found against two actual catalogue uploads: a
    thin gold chain photographed as a large open loop on white came back from the
    plain rembg/u2net model with the WHITE AREA ENCLOSED BY THE CHAIN kept opaque and
    the chain itself cut away -- the model favored the large contiguous region over
    the thin ring around it. Reproduced here with a synthetic thin ring (an annulus,
    not a filled circle) on a white background, which is the same shape class."""
    img = Image.new("RGB", (400, 400), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    # A ring, not a disc: outer boundary filled, inner boundary painted back to
    # background white -- so the enclosed area is background, same as a necklace loop.
    draw.ellipse((80, 80, 320, 320), fill=(212, 175, 55))
    draw.ellipse((140, 140, 260, 260), fill=(255, 255, 255))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=95)

    remover = get_remover("rembg_u2net")
    result = remover.remove_background(buffer.getvalue())

    assert result.success is True
    output_image = Image.open(io.BytesIO(result.rgba_png_bytes)).convert("RGBA")
    arr = np.array(output_image)

    # The ring itself (gold-colored pixels) must be opaque...
    ring_point = arr[100, 200]  # inside the painted gold band
    assert ring_point[3] > 200, f"expected the ring itself opaque, got alpha={ring_point[3]}"
    # ...and the area enclosed BY the ring (the hole) must be transparent, not kept
    # opaque the way the plain saliency model got this wrong.
    hole_point = arr[200, 200]  # center of the ring, inside the hole
    assert hole_point[3] < 50, f"expected the ring's enclosed hole transparent, got alpha={hole_point[3]}"


def test_remove_background_never_raises_on_bad_input():
    """The honest-failure contract (ai/engines/base.py's RenderResult pattern, reused
    here): even garbage input must come back as success=False, never an unhandled
    exception escaping into the worker."""
    remover = get_remover("rembg_u2net")
    result = remover.remove_background(b"not a real image at all")
    assert isinstance(result, BackgroundRemovalResult)
    assert result.success is False
    assert result.error_message
