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

from ai.catalogue.background_remover import BackgroundRemovalResult, _cutout_against_white_background, get_remover


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


def test_white_background_cutout_survives_jpeg_style_channel_noise():
    """Regression test for a real bug found against an actual catalogue upload: the
    background classifier originally used normalized HSL saturation, whose formula
    divides by (1 - |2*lightness-1|) -- a value that -> 0 as lightness approaches 1
    (pure white). A near-white pixel with only a whisper of RGB channel imbalance
    (e.g. 253/253/255, the kind of noise ordinary JPEG compression introduces
    constantly) got its "saturation" inflated to ~1.0 by that near-zero denominator,
    i.e. it read as maximally colorful -- so large stretches of a genuinely white
    background were wrongly classified as foreground and kept opaque. Confirmed
    directly against a real photo, not assumed. This test reproduces it synthetically:
    a solid gold square on a white background where the white has small per-pixel
    channel noise, and checks the background is still cut away, not kept opaque."""
    import random

    random.seed(0)
    img = Image.new("RGB", (200, 200), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle((60, 60, 140, 140), fill=(212, 175, 55))
    # Perturb every "white" pixel by a tiny, JPEG-noise-sized amount so it's no longer
    # exactly (255,255,255) but still visually/perceptually white.
    pixels = img.load()
    for y in range(200):
        for x in range(200):
            r, g, b = pixels[x, y]
            if (r, g, b) == (255, 255, 255):
                pixels[x, y] = (r - random.randint(0, 4), g - random.randint(0, 4), b)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=95)

    result = _cutout_against_white_background(buffer.getvalue())
    assert result is not None, "expected this to be recognized as a white-background photo"
    rgba_bytes, foreground_fraction = result

    # The gold square is 80x80 = 6400px of a 200x200 = 40000px image = 16%. A
    # correct cutout lands close to that; the bug inflated it towards ~60%+ because
    # the noisy "white" background was wrongly kept as foreground too.
    assert foreground_fraction < 0.30, f"expected ~16% foreground, got {foreground_fraction:.2f} (background wrongly kept opaque?)"

    output_image = Image.open(io.BytesIO(rgba_bytes)).convert("RGBA")
    arr = np.array(output_image)
    corner_alpha = arr[5, 5, 3]
    assert corner_alpha < 50, f"expected the noisy-white corner transparent, got alpha={corner_alpha}"


def test_remove_background_never_raises_on_bad_input():
    """The honest-failure contract (ai/engines/base.py's RenderResult pattern, reused
    here): even garbage input must come back as success=False, never an unhandled
    exception escaping into the worker."""
    remover = get_remover("rembg_u2net")
    result = remover.remove_background(b"not a real image at all")
    assert isinstance(result, BackgroundRemovalResult)
    assert result.success is False
    assert result.error_message
