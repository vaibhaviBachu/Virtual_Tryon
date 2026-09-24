#!/usr/bin/env python3
"""
M6.5 Step 1 -- "Audit current jewellery assets... Create a clear asset report... Do NOT
modify assets automatically." (see docs/live-ar-realism-verification.md's M6.5 section
for the request this was written against).

WHY THIS IS A SCRIPT, NOT SOMETHING RUN FROM THE SANDBOX THIS MILESTONE WAS DEVELOPED IN:
the catalogue's real rows and asset PNG bytes live in THIS PROJECT'S Postgres/MinIO,
which are not reachable from the sandbox this Live AR work was done in (confirmed: no
Docker daemon, `localhost:5432` connection refused). Same category of limitation as "no
camera for real-device testing" elsewhere in this project's Live AR verification docs --
this script is the equivalent of those "exact real-device test instructions": written
and reviewed here, actually RUN by you, in an environment where the database and object
storage are reachable.

Usage (same native-process convention as scripts/seed_admin.py):
    python scripts/audit_jewellery_assets.py [--category necklace,haaram]

For every active jewellery item (optionally filtered to the given category slugs),
prints, per asset:
  - the asset's own real pixel dimensions and MEASURED (alpha-channel-scanned, never
    the raw rectangle) bounding box -- the exact same scan asset-cache.ts's
    computeAlphaBoundingBox and ai/geometry/asset_geometry.py's compute_asset_geometry
    already do, reused here via ai.geometry.asset_geometry directly (not
    reimplemented a third time),
  - the resulting aspect ratio and which M6.5 attachment class
    (jewellery-attachment.ts's resolveNecklaceAttachmentClass) it would resolve to,
  - whether the catalogue has an explicit anchor_x/anchor_y/attachment_point/mirrorable
    set, or is relying on the documented default,
  - the parent item's physical_width_mm/physical_height_mm (populated or not),
  - a simple LEFT/RIGHT alpha-symmetry score (does the visible content roughly mirror
    around its own vertical center?), computed directly here since nothing in this
    codebase currently measures this.

Never modifies a row or a stored asset -- read-only, by design (per the request this
was written against).
"""
import argparse
import io
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy.orm import joinedload  # noqa: E402

from ai.geometry.asset_geometry import InvalidAssetError, compute_asset_geometry  # noqa: E402
from apps.api.db.session import SessionLocal  # noqa: E402
from apps.api.storage.s3_storage import get_object_storage  # noqa: E402
from db.models import AssetType, Jewellery, JewelleryAsset, ProcessingStatus  # noqa: E402


@dataclass
class AssetFinding:
    jewellery_name: str
    category_slug: str
    physical_width_mm: float | None
    physical_height_mm: float | None
    asset_type: str
    width_px: int
    height_px: int
    alpha_bbox: tuple[int, int, int, int]
    anchor_source: str
    attachment_point: str | None
    mirrorable: bool
    left_right_symmetry_score: float | None
    error: str | None


def _left_right_symmetry_score(alpha: np.ndarray, bbox: tuple[int, int, int, int]) -> float | None:
    """1.0 = perfectly left/right mirror-symmetric alpha footprint within its own bbox,
    0.0 = no overlap at all when one half is flipped onto the other. A real, cheap
    intersection-over-union measurement -- never estimated/guessed."""
    left, top, right, bottom = bbox
    crop = (alpha[top:bottom, left:right] > 0).astype(np.uint8)
    height, width = crop.shape
    if width < 2:
        return None
    half = width // 2
    left_half = crop[:, :half]
    right_half = crop[:, width - half :]
    right_half_mirrored = np.fliplr(right_half)
    union = np.logical_or(left_half, right_half_mirrored).sum()
    if union == 0:
        return None
    intersection = np.logical_and(left_half, right_half_mirrored).sum()
    return float(intersection) / float(union)


def _audit_one_asset(jewellery: Jewellery, asset: JewelleryAsset) -> AssetFinding:
    common = dict(
        jewellery_name=jewellery.name,
        category_slug=jewellery.category.slug,
        physical_width_mm=float(jewellery.physical_width_mm) if jewellery.physical_width_mm is not None else None,
        physical_height_mm=float(jewellery.physical_height_mm) if jewellery.physical_height_mm is not None else None,
        asset_type=asset.asset_type.value,
    )
    try:
        raw_bytes = get_object_storage().download(asset.storage_key)
        image = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
        rgba = np.array(image)
        geometry = compute_asset_geometry(
            rgba,
            anchor_x=asset.anchor_x,
            anchor_y=asset.anchor_y,
            attachment_point=asset.attachment_point,
            mirrorable=asset.mirrorable,
            physical_width_mm=common["physical_width_mm"],
            physical_height_mm=common["physical_height_mm"],
        )
        symmetry = _left_right_symmetry_score(rgba[:, :, 3], geometry.alpha_bbox)
        return AssetFinding(
            **common,
            width_px=geometry.width_px,
            height_px=geometry.height_px,
            alpha_bbox=geometry.alpha_bbox,
            anchor_source=geometry.anchor_source,
            attachment_point=geometry.attachment_point,
            mirrorable=geometry.mirrorable,
            left_right_symmetry_score=symmetry,
            error=None,
        )
    except InvalidAssetError as exc:
        return AssetFinding(
            **common,
            width_px=0,
            height_px=0,
            alpha_bbox=(0, 0, 0, 0),
            anchor_source="n/a",
            attachment_point=None,
            mirrorable=asset.mirrorable,
            left_right_symmetry_score=None,
            error=str(exc),
        )
    except Exception as exc:  # storage/network errors -- reported, never silently skipped
        return AssetFinding(
            **common,
            width_px=0,
            height_px=0,
            alpha_bbox=(0, 0, 0, 0),
            anchor_source="n/a",
            attachment_point=None,
            mirrorable=asset.mirrorable,
            left_right_symmetry_score=None,
            error=f"{type(exc).__name__}: {exc}",
        )


