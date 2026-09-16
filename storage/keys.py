"""
Object-storage key construction and sanitization, shared between apps/api (creates the
`original` key on upload) and workers (creates `processed`/`thumbnail` keys after
background removal).

Key layout (per Milestone 2 spec §8):
    jewellery/{jewellery_id}/original/{asset_id}{ext}
    jewellery/{jewellery_id}/processed/{asset_id}{ext}
    jewellery/{jewellery_id}/thumbnail/{asset_id}{ext}

User/customer photos (Milestone 3+) will live under a different top-level prefix
(`uploads/` per docs/architecture.md §8) — never under `jewellery/` — keeping the two
namespaces logically separated as the spec requires.
"""
import re
import uuid

_SAFE_EXT_RE = re.compile(r"^[a-zA-Z0-9]{1,10}$")

_EXTENSION_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def extension_for_mime_type(mime_type: str) -> str:
    """Never trust a client-supplied filename for the extension — derive it from the
    content-sniffed MIME type instead (see ai/preprocessing/image_validation.py)."""
    return _EXTENSION_BY_MIME.get(mime_type, "bin")


def sanitize_extension(ext: str) -> str:
    ext = ext.lstrip(".").lower()
    if not _SAFE_EXT_RE.match(ext):
        raise ValueError(f"Unsafe or invalid file extension: {ext!r}")
    return ext


def jewellery_asset_key(jewellery_id: uuid.UUID, asset_type: str, mime_type: str) -> str:
    """Builds a fresh, collision-proof, path-traversal-proof object key. The filename
    component is always a freshly generated UUID — the client-supplied filename is
    never used verbatim anywhere in the key, which is what actually prevents path
    traversal (`../../etc/passwd`-style filenames) rather than trying to blocklist
    dangerous characters in a user-controlled string."""
    ext = sanitize_extension(extension_for_mime_type(mime_type))
    filename = f"{uuid.uuid4()}.{ext}"
    return f"jewellery/{jewellery_id}/{asset_type}/{filename}"
