"""
GeometryTryOnEngine — Milestone 4's first real TryOnEngine implementation (spec §1-4).

Conforms exactly to the existing `TryOnEngine` abstraction (ai/engines/base.py):
`render(user_image_bytes, jewellery_asset_bytes, placement_config) -> RenderResult`.
Internally it builds a clean `ai.geometry.schemas.TryOnInput`, runs the independently
testable compute_anchor/compute_scale/compute_rotation/compute_transform/
apply_transform/alpha_composite pipeline (ai/geometry/*), and adapts the richer
`TryOnRenderResult` back into the shared `RenderResult` contract at the boundary — see
ai/engines/base.py's docstring on the two new optional fields this required.

No generative AI, no diffusion, no image regeneration anywhere in this file (spec §2):
every pixel that ends up in the output is either an unmodified user-photo pixel or a
geometrically transformed jewellery-asset pixel, alpha-composited on top.
"""
import io
import logging
import time
from dataclasses import asdict, replace as dataclass_replace
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image

from ai.engines.base import RenderResult, TryOnEngine
from ai.geometry.anchors import compute_anchor
from ai.geometry.asset_geometry import InvalidAssetError, compute_asset_geometry
from ai.geometry.compositing import alpha_composite
from ai.geometry.constants import MIN_JEWELLERY_VISIBLE_OVERLAP_FRACTION
from ai.geometry.debug_viz import render_debug_overlay
from ai.geometry.deserialize import face_from_dict, pose_from_dict
from ai.geometry.rotation import compute_rotation
from ai.geometry.scale import compute_scale
from ai.geometry.schemas import PlacementRecord, TryOnInput, TryOnRenderResult
from ai.geometry.transform import apply_transform, bbox_overlap_fraction, compute_transform, mirror_asset_geometry

logger = logging.getLogger("ai.engines.geometry")

SUPPORTED_CATEGORIES = {"earrings", "necklace"}
_EARRING_SIDES = ("left", "right")


