"""
Milestone 4 geometry evaluation harness (spec §32-34).

Run with:  python -m evaluation.run_geometry

Two independent tracks:

  1. SYNTHETIC DETERMINISTIC CASES (evaluation/data/geometry_synthetic_cases.py) — hand
     landmark/pose dataclasses with expected anchor/scale/rotation computed BY HAND from
     the documented formulas (see that module's docstring for the "no hard-coded
     results" honesty argument). Reports placement error (px + normalized), scale error
     (%), and rotation error (degrees) per case and in aggregate. This is where a
     regression in the geometry math would show up as nonzero error.

  2. REAL-IMAGE SELF-CONSISTENCY CHECK — runs the REAL FaceLandmarker/PoseLandmarker,
     ai.landmarks.readiness.evaluate_readiness, and GeometryTryOnEngine on every image
     under evaluation/users/ and evaluation/data/test_images/. For each (image,
     category) pair it checks whether the geometry engine's success/failure OUTCOME
     agrees with what the INDEPENDENTLY COMPUTED readiness flag says for that same
     photo (spec §21's readiness gate, re-derived from real landmarks, never a
     hand-typed "this image should succeed" table). This is the failure-rate metric
     (spec §33): the fraction of (image, category) pairs where the two independent
     computations agree.

Writes a full JSON report to evaluation/expected/geometry_evaluation_results.json
(mirroring evaluation/scripts/run_scenario_evaluation.py's Milestone 3 convention) and
prints a human-readable summary. No metric here is hand-typed into this script; every
number is produced by an actual run in this process.
"""
import json
import math
import os
import time

import numpy as np
from PIL import Image

from ai.engines.geometry.engine import GeometryTryOnEngine
from ai.geometry.anchors import compute_anchor
from ai.geometry.rotation import compute_rotation
from ai.geometry.schemas import JewelleryAssetGeometry, Point
from ai.geometry.scale import compute_scale
from ai.landmarks.face import FaceLandmarker
from ai.landmarks.pose import PoseLandmarker
from ai.landmarks.readiness import evaluate_readiness
from evaluation.data.geometry_synthetic_cases import build_cases
from workers.tasks.process_tryon_request import _serialize_face, _serialize_pose

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..")
USERS_DIR = os.path.join(REPO_ROOT, "evaluation", "users")
REAL_PHOTO_DIR = os.path.join(REPO_ROOT, "evaluation", "data", "test_images")
OUT_PATH = os.path.join(REPO_ROOT, "evaluation", "expected", "geometry_evaluation_results.json")


def _fake_asset_geometry(effective_width_px: float) -> JewelleryAssetGeometry:
    """A minimal synthetic asset geometry — the evaluation dataset only needs a known
    effective width to evaluate scale (see that module's docstring); anchor/bbox
    details don't affect the anchor/rotation/scale-factor numbers being evaluated."""
    return JewelleryAssetGeometry(
        width_px=int(effective_width_px), height_px=int(effective_width_px),
        alpha_bbox=(0, 0, int(effective_width_px), int(effective_width_px)),
        anchor_px=Point(effective_width_px / 2, 0), anchor_source="synthetic",
        attachment_point=None, mirrorable=False, physical_width_mm=None, physical_height_mm=None,
    )


def run_synthetic_track() -> dict:
    cases = build_cases()
    per_case = []
    placement_errors_px = []
    placement_errors_norm = []
    scale_errors_pct = []
    rotation_errors_deg = []
    failures_matched = 0
    failures_total = 0

    for case in cases:
        anchor = compute_anchor(case.category_slug, case.side, case.face, case.pose, case.image_width_px, case.image_height_px)

        if not case.expect_success:
            failures_total += 1
            matched = (not anchor.success) and (anchor.error_code == case.expected_error_code)
            failures_matched += int(matched)
            per_case.append({
                "name": case.name, "expect_success": False, "predicted_success": anchor.success,
                "expected_error_code": case.expected_error_code, "predicted_error_code": anchor.error_code,
                "matched": matched,
            })
            continue

        asset_geometry = _fake_asset_geometry(case.asset_effective_width_px)
        scale = compute_scale(case.category_slug, asset_geometry, anchor)
        rotation = compute_rotation(case.category_slug, case.face, case.pose, case.image_width_px, case.image_height_px)

        diagonal_px = math.hypot(case.image_width_px, case.image_height_px)
        placement_error_px = None
        placement_error_norm = None
        if anchor.success and case.expected_anchor_px is not None:
            placement_error_px = math.hypot(
                anchor.anchor_px.x - case.expected_anchor_px[0], anchor.anchor_px.y - case.expected_anchor_px[1]
            )
            placement_error_norm = placement_error_px / diagonal_px
            placement_errors_px.append(placement_error_px)
            placement_errors_norm.append(placement_error_norm)

        scale_error_pct = None
        if scale.success and case.expected_scale_factor:
            scale_error_pct = abs(scale.scale_factor - case.expected_scale_factor) / case.expected_scale_factor * 100.0
            scale_errors_pct.append(scale_error_pct)

        rotation_error_deg = None
        if rotation.success and case.expected_rotation_degrees is not None:
            rotation_error_deg = abs(rotation.rotation_degrees - case.expected_rotation_degrees)
            rotation_errors_deg.append(rotation_error_deg)

        per_case.append({
            "name": case.name, "category": case.category_slug,
            "predicted_anchor_px": [anchor.anchor_px.x, anchor.anchor_px.y] if anchor.success else None,
            "expected_anchor_px": list(case.expected_anchor_px) if case.expected_anchor_px else None,
            "placement_error_px": placement_error_px, "placement_error_normalized": placement_error_norm,
            "predicted_scale_factor": scale.scale_factor if scale.success else None,
            "expected_scale_factor": case.expected_scale_factor, "scale_error_pct": scale_error_pct,
            "predicted_rotation_degrees": rotation.rotation_degrees if rotation.success else None,
            "expected_rotation_degrees": case.expected_rotation_degrees, "rotation_error_deg": rotation_error_deg,
        })

    def _mean(values):
        return sum(values) / len(values) if values else None

    return {
        "num_cases": len(cases),
        "num_success_cases": len(cases) - failures_total,
        "num_failure_cases": failures_total,
        "failure_cases_matched_expected_code": failures_matched,
        "mean_placement_error_px": _mean(placement_errors_px),
        "max_placement_error_px": max(placement_errors_px) if placement_errors_px else None,
        "mean_placement_error_normalized": _mean(placement_errors_norm),
        "mean_scale_error_pct": _mean(scale_errors_pct),
        "max_scale_error_pct": max(scale_errors_pct) if scale_errors_pct else None,
        "mean_rotation_error_deg": _mean(rotation_errors_deg),
        "max_rotation_error_deg": max(rotation_errors_deg) if rotation_errors_deg else None,
        "per_case": per_case,
    }


