"""
Developer-only geometry debug tool (Milestone 4 spec: "add a developer-only
reproducible command... do not expose this publicly").

Run inside the WORKER container/image (it needs cv2/mediapipe, which only that image
has installed):

    python -m evaluation.debug_necklace --render-id <tryon_render_uuid>

against the REAL, already-created TryOnRender row for a real request in your running
database/storage. This re-runs the exact same GeometryTryOnEngine pipeline
workers/tasks/process_tryon_render.py used (same placement_config construction, same
`render_with_debug` call), against the SAME real user photo and the SAME real,
already-processed catalogue asset, and writes out everything needed to see whether the
jewellery was actually placed:

    <out-dir>/original_user_image.png
    <out-dir>/processed_asset.png                 (asset exactly as stored, RGBA)
    <out-dir>/processed_asset_on_checkerboard.png (same asset over a contrasting
                                                    checkerboard, so a faint/near-
                                                    invisible alpha mask is visible)
    <out-dir>/direct_geometry_result.png          (the composited result, produced
                                                    directly by this script — proves the
                                                    engine itself works independent of
                                                    the frontend/API/signed-URL layer)
    <out-dir>/debug_necklace_geometry.png         (ai.geometry.debug_viz overlay: face/
                                                    pose landmarks, computed anchor,
                                                    transformed jewellery bounding box)
    <out-dir>/debug_report.json                   (every metric below, machine-readable)

And prints a human-readable report covering (spec checklist items 2, 3, 5, 6, 7):
  - jewellery id, asset id, category, processing_status, storage keys
  - processed asset dimensions, alpha-channel presence, alpha bounding box, effective
    (non-transparent) width/height, non-transparent pixel count and % of the canvas
  - computed anchor/scale/rotation/transform values for this exact render
  - a real pixel-difference comparison between the original photo and the generated
    result: changed-pixel count, percentage, bounding box of the changed region, max
    per-channel difference — proving quantitatively whether anything was drawn, and if
    so, roughly where

--use-debug-asset swaps in a bundled, deliberately obvious, high-contrast synthetic
necklace asset (bright red arc on a fully transparent background, generated in-code —
never written into the customer catalogue) in place of the real catalogue asset, with
its default (non-metadata) anchor. This isolates whether a problem is in the
GeometryTryOnEngine/compositing pipeline itself (the debug asset would also fail to
appear) or specific to this catalogue asset's own processed image (the debug asset
would appear correctly while the real one does not) — spec checklist item 11.

Never logs user image contents, credentials, or signed URLs — only the metadata above.
"""
import argparse
import io
import json
import os
import sys
import uuid
from dataclasses import asdict

import numpy as np
from PIL import Image, ImageDraw

import ai.engines.geometry  # noqa: F401 - import side effect registers GeometryTryOnEngine
from ai.engines.registry import get_engine
from ai.geometry.asset_geometry import InvalidAssetError, compute_asset_geometry
from ai.geometry.body_reference import compute_body_reference_frame
from ai.geometry.debug_viz import render_framing_debug_overlay
from ai.geometry.framing import evaluate_necklace_framing
from ai.landmarks.schemas import ConfidenceLevel, NormalizedPoint, PoseLandmarkResult
from db.models import JewelleryAsset
from jobqueue.render_jobs import TryOnRenderJob
from workers.db import session_scope
from workers.storage import get_object_storage
from workers.tasks.process_tryon_render import _load_rows

# Pixel channels must differ by more than this to count as "changed" — filters out
# nothing here (the result PNG is freshly encoded from the same in-memory array as the
# original, never re-compressed), but keeps the comparison honest against any future
# lossy re-encode of either image.
CHANGED_PIXEL_THRESHOLD = 2


def _pose_from_stored_dict(pose_dict: dict) -> PoseLandmarkResult:
    """Reconstructs the same PoseLandmarkResult ai.geometry.framing needs from the raw
    dict workers/tasks/process_tryon_request.py's _serialize_pose() persisted on
    TryOnRequest.pose_landmarks — this is the exact stored data, not a re-run of pose
    detection, so the framing pre-check reported here matches what actually happened
    for this real request."""
    landmarks = [
        NormalizedPoint(x=p["x"], y=p["y"], z=p.get("z"), visibility=p.get("visibility"))
        for p in pose_dict.get("landmarks", [])
    ]
    neck_anchor_dict = pose_dict.get("neck_anchor")
    neck_anchor = NormalizedPoint(x=neck_anchor_dict["x"], y=neck_anchor_dict["y"]) if neck_anchor_dict else None
    return PoseLandmarkResult(
        success=pose_dict.get("success", False),
        error_message=pose_dict.get("error_message"),
        image_width_px=pose_dict.get("image_width_px", 0),
        image_height_px=pose_dict.get("image_height_px", 0),
        landmarks=landmarks,
        shoulder_confidence=pose_dict.get("shoulder_confidence", 0.0),
        confidence_level=ConfidenceLevel(pose_dict.get("confidence_level", "none")),
        neck_anchor=neck_anchor,
        body_orientation=pose_dict.get("body_orientation"),
        method=pose_dict.get("method", "mediapipe_pose_0.10.9"),
    )