class GeometryTryOnEngine(TryOnEngine):
    engine_name = "geometry"

    def render(
        self,
        user_image_bytes: bytes,
        jewellery_asset_bytes: bytes,
        placement_config: Dict[str, Any],
    ) -> RenderResult:
        t0 = time.monotonic()
        try:
            geometry_result = self._render_geometry(user_image_bytes, jewellery_asset_bytes, placement_config)
        except InvalidAssetError as exc:
            return RenderResult(
                success=False,
                error_code="ASSET_INVALID",
                error_message=str(exc),
                metrics={"total_seconds": round(time.monotonic() - t0, 4)},
            )
        except Exception:
            logger.exception("GeometryTryOnEngine.render raised unexpectedly")
            return RenderResult(
                success=False,
                error_code="RENDER_EXCEPTION",
                error_message="Rendering failed unexpectedly.",
                metrics={"total_seconds": round(time.monotonic() - t0, 4)},
            )

        geometry_result.metrics["total_seconds"] = round(time.monotonic() - t0, 4)
        return self.adapt_result(geometry_result)

    def adapt_result(self, geometry_result: TryOnRenderResult) -> RenderResult:
        """Adapts the richer internal `TryOnRenderResult` into the shared
        `ai.engines.base.RenderResult` contract. Public (not `_`-prefixed) because
        workers/tasks/process_tryon_render.py calls `render_with_debug()` directly (to
        obtain the debug visualization array alongside the normal result in a single
        geometry computation, spec §27) and needs this same adaptation afterward."""
        if not geometry_result.success:
            return RenderResult(
                success=False,
                error_code=geometry_result.error_code,
                error_message=geometry_result.error_message,
                metrics=geometry_result.metrics,
                placement_metadata={"placements": serialize_placements(geometry_result.placements)}
                if geometry_result.placements
                else None,
            )

        result_png = encode_rgb_png(geometry_result.result_image_rgba[:, :, :3])
        placement_metadata: Dict[str, Any] = {
            "category_slug": geometry_result.category_slug,
            "placements": serialize_placements(geometry_result.placements),
        }

        return RenderResult(
            success=True,
            result_image_bytes=result_png,
            metrics=geometry_result.metrics,
            placement_metadata=placement_metadata,
        )

    def render_with_debug(
        self, user_image_bytes: bytes, jewellery_asset_bytes: bytes, placement_config: Dict[str, Any]
    ) -> TryOnRenderResult:
        """Worker-only entry point (spec §27's debug mode) that returns the full,
        un-adapted TryOnRenderResult (including the debug visualization array), so the
        caller can store the debug PNG separately without inflating every normal
        customer render's payload. `placement_config["debug"]` is forced True."""
        config = dict(placement_config)
        config["debug"] = True
        return self._render_geometry(user_image_bytes, jewellery_asset_bytes, config)

    def _render_geometry(
        self, user_image_bytes: bytes, jewellery_asset_bytes: bytes, placement_config: Dict[str, Any]
    ) -> TryOnRenderResult:
        category_slug = placement_config.get("category_slug")
        if category_slug not in SUPPORTED_CATEGORIES:
            return TryOnRenderResult(
                success=False,
                category_slug=category_slug or "",
                error_code="UNSUPPORTED_CATEGORY",
                error_message=f"GeometryTryOnEngine (Milestone 4) does not support category {category_slug!r}.",
            )

        user_image_rgb = np.asarray(Image.open(io.BytesIO(user_image_bytes)).convert("RGB"))
        jewellery_asset_rgba = np.asarray(Image.open(io.BytesIO(jewellery_asset_bytes)).convert("RGBA"))
        image_height_px, image_width_px = user_image_rgb.shape[0], user_image_rgb.shape[1]

        face = face_from_dict(placement_config.get("face_landmarks"))
        pose = pose_from_dict(placement_config.get("pose_landmarks"))

        tryon_input = TryOnInput(
            user_image_rgb=user_image_rgb,
            jewellery_asset_rgba=jewellery_asset_rgba,
            category_slug=category_slug,
            side=placement_config.get("side"),
            asset_anchor_x=placement_config.get("asset_anchor_x"),
            asset_anchor_y=placement_config.get("asset_anchor_y"),
            attachment_point=placement_config.get("attachment_point"),
            mirrorable=bool(placement_config.get("mirrorable", False)),
            physical_width_mm=placement_config.get("physical_width_mm"),
            physical_height_mm=placement_config.get("physical_height_mm"),
            face=face,
            pose=pose,
            image_width_px=image_width_px,
            image_height_px=image_height_px,
            readiness=placement_config.get("readiness"),
            debug=bool(placement_config.get("debug", False)),
        )

        base_asset_geometry = compute_asset_geometry(
            tryon_input.jewellery_asset_rgba,
            anchor_x=tryon_input.asset_anchor_x,
            anchor_y=tryon_input.asset_anchor_y,
            attachment_point=tryon_input.attachment_point,
            mirrorable=tryon_input.mirrorable,
            physical_width_mm=tryon_input.physical_width_mm,
            physical_height_mm=tryon_input.physical_height_mm,
        )

        sides = _EARRING_SIDES if category_slug == "earrings" and tryon_input.side in (None, "both") else (
            (tryon_input.side,) if category_slug == "earrings" else (None,)
        )

        placements: List[PlacementRecord] = []
        canvas_rgb = user_image_rgb.copy()

        for side in sides:
            t_anchor = time.monotonic()
            anchor = compute_anchor(category_slug, side, face, pose, image_width_px, image_height_px)
            anchor_seconds = time.monotonic() - t_anchor

            if not anchor.success:
                placements.append(PlacementRecord(side=side, anchor=anchor, scale=_null_scale(), rotation=_null_rotation(), transform=None))
                continue

            mirror_needed = category_slug == "earrings" and side == "left" and base_asset_geometry.mirrorable
            if mirror_needed:
                asset_rgba_for_side, asset_geometry_for_side = mirror_asset_geometry(
                    tryon_input.jewellery_asset_rgba, base_asset_geometry
                )
            else:
                asset_rgba_for_side, asset_geometry_for_side = tryon_input.jewellery_asset_rgba, base_asset_geometry

            t_scale = time.monotonic()
            scale = compute_scale(category_slug, asset_geometry_for_side, anchor)
            scale_seconds = time.monotonic() - t_scale

            t_rotation = time.monotonic()
            rotation = compute_rotation(category_slug, face, pose, image_width_px, image_height_px)
            rotation_seconds = time.monotonic() - t_rotation

            if not scale.success:
                placements.append(
                    PlacementRecord(
                        side=side,
                        anchor=anchor,
                        scale=scale,
                        rotation=rotation,
                        transform=None,
                    )
                )
                continue

            t_transform = time.monotonic()
            transform = compute_transform(asset_geometry_for_side, anchor, scale, rotation, mirrored=mirror_needed)

            # Real bug found on a live deployment: an anchor derived from real
            # landmarks can legitimately fall very close to a photo's edge (e.g. a
            # webcam photo framed close on the shoulders), and the documented
            # collarbone/earlobe vertical offset (ai/geometry/constants.py) can then
            # push the transformed jewellery almost or entirely off-canvas.
            # apply_transform/alpha_composite below would still "succeed" in that case
            # — cv2.warpAffine just produces a fully-transparent result outside its
            # output canvas — silently producing a render that reports success but is
            # pixel-identical to the input. Catch that here instead of after the fact.
            overlap_fraction = bbox_overlap_fraction(
                transform.transformed_bbox_px, image_width_px, image_height_px
            )
            if overlap_fraction < MIN_JEWELLERY_VISIBLE_OVERLAP_FRACTION:
                out_of_frame_anchor = dataclass_replace(
                    anchor,
                    success=False,
                    error_code="JEWELLERY_OUT_OF_FRAME",
                    error_message=(
                        "The computed position for this jewellery falls outside your "
                        "photo. Please retake the photo with your neck and shoulders "
                        "fully visible, not cropped close to the edge of the frame."
                    ),
                )
                placements.append(
                    PlacementRecord(side=side, anchor=out_of_frame_anchor, scale=scale, rotation=rotation, transform=None)
                )
                logger.info(
                    "Placement skipped: transformed jewellery bounding box has "
                    "insufficient overlap with the photo canvas",
                    extra={
                        "extra_fields": {
                            "category": category_slug,
                            "side": side,
                            "overlap_fraction": round(overlap_fraction, 4),
                            "transformed_bbox_px": list(transform.transformed_bbox_px),
                            "image_width_px": image_width_px,
                            "image_height_px": image_height_px,
                        }
                    },
                )
                continue

            warped = apply_transform(asset_rgba_for_side, transform, image_width_px, image_height_px)
            canvas_rgb = alpha_composite(canvas_rgb, warped)
            transform_seconds = time.monotonic() - t_transform

            placements.append(PlacementRecord(side=side, anchor=anchor, scale=scale, rotation=rotation, transform=transform))
            logger.debug(
                "Placed jewellery",
                extra={
                    "extra_fields": {
                        "category": category_slug,
                        "side": side,
                        "anchor_seconds": round(anchor_seconds, 4),
                        "scale_seconds": round(scale_seconds, 4),
                        "rotation_seconds": round(rotation_seconds, 4),
                        "transform_seconds": round(transform_seconds, 4),
                    }
                },
            )

        successful = [p for p in placements if p.transform is not None]
        if not successful:
            first_failure = placements[0] if placements else None
            error_code = first_failure.anchor.error_code if first_failure else "RENDER_EXCEPTION"
            error_message = (
                first_failure.anchor.error_message if first_failure else "No placement could be computed."
            )
            return TryOnRenderResult(
                success=False,
                category_slug=category_slug,
                placements=placements,
                error_code=error_code,
                error_message=error_message,
                metrics={},
            )

        result_rgba = np.dstack([canvas_rgb, np.full(canvas_rgb.shape[:2], 255, dtype=np.uint8)])

        debug_image = None
        if tryon_input.debug:
            debug_image = render_debug_overlay(user_image_rgb, placements)

        return TryOnRenderResult(
            success=True,
            result_image_rgba=result_rgba,
            debug_image_rgb=debug_image,
            category_slug=category_slug,
            placements=placements,
            metrics={},
        )