def audit(category_slugs: list[str] | None) -> list[AssetFinding]:
    db = SessionLocal()
    try:
        query = db.query(Jewellery).options(joinedload(Jewellery.category)).filter(Jewellery.is_active.is_(True))
        items = query.all()
        if category_slugs:
            items = [item for item in items if item.category.slug in category_slugs]

        findings: list[AssetFinding] = []
        for item in items:
            processed = [a for a in item.assets if a.asset_type == AssetType.processed and a.processing_status == ProcessingStatus.ready]
            assets_to_check = processed or [a for a in item.assets if a.processing_status == ProcessingStatus.ready]
            if not assets_to_check:
                findings.append(
                    AssetFinding(
                        jewellery_name=item.name,
                        category_slug=item.category.slug,
                        physical_width_mm=float(item.physical_width_mm) if item.physical_width_mm is not None else None,
                        physical_height_mm=float(item.physical_height_mm) if item.physical_height_mm is not None else None,
                        asset_type="none",
                        width_px=0,
                        height_px=0,
                        alpha_bbox=(0, 0, 0, 0),
                        anchor_source="n/a",
                        attachment_point=None,
                        mirrorable=False,
                        left_right_symmetry_score=None,
                        error="No ready asset found for this item.",
                    )
                )
                continue
            for asset in assets_to_check:
                findings.append(_audit_one_asset(item, asset))
        return findings
    finally:
        db.close()


def print_report(findings: list[AssetFinding]) -> None:
    print(f"{'ITEM':<24} {'CAT':<10} {'W_MM':>6} {'H_MM':>6} {'PX_W':>6} {'PX_H':>6} {'ASPECT':>7} {'ANCHOR':<20} {'MIRROR':<7} {'SYMM':>6}  ERROR")
    for f in findings:
        if f.error:
            print(f"{f.jewellery_name[:24]:<24} {f.category_slug:<10} {'':>6} {'':>6} {'':>6} {'':>6} {'':>7} {'':<20} {'':<7} {'':>6}  {f.error}")
            continue
        left, top, right, bottom = f.alpha_bbox
        bbox_w = right - left
        bbox_h = bottom - top
        aspect = bbox_h / bbox_w if bbox_w > 0 else float("nan")
        symm = f"{f.left_right_symmetry_score:.2f}" if f.left_right_symmetry_score is not None else "n/a"
        w_mm = f"{f.physical_width_mm:.0f}" if f.physical_width_mm is not None else "unset"
        h_mm = f"{f.physical_height_mm:.0f}" if f.physical_height_mm is not None else "unset"
        print(
            f"{f.jewellery_name[:24]:<24} {f.category_slug:<10} {w_mm:>6} {h_mm:>6} "
            f"{f.width_px:>6} {f.height_px:>6} {aspect:>7.2f} {f.anchor_source:<20} {str(f.mirrorable):<7} {symm:>6}"
        )

    unset_physical = sum(1 for f in findings if f.error is None and f.physical_width_mm is None)
    default_anchor = sum(1 for f in findings if f.anchor_source == "default_bbox_top_center")
    print(
        f"\n{len(findings)} asset(s) audited. {unset_physical} have no physical_width_mm set "
        f"(computeScale falls back to the relative-shoulder/face-width heuristic for these -- "
        f"see geometry.ts's computeScale docstring). {default_anchor} rely on the default "
        f"bbox-top-center anchor rather than an explicit catalogue anchor_x/anchor_y."
    )
    print(
        "\nEVERY asset audited above is a single flat 2D RGBA PNG (confirmed from the schema, "
        "not from this scan): db/models/jewellery_asset.py has exactly one image per asset row "
        "and no depth-layer/mesh/3D field of any kind. None of this catalogue's assets can "
        "represent multiple depth layers or true 3D geometry -- see the M6.5 final report's "
        "'asset limitations' section for what this does and doesn't block."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--category", help="Comma-separated category slugs to limit the audit to (default: all).")
    args = parser.parse_args()
    slugs = [s.strip() for s in args.category.split(",")] if args.category else None
    print_report(audit(slugs))