def _alpha_report(asset_rgba: np.ndarray) -> dict:
    height, width = asset_rgba.shape[0], asset_rgba.shape[1]
    alpha = asset_rgba[:, :, 3]
    nonzero = alpha > 0
    nonzero_rows = nonzero.any(axis=1)
    nonzero_cols = nonzero.any(axis=0)
    if not nonzero_rows.any() or not nonzero_cols.any():
        return {
            "width_px": width,
            "height_px": height,
            "has_alpha_channel": True,
            "non_transparent_pixel_count": 0,
            "non_transparent_pixel_percent": 0.0,
            "alpha_bbox": None,
            "alpha_bbox_width_px": 0,
            "alpha_bbox_height_px": 0,
            "alpha_bbox_percent_of_canvas": 0.0,
        }
    top, bottom = np.where(nonzero_rows)[0][[0, -1]]
    left, right = np.where(nonzero_cols)[0][[0, -1]]
    bbox_w, bbox_h = int(right) + 1 - int(left), int(bottom) + 1 - int(top)
    return {
        "width_px": width,
        "height_px": height,
        "has_alpha_channel": True,
        "non_transparent_pixel_count": int(nonzero.sum()),
        "non_transparent_pixel_percent": round(100.0 * nonzero.sum() / (width * height), 4),
        "alpha_bbox": [int(left), int(top), int(right) + 1, int(bottom) + 1],
        "alpha_bbox_width_px": bbox_w,
        "alpha_bbox_height_px": bbox_h,
        "alpha_bbox_percent_of_canvas": round(100.0 * (bbox_w * bbox_h) / (width * height), 4),
    }


def _pixel_diff_report(original_rgb: np.ndarray, result_rgb: np.ndarray) -> dict:
    if original_rgb.shape != result_rgb.shape:
        return {
            "dimensions_match": False,
            "original_shape": list(original_rgb.shape),
            "result_shape": list(result_rgb.shape),
        }
    diff = np.abs(original_rgb.astype(np.int16) - result_rgb.astype(np.int16)).max(axis=2)
    changed = diff > CHANGED_PIXEL_THRESHOLD
    changed_count = int(changed.sum())
    total = diff.size
    report = {
        "dimensions_match": True,
        "original_dimensions_px": [original_rgb.shape[1], original_rgb.shape[0]],
        "result_dimensions_px": [result_rgb.shape[1], result_rgb.shape[0]],
        "changed_pixel_count": changed_count,
        "changed_pixel_percent": round(100.0 * changed_count / total, 6),
        "max_pixel_difference": int(diff.max()),
        "changed_pixel_bounding_box": None,
    }
    if changed_count > 0:
        ys, xs = np.where(changed)
        report["changed_pixel_bounding_box"] = [
            int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1,
        ]
    return report