def _load_rgb(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def _iter_real_images():
    for scenario in sorted(os.listdir(USERS_DIR)):
        scenario_dir = os.path.join(USERS_DIR, scenario)
        if not os.path.isdir(scenario_dir):
            continue
        files = [f for f in os.listdir(scenario_dir) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        if files:
            yield f"users/{scenario}", os.path.join(scenario_dir, files[0])
    for fname in sorted(os.listdir(REAL_PHOTO_DIR)):
        if fname.lower().endswith((".jpg", ".jpeg", ".png")):
            yield f"test_images/{fname}", os.path.join(REAL_PHOTO_DIR, fname)


def _tiny_earring_asset_png() -> bytes:
    import io

    arr = np.zeros((60, 60, 4), dtype=np.uint8)
    arr[20:40, 20:40, :3] = [200, 170, 60]
    arr[20:40, 20:40, 3] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def _tiny_necklace_asset_png() -> bytes:
    import io

    arr = np.zeros((40, 160, 4), dtype=np.uint8)
    arr[15:25, 10:150, :3] = [210, 210, 220]
    arr[15:25, 10:150, 3] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def run_real_image_track() -> dict:
    face_landmarker = FaceLandmarker()
    pose_landmarker = PoseLandmarker()
    engine = GeometryTryOnEngine()

    import io

    earring_asset = _tiny_earring_asset_png()
    necklace_asset = _tiny_necklace_asset_png()

    results = []
    agreements = 0
    total_pairs = 0
    total_processing_seconds = 0.0

    try:
        for label, path in _iter_real_images():
            image_rgb = _load_rgb(path)
            image_jpeg = io.BytesIO()
            Image.fromarray(image_rgb).save(image_jpeg, format="JPEG")
            image_bytes = image_jpeg.getvalue()

            face_result = face_landmarker.detect(image_rgb)
            pose_result = pose_landmarker.detect(image_rgb)
            readiness = evaluate_readiness(face_result, None, pose_result, None)

            entry = {"scenario": label, "face_detected": face_result.success, "pose_detected": pose_result.success}

            for category, expected_ready, asset_bytes in (
                ("earrings", readiness.ears_ready, earring_asset),
                ("necklace", readiness.neck_ready, necklace_asset),
            ):
                config = {
                    "category_slug": category,
                    "side": "both" if category == "earrings" else None,
                    "face_landmarks": _serialize_face(face_result) if face_result else None,
                    "pose_landmarks": _serialize_pose(pose_result) if pose_result else None,
                }
                t0 = time.monotonic()
                render_result = engine.render(image_bytes, asset_bytes, config)
                total_processing_seconds += time.monotonic() - t0

                agrees = render_result.success == expected_ready
                agreements += int(agrees)
                total_pairs += 1
                entry[category] = {
                    "readiness_ready": expected_ready,
                    "render_succeeded": render_result.success,
                    "render_error_code": render_result.error_code,
                    "agrees_with_readiness": agrees,
                }
            results.append(entry)
    finally:
        face_landmarker.close()
        pose_landmarker.close()

    return {
        "num_images": len(results),
        "num_category_pairs": total_pairs,
        "num_agreements": agreements,
        "agreement_rate": agreements / total_pairs if total_pairs else None,
        "failure_rate": 1.0 - (agreements / total_pairs) if total_pairs else None,
        "total_processing_seconds": round(total_processing_seconds, 4),
        "mean_processing_seconds_per_render": round(total_processing_seconds / total_pairs, 4) if total_pairs else None,
        "per_image": results,
    }


def main():
    print("=== Milestone 4 Geometry Evaluation ===\n")

    print("--- Track 1: synthetic deterministic cases ---")
    synthetic = run_synthetic_track()
    print(json.dumps({k: v for k, v in synthetic.items() if k != "per_case"}, indent=2, default=str))

    print("\n--- Track 2: real-image readiness/render self-consistency ---")
    real = run_real_image_track()
    print(json.dumps({k: v for k, v in real.items() if k != "per_image"}, indent=2, default=str))

    report = {"synthetic": synthetic, "real_image": real}
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    main()
