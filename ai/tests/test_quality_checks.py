"""Real, deterministic tests for ai/preprocessing/quality_checks.py."""
import numpy as np

from ai.preprocessing.quality_checks import (
    MIN_BRIGHTNESS,
    MIN_DIMENSION_FOR_LANDMARKS_PX,
    check_image_quality,
)


def test_flat_bright_image_passes_brightness_but_fails_blur():
    image = np.full((600, 600, 3), 180, dtype=np.uint8)
    result = check_image_quality(image)
    assert result.passed is False
    assert any("blurry" in r for r in result.failure_reasons)


def test_dark_image_fails_brightness_check():
    image = np.full((600, 600, 3), 5, dtype=np.uint8)
    result = check_image_quality(image)
    assert result.passed is False
    assert any("too dark" in r for r in result.failure_reasons)
    assert result.brightness_mean < MIN_BRIGHTNESS


def test_overexposed_image_fails_brightness_check():
    image = np.full((600, 600, 3), 250, dtype=np.uint8)
    result = check_image_quality(image)
    assert result.passed is False
    assert any("bright" in r for r in result.failure_reasons)


def test_small_image_fails_resolution_check():
    image = (np.random.RandomState(0).rand(100, 100, 3) * 255).astype(np.uint8)
    result = check_image_quality(image)
    assert result.passed is False
    assert any("resolution" in r for r in result.failure_reasons)
    assert result.width_px == 100


def test_high_variance_noise_image_passes_blur_check():
    """Real, high-frequency content (random noise) has genuinely high Laplacian
    variance — the sharpest possible signal — and should never be flagged as blurry."""
    image = (np.random.RandomState(1).rand(600, 600, 3) * 255).astype(np.uint8)
    result = check_image_quality(image)
    assert result.laplacian_variance > 0
    assert not any("blurry" in r for r in result.failure_reasons)


def test_laplacian_variance_decreases_with_real_blur():
    """A genuinely smoother image must produce a real, measurably lower Laplacian
    variance than a sharp one — not a hard-coded pass/fail."""
    rng = np.random.RandomState(2)
    sharp = (rng.rand(120, 120, 3) * 255).astype(np.uint8)
    # A real box-blur convolution (not calling PIL here, to keep this test dependency-
    # light and prove the measurement itself, not a specific blur implementation).
    kernel_size = 9
    pad = kernel_size // 2
    padded = np.pad(sharp.astype(np.float64), ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    blurred = np.zeros_like(sharp, dtype=np.float64)
    for i in range(sharp.shape[0]):
        for j in range(sharp.shape[1]):
            blurred[i, j] = padded[i : i + kernel_size, j : j + kernel_size].mean(axis=(0, 1))
    blurred_u8 = blurred.astype(np.uint8)

    sharp_result = check_image_quality(sharp)
    blurred_result = check_image_quality(blurred_u8)
    assert blurred_result.laplacian_variance < sharp_result.laplacian_variance
