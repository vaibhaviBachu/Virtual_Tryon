"""
Background-removal abstraction for the catalogue asset-processing pipeline.

IMPORTANT STATUS NOTE (see ai/models/LICENSES.md and docs/milestone-2-verification.md
for the full account): Milestone 0's research selected SAM2 for this admin-only asset
path. SAM2 itself is NOT integrated in this milestone — its model weights are hosted on
huggingface.co, and this build/runtime environment's network policy blocks that host
outright (verified directly, not assumed). Rather than fake SAM2 working, or leave
background removal unimplemented and unverifiable, this milestone ships a real, tested,
commercially-licensed alternative: rembg (MIT license) running the U-2-Net salient
object segmentation model (Apache 2.0 license, verified from the model's own repository
— see LICENSES.md). Both licenses were fetched and read directly, not assumed from
memory.

This is exposed behind the same kind of interface/registry pattern as `ai/engines/` so
swapping in SAM2 later (once weights are reachable, e.g. self-hosted or mirrored) is a
new class + a registry entry, not a rewrite of the processing pipeline.
"""
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict

logger = logging.getLogger("ai.catalogue.background_remover")


@dataclass
class BackgroundRemovalResult:
    success: bool
    rgba_png_bytes: bytes | None = None
    error_message: str | None = None


class BackgroundRemover(ABC):
    remover_name: str = "base"

    @abstractmethod
    def remove_background(self, image_bytes: bytes) -> BackgroundRemovalResult:
        """Takes an arbitrary-format image and returns an RGBA PNG with the background
        made transparent. Must never fabricate a plausible-looking output on failure —
        return success=False instead (see ai/engines/base.py's RenderResult for the same
        "honest failure" convention used by the try-on engines)."""
        raise NotImplementedError


class RembgBackgroundRemover(BackgroundRemover):
    """CPU-only, MIT-licensed background removal via the U-2-Net ONNX model."""

    remover_name = "rembg_u2net"

    def __init__(self) -> None:
        # Imported lazily so importing this module (e.g. from apps/api, which never
        # calls it) doesn't require onnxruntime/rembg to be installed there.
        from rembg import new_session

        self._session = new_session("u2net")

    def remove_background(self, image_bytes: bytes) -> BackgroundRemovalResult:
        from rembg import remove

        try:
            output = remove(image_bytes, session=self._session)
            return BackgroundRemovalResult(success=True, rgba_png_bytes=output)
        except Exception as exc:  # noqa: BLE001 — this boundary must never raise into the worker
            logger.exception("Background removal failed")
            return BackgroundRemovalResult(success=False, error_message=str(exc))


_registry: Dict[str, BackgroundRemover] = {}


def register_remover(name: str, remover: BackgroundRemover) -> None:
    _registry[name] = remover


def get_remover(name: str = "rembg_u2net") -> BackgroundRemover:
    if name not in _registry:
        if name == "rembg_u2net":
            _registry[name] = RembgBackgroundRemover()
        else:
            raise ValueError(f"No background remover registered under name {name!r}")
    return _registry[name]
