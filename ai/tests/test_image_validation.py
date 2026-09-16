"""Unit tests for ai/preprocessing/image_validation.py — pure, no DB/network needed."""
import io

import piexif
import pytest
from PIL import Image

from ai.preprocessing.image_validation import (
    ImageValidationError,
    MAX_FILE_SIZE_BYTES,
    MIN_DIMENSION_PX,
    validate_and_normalize_upload,
)


def _jpeg_bytes(size=(400, 400), color=(10, 200, 30), exif_bytes: bytes | None = None) -> bytes:
    buffer = io.BytesIO()
    kwargs = {"format": "JPEG"}
    if exif_bytes is not None:
        kwargs["exif"] = exif_bytes
    Image.new("RGB", size, color).save(buffer, **kwargs)
    return buffer.getvalue()


def _png_bytes(size=(400, 400), color=(10, 200, 30, 255)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_valid_jpeg_passes_and_returns_correct_metadata():
    data = _jpeg_bytes(size=(640, 480))
    result = validate_and_normalize_upload(data)
    assert result.mime_type == "image/jpeg"
    assert result.width_px == 640
    assert result.height_px == 480
    assert result.file_size_bytes == len(result.content)


def test_valid_png_passes():
    data = _png_bytes(size=(500, 500))
    result = validate_and_normalize_upload(data)
    assert result.mime_type == "image/png"
    assert result.width_px == 500


def test_empty_file_rejected():
    with pytest.raises(ImageValidationError):
        validate_and_normalize_upload(b"")


def test_oversized_file_rejected():
    oversized = b"\xff\xd8\xff\xe0" + b"0" * (MAX_FILE_SIZE_BYTES + 1)
    with pytest.raises(ImageValidationError):
        validate_and_normalize_upload(oversized)


def test_non_image_bytes_rejected():
    with pytest.raises(ImageValidationError):
        validate_and_normalize_upload(b"this is definitely not an image")


def test_unsupported_format_rejected():
    # GIF is a real, well-formed image the sniffer will recognize but that Milestone
    # 2's spec does not list as a supported catalogue format.
    buffer = io.BytesIO()
    Image.new("RGB", (300, 300), (1, 2, 3)).save(buffer, format="GIF")
    with pytest.raises(ImageValidationError):
        validate_and_normalize_upload(buffer.getvalue())


def test_below_minimum_dimensions_rejected():
    data = _jpeg_bytes(size=(MIN_DIMENSION_PX - 1, MIN_DIMENSION_PX - 1))
    with pytest.raises(ImageValidationError):
        validate_and_normalize_upload(data)


def test_truncated_file_rejected_not_crashed():
    """Regression test: PIL's Image.verify() does not decode pixel data, so a
    structurally-plausible-but-truncated JPEG can pass verify() and then raise deeper in
    the pipeline. Confirmed as a real bug via manual end-to-end testing (a truncated
    upload returned an unhandled 500) and fixed by catching decode failures during EXIF
    normalization too."""
    full = _jpeg_bytes(size=(600, 600))
    truncated = full[: len(full) // 3]
    with pytest.raises(ImageValidationError):
        validate_and_normalize_upload(truncated)


def test_exif_is_stripped_from_normalized_output():
    exif_dict = {"0th": {piexif.ImageIFD.Make: b"TestCameraCorp"}}
    exif_bytes = piexif.dump(exif_dict)
    data = _jpeg_bytes(size=(400, 400), exif_bytes=exif_bytes)

    # Sanity check the input really did carry EXIF before we assert it's gone after.
    source_exif = Image.open(io.BytesIO(data)).info.get("exif")
    assert source_exif  # the fixture actually wrote EXIF data

    result = validate_and_normalize_upload(data)
    normalized_exif = Image.open(io.BytesIO(result.content)).info.get("exif")
    assert not normalized_exif


def test_orientation_is_normalized():
    """A landscape image tagged with a 90-degree-rotate EXIF orientation should come out
    physically rotated (width/height swapped) with the orientation tag consumed, not
    left for a downstream renderer to apply."""
    exif_dict = {"0th": {piexif.ImageIFD.Orientation: 6}}  # 6 = rotate 270 (or 90 CW display)
    exif_bytes = piexif.dump(exif_dict)
    data = _jpeg_bytes(size=(400, 300), exif_bytes=exif_bytes)

    result = validate_and_normalize_upload(data)
    # Orientation 6 means the stored image is rotated 90 degrees relative to how it
    # should display, so the physically-correct output swaps width/height.
    assert (result.width_px, result.height_px) == (300, 400)
