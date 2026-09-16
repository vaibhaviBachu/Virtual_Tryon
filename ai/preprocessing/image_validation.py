"""
Upload-time image validation for catalogue assets (Milestone 2 spec §9-10).

Deliberately synchronous and cheap (no background removal here — that's the async
worker job). This runs inside the API request because it's fast (milliseconds) and
because "was this a valid image at all" has to be answered before we create any
database row or enqueue any job.

Content-based MIME sniffing only — a client-supplied `Content-Type` header or filename
extension is never trusted, per the spec's explicit rule.
"""
import io
from dataclasses import dataclass
from typing import Optional

import filetype
from PIL import Image, ImageOps

# Formats intentionally supported for catalogue assets (Milestone 2 spec §10).
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}

MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB — generous for a DSLR/phone product photo
MIN_DIMENSION_PX = 200  # below this, a background-removal pass has nothing useful to work with
MAX_DIMENSION_PX = 8000  # guards against decompression-bomb-style dimension abuse


class ImageValidationError(ValueError):
    """Raised for any rejected upload. The message is safe to show to the admin UI —
    never a stack trace or internal path (docs/production-readiness.md error rule)."""


@dataclass
class ValidatedImage:
    """The result of validating + normalizing an upload, ready to hand to storage."""

    content: bytes
    mime_type: str
    width_px: int
    height_px: int
    file_size_bytes: int


def validate_and_normalize_upload(raw_bytes: bytes) -> ValidatedImage:
    """Runs the full upload-time pipeline: size check -> content-sniffed MIME check ->
    corrupt-image check -> EXIF orientation normalization -> EXIF stripping ->
    dimension check. Raises ImageValidationError on any failure."""
    _check_file_size(raw_bytes)
    mime_type = _sniff_mime_type(raw_bytes)
    image = _open_and_verify(raw_bytes)
    normalized = _normalize_orientation_and_strip_exif(image, mime_type)
    width, height = normalized_dimensions = Image.open(io.BytesIO(normalized)).size
    _check_dimensions(*normalized_dimensions)

    return ValidatedImage(
        content=normalized,
        mime_type=mime_type,
        width_px=width,
        height_px=height,
        file_size_bytes=len(normalized),
    )


def _check_file_size(raw_bytes: bytes) -> None:
    if len(raw_bytes) == 0:
        raise ImageValidationError("The uploaded file is empty.")
    if len(raw_bytes) > MAX_FILE_SIZE_BYTES:
        limit_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        raise ImageValidationError(f"File is too large. Maximum allowed size is {limit_mb} MB.")


def _sniff_mime_type(raw_bytes: bytes) -> str:
    kind = filetype.guess(raw_bytes)
    if kind is None or kind.mime not in ALLOWED_MIME_TYPES:
        detected = kind.mime if kind else "unknown"
        raise ImageValidationError(
            f"Unsupported image format (detected: {detected}). "
            f"Supported formats: JPEG, PNG, WebP."
        )
    return kind.mime


def _open_and_verify(raw_bytes: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(raw_bytes))
        image.verify()  # cheap structural check; does not decode pixel data
    except Exception as exc:
        raise ImageValidationError("The file could not be read as a valid image.") from exc
    # Image.verify() leaves the file object unusable for further operations, so reopen.
    try:
        return Image.open(io.BytesIO(raw_bytes))
    except Exception as exc:
        raise ImageValidationError("The file could not be read as a valid image.") from exc


def _normalize_orientation_and_strip_exif(image: Image.Image, mime_type: str) -> bytes:
    """Applies EXIF orientation (so a sideways phone photo displays right-side up) and
    then strips all EXIF metadata (GPS location, device info, timestamps) — the
    normalized output carries no EXIF block at all, satisfying both the "normalize
    orientation" and "strip unnecessary EXIF metadata" requirements at once.

    NOTE: PIL's Image.verify() (called in _open_and_verify) only checks the file's
    structure — it does not decode pixel data, so a truncated/corrupt-mid-stream file
    can pass verify() and then raise OSError here, the first point that actually calls
    .load() (via exif_transpose). That failure must still surface as an
    ImageValidationError, not an unhandled 500 — a real bug caught by testing a
    genuinely truncated JPEG upload, not assumed."""
    try:
        oriented = ImageOps.exif_transpose(image)
        if oriented is None:
            oriented = image

        if oriented.mode not in ("RGB", "RGBA"):
            oriented = oriented.convert("RGBA" if "A" in oriented.getbands() else "RGB")

        output = io.BytesIO()
        save_format = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[mime_type]
        if save_format == "JPEG" and oriented.mode == "RGBA":
            oriented = oriented.convert("RGB")
        oriented.save(output, format=save_format)  # no exif= kwarg -> no EXIF block written
        return output.getvalue()
    except ImageValidationError:
        raise
    except Exception as exc:
        raise ImageValidationError(
            "The file could not be fully decoded (it may be truncated or corrupted)."
        ) from exc


def _check_dimensions(width: int, height: int) -> None:
    if width < MIN_DIMENSION_PX or height < MIN_DIMENSION_PX:
        raise ImageValidationError(
            f"Image is too small ({width}x{height}px). Minimum is "
            f"{MIN_DIMENSION_PX}x{MIN_DIMENSION_PX}px."
        )
    if width > MAX_DIMENSION_PX or height > MAX_DIMENSION_PX:
        raise ImageValidationError(
            f"Image is too large ({width}x{height}px). Maximum is "
            f"{MAX_DIMENSION_PX}x{MAX_DIMENSION_PX}px."
        )