def _null_scale():
    from ai.geometry.schemas import ScaleResult

    return ScaleResult(success=False, method="not_attempted_anchor_failed")


def _null_rotation():
    from ai.geometry.schemas import RotationResult

    return RotationResult(success=False, method="not_attempted_anchor_failed")


def encode_rgb_png(rgb_array: np.ndarray) -> bytes:
    image = Image.fromarray(rgb_array, mode="RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False)
    return buffer.getvalue()


def serialize_placements(placements: List[PlacementRecord]) -> List[Dict[str, Any]]:
    serialized = []
    for placement in placements:
        entry: Dict[str, Any] = {
            "side": placement.side,
            "anchor": {
                "success": placement.anchor.success,
                "anchor_px": asdict(placement.anchor.anchor_px) if placement.anchor.anchor_px else None,
                "reference_measurement_px": placement.anchor.reference_measurement_px,
                "method": placement.anchor.method,
                "error_code": placement.anchor.error_code,
                "error_message": placement.anchor.error_message,
            },
            "scale": {
                "success": placement.scale.success,
                "scale_factor": placement.scale.scale_factor,
                "target_width_px": placement.scale.target_width_px,
                "used_physical_dimensions": placement.scale.used_physical_dimensions,
                "assumptions": placement.scale.assumptions,
                "method": placement.scale.method,
            },
            "rotation": {
                "success": placement.rotation.success,
                "rotation_degrees": placement.rotation.rotation_degrees,
                "method": placement.rotation.method,
                "confidence": placement.rotation.confidence,
                "assumptions": placement.rotation.assumptions,
            },
            "transform": (
                {
                    "matrix": placement.transform.matrix,
                    "scale_factor": placement.transform.scale_factor,
                    "rotation_degrees": placement.transform.rotation_degrees,
                    "anchor_px": asdict(placement.transform.anchor_px),
                    "transformed_bbox_px": list(placement.transform.transformed_bbox_px),
                    "mirrored": placement.transform.mirrored,
                }
                if placement.transform is not None
                else None
            ),
        }
        serialized.append(entry)
    return serialized
