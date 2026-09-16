"""
TryOnEngine abstraction — the single boundary between the worker/API layers and any
concrete jewellery placement implementation.

Nothing outside `ai/` may import a concrete model (MediaPipe, a diffusion checkpoint,
etc.) directly. The worker (see workers/) only ever calls `TryOnEngine.render(...)`
through this interface, selecting a concrete engine via the registry
(ai/engines/registry.py) so a new engine can be added without touching worker or API
code — this is the extensibility guarantee described in docs/architecture.md §7 and §10.

Milestone 1 provides this interface plus a NotImplementedEngine placeholder so the
worker's plumbing can be exercised end-to-end without pretending real AI inference
exists yet (see docs/roadmap.md — MediaPipe/geometry rendering is Milestone 4).
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class RenderResult:
    """Output of a try-on render attempt.

    `success=False` with an `error_message` is a first-class, expected outcome (e.g. no
    engine implemented yet, or a real engine failing to find required landmarks) — it is
    never represented by a fabricated image.
    """

    success: bool
    result_image_bytes: Optional[bytes] = None
    error_message: Optional[str] = None
    metrics: Dict[str, Any] = field(default_factory=dict)
    # Milestone 4 addition: a structured, machine-readable failure reason (e.g.
    # "EAR_NOT_VISIBLE") distinct from the safe human-readable `error_message` — see
    # ai/engines/geometry/engine.py. Optional with a default so NotImplementedEngine
    # and any future engine that never sets it remain valid, unmodified callers of this
    # dataclass; this is additive, not a breaking change to the TryOnEngine contract.
    error_code: Optional[str] = None
    # Milestone 4 addition: geometry placement metadata (anchors, scale, rotation,
    # transformed bounding box, assumptions) — see ai/geometry/schemas.py's
    # TryOnRenderResult, which is GeometryTryOnEngine's own richer internal contract.
    # This field is the boundary-crossing point: rather than replacing RenderResult
    # (which would force every engine and every caller to change), one additional
    # optional field carries the extra structure a geometry-based engine has that a
    # future generative engine likely will not need in the same shape. Always a plain,
    # JSON-serializable dict (no dataclasses/numpy arrays) so it can be persisted
    # directly onto TryOnRender.placement_metadata without further conversion.
    placement_metadata: Optional[Dict[str, Any]] = None


class TryOnEngine(ABC):
    """Base class every try-on engine implementation must extend."""

    #: Machine-readable identifier stored on tryon_requests.engine_used (Milestone 2+).
    engine_name: str = "base"

    @abstractmethod
    def render(
        self,
        user_image_bytes: bytes,
        jewellery_asset_bytes: bytes,
        placement_config: Dict[str, Any],
    ) -> RenderResult:
        """Produce a try-on result for one (user photo, jewellery asset) pair.

        Concrete engines are responsible for their own landmark detection, segmentation,
        and compositing internally (see ai/landmarks, ai/segmentation, ai/rendering) —
        this method signature intentionally does not leak those implementation details
        to callers.
        """
        raise NotImplementedError