def _checkerboard_composite(asset_rgba: np.ndarray, tile: int = 10) -> Image.Image:
    """Composites the asset over a high-contrast checkerboard so a faint/near-invisible
    (but technically nonzero) alpha mask is still visually obvious in the saved PNG,
    per spec checklist item 3's 'generate a debug copy with a contrasting background'."""
    height, width = asset_rgba.shape[0], asset_rgba.shape[1]
    board = np.zeros((height, width, 3), dtype=np.uint8)
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            if ((x // tile) + (y // tile)) % 2 == 0:
                board[y : y + tile, x : x + tile] = (255, 0, 255)  # magenta
            else:
                board[y : y + tile, x : x + tile] = (0, 255, 255)  # cyan
    alpha = (asset_rgba[:, :, 3:4].astype(np.float64)) / 255.0
    rgb = asset_rgba[:, :, :3].astype(np.float64)
    composed = rgb * alpha + board.astype(np.float64) * (1.0 - alpha)
    return Image.fromarray(np.clip(composed, 0, 255).astype(np.uint8), mode="RGB")


def _build_debug_asset_bytes() -> bytes:
    """A deliberately obvious, high-contrast, non-rectangular synthetic necklace —
    bright solid red, fully opaque where drawn, fully transparent everywhere else,
    occupying a large, known fraction of its own canvas. Used only for isolating
    pipeline bugs from catalogue-asset bugs (spec checklist item 11) — never written to
    the customer catalogue."""
    size = 300
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # A thick arc (chain) plus a filled circle (pendant) — an unambiguous, clearly
    # non-rectangular visible shape covering a large, known portion of the canvas.
    draw.arc([40, 20, 260, 220], start=20, end=160, fill=(220, 0, 0, 255), width=18)
    draw.ellipse([120, 190, 180, 250], fill=(220, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--render-id", required=True, help="TryOnRender.id (UUID) to re-run and inspect.")
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Directory to write debug images/report to (default: /tmp/tryon_debug/<render-id>/).",
    )
    parser.add_argument(
        "--use-debug-asset",
        action="store_true",
        help="Replace the real catalogue asset with a bundled, obvious synthetic test "
        "necklace (spec checklist item 11) to isolate pipeline bugs from catalogue-asset bugs.",
    )
    args = parser.parse_args()

    render_id = args.render_id
    out_dir = args.out_dir or os.path.join("/tmp/tryon_debug", render_id)
    os.makedirs(out_dir, exist_ok=True)

    fake_job = TryOnRenderJob(job_id="debug-cli", render_id=render_id, request_id="", enqueued_at=0)
    storage = get_object_storage()

    with session_scope() as db:
        render, request, jewellery, asset, user_image = _load_rows(db, fake_job)

        identity_report = {
            "render_id": str(render.id),
            "render_status": render.status.value if hasattr(render.status, "value") else str(render.status),
            "jewellery_id": str(jewellery.id),
            "jewellery_name": jewellery.name,
            "category_slug": jewellery.category.slug if jewellery.category else None,
            "physical_width_mm": float(jewellery.physical_width_mm) if jewellery.physical_width_mm else None,
            "physical_height_mm": float(jewellery.physical_height_mm) if jewellery.physical_height_mm else None,
            "asset_id": str(asset.id) if asset else None,
            "asset_processing_status": (
                asset.processing_status.value if asset and hasattr(asset.processing_status, "value") else None
            ),
            "asset_storage_key": asset.storage_key if asset else None,
            "asset_anchor_x": asset.anchor_x if asset else None,
            "asset_anchor_y": asset.anchor_y if asset else None,
            "asset_attachment_point": asset.attachment_point if asset else None,
            "asset_mirrorable": asset.mirrorable if asset else None,
        }
        print("=== Jewellery / asset identity ===")
        print(json.dumps(identity_report, indent=2))

        framing_report = None
        if identity_report["category_slug"] == "necklace" and request.pose_landmarks:
            pose_for_framing = _pose_from_stored_dict(request.pose_landmarks)
            framing_result = evaluate_necklace_framing(
                pose_for_framing,
                request.pose_landmarks.get("image_width_px", 0),
                request.pose_landmarks.get("image_height_px", 0),
            )
            framing_report = framing_result.as_dict()
            print("\n=== Pre-selection necklace framing pre-check (spec §3, §4) ===")
            print(json.dumps(framing_report, indent=2))
            print(
                "This is the SAME early check now run right after photo analysis, "
                "before any item is selected — it reasons only about the photo's own "
                "geometry, not a specific asset. It is advisory: the per-asset "
                "render-time JEWELLERY_OUT_OF_FRAME check below is still authoritative."
            )

        user_image_bytes = storage.download(user_image.storage_key)
        real_asset_bytes = storage.download(asset.storage_key) if asset else None

        original_rgb_img = Image.open(io.BytesIO(user_image_bytes)).convert("RGB")
        original_rgb_img.save(os.path.join(out_dir, "original_user_image.png"))

        if framing_report is not None:
            framing_overlay = render_framing_debug_overlay(np.asarray(original_rgb_img), framing_result)
            Image.fromarray(framing_overlay, mode="RGB").save(
                os.path.join(out_dir, "debug_necklace_framing_precheck.png")
            )

        alpha_report = None
        if real_asset_bytes is not None:
            real_asset_rgba = np.asarray(Image.open(io.BytesIO(real_asset_bytes)).convert("RGBA"))
            Image.fromarray(real_asset_rgba, mode="RGBA").save(os.path.join(out_dir, "processed_asset.png"))
            _checkerboard_composite(real_asset_rgba).save(
                os.path.join(out_dir, "processed_asset_on_checkerboard.png")
            )
            alpha_report = _alpha_report(real_asset_rgba)
            print("\n=== Processed catalogue asset: alpha-channel verification ===")
            print(json.dumps(alpha_report, indent=2))
            print(
                "See processed_asset_on_checkerboard.png: if the necklace is visible there "
                "but not in direct_geometry_result.png below, the asset itself is fine and "
                "the bug is in anchor/scale/rotation/compositing math. If it is NOT clearly "
                "visible there either, the catalogue asset's background removal produced a "
                "faint/incomplete mask (spec checklist item 3)."
            )

        if args.use_debug_asset:
            asset_bytes = _build_debug_asset_bytes()
            asset_anchor_x = asset_anchor_y = None  # use the default bbox-top-center anchor
            attachment_point = "debug_synthetic_asset"
            mirrorable = False
            print(
                "\n*** --use-debug-asset: using a bundled synthetic test necklace instead of "
                f"the real catalogue asset (asset {identity_report['asset_id']}). ***"
            )
        else:
            if real_asset_bytes is None:
                print("\nNo processed asset available for this render — cannot proceed.")
                return 1
            asset_bytes = real_asset_bytes
            asset_anchor_x = asset.anchor_x
            asset_anchor_y = asset.anchor_y
            attachment_point = asset.attachment_point
            mirrorable = asset.mirrorable

        placement_config = {
            "category_slug": identity_report["category_slug"],
            "side": "both" if identity_report["category_slug"] == "earrings" else None,
            "face_landmarks": request.face_landmarks,
            "pose_landmarks": request.pose_landmarks,
            "asset_anchor_x": asset_anchor_x,
            "asset_anchor_y": asset_anchor_y,
            "attachment_point": attachment_point,
            "mirrorable": mirrorable,
            "physical_width_mm": identity_report["physical_width_mm"],
            "physical_height_mm": identity_report["physical_height_mm"],
            "readiness": request.readiness,
            "debug": True,
        }

        engine = get_engine("geometry")
        try:
            geometry_result = engine.render_with_debug(user_image_bytes, asset_bytes, placement_config)
        except InvalidAssetError as exc:
            print(f"\nInvalidAssetError: {exc}")
            return 1

        result = engine.adapt_result(geometry_result)

    body_frame_for_report = None
    if identity_report["category_slug"] == "necklace" and request.pose_landmarks:
        body_frame_for_report = compute_body_reference_frame(
            pose_for_framing, request.pose_landmarks.get("image_width_px", 0), request.pose_landmarks.get("image_height_px", 0)
        )

    print("\n=== Geometry computation (this exact render) ===")
    for i, placement in enumerate(geometry_result.placements):
        # Calibration diagnostics (spec "NECKLACE GEOMETRY CALIBRATION" §1, §6, §10):
        # make the vertical gap the collarbone offset introduces, and how far the
        # necklace's own visible content extends below the anchor, explicit numbers —
        # not something to eyeball from the rendered image alone.
        anchor_offset_from_shoulder_line_px = None
        if body_frame_for_report is not None and placement.anchor.anchor_px is not None:
            anchor_offset_from_shoulder_line_px = (
                placement.anchor.anchor_px.y - body_frame_for_report.shoulder_midpoint_px.y
            )
        necklace_visible_drop_below_anchor_px = None
        if placement.transform is not None and placement.anchor.anchor_px is not None:
            _, _, _, transformed_bottom = placement.transform.transformed_bbox_px
            necklace_visible_drop_below_anchor_px = transformed_bottom - placement.anchor.anchor_px.y

        entry = {
            "side": placement.side,
            "anchor_success": placement.anchor.success,
            "anchor_error_code": placement.anchor.error_code,
            "anchor_px": asdict(placement.anchor.anchor_px) if placement.anchor.anchor_px else None,
            "reference_measurement_px": placement.anchor.reference_measurement_px,
            "anchor_method": placement.anchor.method,
            "shoulder_midpoint_px": (
                asdict(body_frame_for_report.shoulder_midpoint_px) if body_frame_for_report else None
            ),
            "anchor_offset_from_shoulder_line_px": anchor_offset_from_shoulder_line_px,
            "scale_success": placement.scale.success,
            "scale_factor": placement.scale.scale_factor,
            "target_width_px": placement.scale.target_width_px,
            "used_physical_dimensions": placement.scale.used_physical_dimensions,
            "scale_assumptions": placement.scale.assumptions,
            "rotation_degrees": placement.rotation.rotation_degrees,
            "rotation_method": placement.rotation.method,
            "transform_matrix": placement.transform.matrix if placement.transform else None,
            "transformed_bbox_px": (
                list(placement.transform.transformed_bbox_px) if placement.transform else None
            ),
            "necklace_visible_drop_below_anchor_px": necklace_visible_drop_below_anchor_px,
        }
        print(f"--- placement[{i}] ---")
        print(json.dumps(entry, indent=2))
        if anchor_offset_from_shoulder_line_px is not None:
            print(
                f"    -> BODY_ANCHOR sits {anchor_offset_from_shoulder_line_px:.1f}px below the raw "
                f"shoulder line (this IS the collarbone-offset calibration; compare against where "
                "the collarbone actually appears in debug_necklace_geometry.png)."
            )
        if necklace_visible_drop_below_anchor_px is not None:
            print(
                f"    -> The necklace's own visible (alpha) content extends "
                f"{necklace_visible_drop_below_anchor_px:.1f}px BELOW the anchor point after scaling "
                "— this is the asset's own drawn chain/pendant length, not the anchor offset itself. "
                "A necklace that 'looks too low' can be caused by either number (or both) — this "
                "report separates them so the real cause isn't guessed at."
            )

    if not result.success:
        print(f"\nRENDER FAILED: error_code={result.error_code} message={result.error_message}")
        report = {"identity": identity_report, "alpha": alpha_report, "framing_precheck": framing_report,
                   "render_success": False,
                   "error_code": result.error_code, "error_message": result.error_message}
        with open(os.path.join(out_dir, "debug_report.json"), "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nFull report written to {out_dir}/debug_report.json")
        return 1

    result_img = Image.open(io.BytesIO(result.result_image_bytes)).convert("RGB")
    result_img.save(os.path.join(out_dir, "direct_geometry_result.png"))

    if geometry_result.debug_image_rgb is not None:
        Image.fromarray(geometry_result.debug_image_rgb, mode="RGB").save(
            os.path.join(out_dir, "debug_necklace_geometry.png")
        )

    original_rgb = np.asarray(original_rgb_img)
    result_rgb = np.asarray(result_img)
    diff_report = _pixel_diff_report(original_rgb, result_rgb)

    print("\n=== Pixel-difference verification (original vs. generated result) ===")
    print(json.dumps(diff_report, indent=2))
    if diff_report.get("changed_pixel_count", 0) == 0:
        print(
            "\n*** RESULT IS PIXEL-IDENTICAL TO THE ORIGINAL. The jewellery was NOT "
            "composited into the output. See the geometry computation above and the "
            "alpha-channel verification for why (common causes: asset has no/near-zero "
            "visible alpha content; anchor/scale computed as unusable; a placement was "
            "skipped due to a failed anchor/scale). ***"
        )
    else:
        print(
            f"\n{diff_report['changed_pixel_count']} pixels changed "
            f"({diff_report['changed_pixel_percent']}% of the image) — the engine did "
            "composite new content. Compare the changed_pixel_bounding_box above against "
            "the expected neck/upper-chest region, and inspect direct_geometry_result.png "
            "and debug_necklace_geometry.png directly to confirm it looks correct."
        )

    report = {
        "identity": identity_report,
        "alpha": alpha_report,
        "framing_precheck": framing_report,
        "render_success": True,
        "placements": [
            {
                "side": p.side,
                "anchor": {
                    "success": p.anchor.success,
                    "anchor_px": asdict(p.anchor.anchor_px) if p.anchor.anchor_px else None,
                    "reference_measurement_px": p.anchor.reference_measurement_px,
                    "method": p.anchor.method,
                },
                "scale": {
                    "success": p.scale.success,
                    "scale_factor": p.scale.scale_factor,
                    "target_width_px": p.scale.target_width_px,
                    "used_physical_dimensions": p.scale.used_physical_dimensions,
                    "assumptions": p.scale.assumptions,
                },
                "rotation_degrees": p.rotation.rotation_degrees,
                "transformed_bbox_px": list(p.transform.transformed_bbox_px) if p.transform else None,
            }
            for p in geometry_result.placements
        ],
        "pixel_diff": diff_report,
        "out_dir": out_dir,
    }
    with open(os.path.join(out_dir, "debug_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nFull report and images written to {out_dir}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
