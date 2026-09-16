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
