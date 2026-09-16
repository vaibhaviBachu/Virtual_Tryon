"""
Milestone 4 geometry try-on data contracts.

Mirrors ai/landmarks/schemas.py's rule: nothing outside ai/geometry (and the worker
orchestrator that calls into it, workers/tasks/process_tryon_render.py) may see a raw
ORM row or FastAPI request/response model — this module is the clean internal
representation the geometry engine consumes and produces (spec §5, §6). It intentionally
DOES depend on ai/landmarks/schemas.py's dataclasses (FaceLandmarkResult etc.) — those are
themselves already a clean, MediaPipe-free representation, so re-wrapping them again
would add indirection without adding safety.

COORDINATE SYSTEM (read before touching anything in ai/geometry — see also
ai/landmarks/schemas.py's own docstring, which nothing in this package deviates from):
  - Face/pose landmarks passed into this package remain in MediaPipe's normalized
    [0,1], top-left-origin convention exactly as Milestone 3 produced them.
  - Every `Point` produced by ai.geometry.anchors/scale/rotation/transform (anchors,
    transformed bounding boxes, translation vectors) is in PIXEL space of the USER'S
    PHOTO (image_width_px x image_height_px), unless explicitly documented otherwise.
  - `JewelleryAssetGeometry.anchor_px` is the one deliberate exception: it is in the
    ASSET'S OWN pixel space (its own width_px x height_px), because it describes a
    point on the catalogue image, not the user's photo. ai.geometry.transform is the
    single place these two pixel spaces are ever combined.
  - The normalized -> pixel conversion for landmarks happens in exactly one place
    (ai.geometry.anchors.compute_anchor) and is never re-derived elsewhere in this
    package (spec §29: "only convert to pixel coordinates at the rendering boundary...
    document every conversion").
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class Point:
    x: float
    y: float


@dataclass
class JewelleryAssetGeometry:
    """Real, measured geometry of one processed (transparent-background) catalogue
    asset, computed from its own pixel content — never assumed from the raw image
    rectangle (spec §18: "use the non-transparent alpha bounding box... not the raw
    image rectangle alone")."""

    width_px: int
    height_px: int
    # Non-transparent alpha bounding box in the asset's own pixel space:
    # (left, top, right, bottom), right/bottom exclusive (PIL/NumPy slice convention).
    alpha_bbox: Tuple[int, int, int, int]
    # JEWELLERY_ANCHOR (spec §8): the attachment point, in the asset's own pixel space.
    anchor_px: Point
    anchor_source: str  # "catalogue_metadata" | "default_bbox_top_center"
    attachment_point: Optional[str]
    mirrorable: bool
    physical_width_mm: Optional[float]
    physical_height_mm: Optional[float]

    @property
    def effective_width_px(self) -> float:
        left, _, right, _ = self.alpha_bbox
        return float(right - left)

    @property
    def effective_height_px(self) -> float:
        _, top, _, bottom = self.alpha_bbox
        return float(bottom - top)


@dataclass
class AnchorResult:
    """BODY_ANCHOR (spec §8, §13): where on the user's photo the jewellery's
    JEWELLERY_ANCHOR should land, plus the real geometric signal used to derive scale
    and document assumptions."""

    success: bool
    anchor_px: Optional[Point] = None
    # A real, measured pixel distance used as this anchor's natural size reference
    # (face bounding-box width for an ear anchor; shoulder width for a neck anchor) —
    # never fabricated, always derived from the same landmark result as the anchor.
    reference_measurement_px: Optional[float] = None
    method: str = ""
    error_code: Optional[str] = None
    error_message: Optional[str] = None


@dataclass
class ScaleResult:
    success: bool
    scale_factor: float = 1.0  # multiplies the asset's own alpha-bbox pixel size
    target_width_px: Optional[float] = None
    used_physical_dimensions: bool = False
    assumptions: List[str] = field(default_factory=list)
    method: str = ""


@dataclass
class RotationResult:
    success: bool
    rotation_degrees: float = 0.0
    method: str = ""
    confidence: float = 0.0
    assumptions: List[str] = field(default_factory=list)


@dataclass
class TransformResult:
    """2x3 affine matrix (OpenCV convention: dst_xy1 = M @ [x, y, 1]^T) mapping the
    asset's OWN pixel coordinates directly onto the user photo's pixel coordinates,
    built so JEWELLERY_ANCHOR maps exactly onto BODY_ANCHOR (spec §8, §13, §16)."""

    matrix: List[List[float]]  # 2x3
    scale_factor: float
    rotation_degrees: float
    anchor_px: Point  # BODY_ANCHOR in user-image pixel space (== AnchorResult.anchor_px)
    transformed_bbox_px: Tuple[float, float, float, float]  # (left, top, right, bottom), user-image pixel space
    mirrored: bool = False


@dataclass
class TryOnInput:
    """Clean internal representation the geometry engine consumes (spec §5) — never a
    raw ORM object or FastAPI schema. `user_image_rgb`/`jewellery_asset_rgba` are
    decoded numpy arrays; everything else is plain data."""

    user_image_rgb: Any  # np.ndarray, HxWx3 uint8
    jewellery_asset_rgba: Any  # np.ndarray, HxWx4 uint8 — the processed, transparent catalogue asset
    category_slug: str  # "earring" | "necklace" (Milestone 4's only two functional categories, spec §26)
    side: Optional[str]  # "left" | "right" | "both" for earrings; None for necklace
    asset_anchor_x: Optional[float]
    asset_anchor_y: Optional[float]
    attachment_point: Optional[str]
    mirrorable: bool
    physical_width_mm: Optional[float]
    physical_height_mm: Optional[float]
    face: Optional[Any] = None  # ai.landmarks.schemas.FaceLandmarkResult
    pose: Optional[Any] = None  # ai.landmarks.schemas.PoseLandmarkResult
    image_width_px: int = 0
    image_height_px: int = 0
    readiness: Optional[Dict[str, Any]] = None
    debug: bool = False


@dataclass
class PlacementRecord:
    """One placed jewellery instance's full, honest metadata — this is what is
    persisted verbatim (as plain dicts) in TryOnRender.placement_metadata (spec §6)."""

    side: Optional[str]
    anchor: AnchorResult
    scale: ScaleResult
    rotation: RotationResult
    transform: Optional[TransformResult]


@dataclass
class TryOnRenderResult:
    """Milestone 4's own richer output contract. `ai.engines.geometry.engine.
    GeometryTryOnEngine` builds one of these internally and adapts it into the shared
    `ai.engines.base.RenderResult` at the TryOnEngine boundary (see that module for why
    RenderResult itself gained one new optional field rather than being replaced)."""

    success: bool
    result_image_rgba: Any = None  # np.ndarray, only set on success
    debug_image_rgb: Any = None  # np.ndarray, only set when TryOnInput.debug=True and success
    category_slug: str = ""
    placements: List[PlacementRecord] = field(default_factory=list)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    metrics: Dict[str, float] = field(default_factory=dict)
