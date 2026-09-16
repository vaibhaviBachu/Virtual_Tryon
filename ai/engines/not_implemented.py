"""
Placeholder engine used only until a real engine is registered (Milestone 4 for
geometry, later for generative/hybrid). It deliberately never fabricates an image —
returning `success=False` is the honest behavior per docs/production-readiness.md's
"do not fake AI results" rule.
"""
from typing import Any, Dict

from ai.engines.base import RenderResult, TryOnEngine


class NotImplementedEngine(TryOnEngine):
    engine_name = "not_implemented"

    def render(
        self,
        user_image_bytes: bytes,
        jewellery_asset_bytes: bytes,
        placement_config: Dict[str, Any],
    ) -> RenderResult:
        return RenderResult(
            success=False,
            error_message=(
                "No try-on engine is implemented yet. The geometry engine ships in "
                "Milestone 4 per docs/roadmap.md."
            ),
        )
