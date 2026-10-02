"""Content-hash helper for duplicate-upload detection (AI Jewellery Assistant spec:
"generate a content hash for the original upload ... check whether the same source
image already exists"). Hashes the RAW uploaded bytes, before any processing -- two
uploads of the exact same file hash identically regardless of what the AI pipeline does
to them afterward."""
import hashlib


def sha256_hex(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()
