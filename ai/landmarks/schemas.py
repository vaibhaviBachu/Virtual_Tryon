"""
Shared, application-level result types for every landmark/segmentation module in this
milestone (ai/landmarks/*, ai/segmentation/person_segmenter.py).

Nothing outside `ai/` (and the worker orchestrator that calls into `ai/`) may ever see a
raw MediaPipe object (`NormalizedLandmarkList`, `SolutionOutputs`, etc.) — every module
returns one of the dataclasses below instead, per the spec's "the future geometry engine
must not know about MediaPipe-specific classes" rule (mirrors ai/engines/base.py's
RenderResult boundary).

COORDINATE CONVENTION (read before touching any landmark code):
- All (x, y) pairs are normalized to [0, 1], with origin (0, 0) at the TOP-LEFT of the
  captured (not previewed) image, x increasing right, y increasing down — this is
  MediaPipe's own convention, kept unchanged so no silent transform bugs are introduced.
- `image_width_px`/`image_height_px` on every result are the dimensions of the actual
  decoded, EXIF-orientation-normalized image that was fed to inference (i.e. the same
  bytes stored for the user, post `ai/preprocessing/image_validation.py`), never the
  live camera-preview element's dimensions.
- The frontend's live camera *preview* is very often mirrored (CSS `transform: scaleX(-1)`
  or a mirrored `<video>` element) for a natural "looking in a mirror" UX, but the actual
  captured `<canvas>` frame handed to `canvas.toBlob()` must NOT be mirrored — mirroring
  only the preview and not the capture is standard practice, and this backend never
  applies or undoes a mirror itself. If a captured photo IS mirrored (front camera apps
  vary), that is a client-side bug to fix in the frontend capture code, not something
  landmark/segmentation code compensates for — doing it here would silently corrupt
  left/right ear and left/right hand semantics. See ai/tests/test_face_landmarks.py and
  test_hand_landmarks.py for explicit "left stays left" coordinate-convention tests.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ConfidenceLevel(str, Enum):
    """A coarse, human-meaningful bucket derived from a numeric confidence score. Never
    invented independently of the numeric score — always `bucket_confidence()` below."""

    none = "none"
    low = "low"
    medium = "medium"
    high = "high"


def bucket_confidence(score: Optional[float]) -> ConfidenceLevel:
    if score is None:
        return ConfidenceLevel.none
    if score >= 0.75:
        return ConfidenceLevel.high
    if score >= 0.45:
        return ConfidenceLevel.medium
    if score > 0.0:
        return ConfidenceLevel.low
    return ConfidenceLevel.none


@dataclass
class NormalizedPoint:
    x: float
    y: float
    z: Optional[float] = None  # relative depth, MediaPipe convention (not metric)
    visibility: Optional[float] = None  # only populated where the underlying model emits it (pose)


@dataclass
class EarRegion:
    """One ear's approximate anchor + a "sufficiently reliable" determination. Anchor
    points are geometric estimates derived from face-mesh landmarks near the ear/cheek
    boundary — see ai/landmarks/face.py's module docstring for exactly which indices and
    why, and for the honest limitation that this cannot distinguish "ear hidden by hair"
    from "ear turned away from camera" (both look like low geometric confidence here;
    neither is fabricated as a false positive)."""

    side: str  # "left" | "right"
    anchor: Optional[NormalizedPoint]
    confidence: float  # 0.0-1.0, see face.py for the formula
    confidence_level: ConfidenceLevel
    sufficiently_visible: bool
    reason: Optional[str] = None


@dataclass
class FaceLandmarkResult:
    success: bool
    error_message: Optional[str] = None
    image_width_px: int = 0
    image_height_px: int = 0
    num_faces_detected: int = 0
    landmarks: List[NormalizedPoint] = field(default_factory=list)  # 468-pt face mesh, empty if not success
    face_bounding_box: Optional[Dict[str, float]] = None  # {x_min,y_min,x_max,y_max} normalized
    detection_confidence: float = 0.0  # real FaceDetection.score, not fabricated
    confidence_level: ConfidenceLevel = ConfidenceLevel.none
    head_pose_yaw_estimate: Optional[float] = None  # heuristic, degrees, see face.py
    left_ear: Optional[EarRegion] = None
    right_ear: Optional[EarRegion] = None
    model_name: str = "mediapipe_face_mesh_0.10.9"


@dataclass
class HandResult:
    side: str  # "left" | "right" (post-mirror-correction handedness label from MediaPipe)
    landmarks: List[NormalizedPoint]  # 21 points: wrist, thumb, index, middle, ring, pinky joints
    handedness_confidence: float  # real MediaPipe classification score
    confidence_level: ConfidenceLevel


@dataclass
class HandLandmarkResult:
    success: bool
    error_message: Optional[str] = None
    image_width_px: int = 0
    image_height_px: int = 0
    hands_detected: int = 0  # 0, 1, or 2
    state: str = "no_hand_detected"  # no_hand_detected|one_hand|two_hands|low_confidence|usable
    hands: List[HandResult] = field(default_factory=list)
    model_name: str = "mediapipe_hands_0.10.9"


@dataclass
class PoseLandmarkResult:
    success: bool
    error_message: Optional[str] = None
    image_width_px: int = 0
    image_height_px: int = 0
    landmarks: List[NormalizedPoint] = field(default_factory=list)  # 33-pt MediaPipe Pose topology
    shoulder_confidence: float = 0.0  # mean visibility of left/right shoulder landmarks (real)
    confidence_level: ConfidenceLevel = ConfidenceLevel.none
    neck_anchor: Optional[NormalizedPoint] = None  # midpoint of shoulders, approximation for neck base
    body_orientation: Optional[str] = None  # "frontal" | "turned" heuristic from shoulder z-delta
    method: str = "mediapipe_pose_0.10.9"  # vs. "segmentation_heuristic" if pose model unavailable


@dataclass
class SegmentationResult:
    success: bool
    error_message: Optional[str] = None
    image_width_px: int = 0
    image_height_px: int = 0
    person_mask_storage_key: Optional[str] = None  # private object-storage key, PNG, set by the worker
    foreground_ratio: float = 0.0  # fraction of pixels classified foreground, real, measured
    decisiveness: float = 0.0  # fraction of mask pixels with value >0.9 or <0.1 (see person_segmenter.py)
    confidence: float = 0.0
    confidence_level: ConfidenceLevel = ConfidenceLevel.none
    available_masks: List[str] = field(default_factory=lambda: ["person"])  # honest: no hair/skin/cloth sub-masks
    model_name: str = "mediapipe_selfie_segmentation_0.10.9"


@dataclass
class ReadinessResult:
    """Category-aware readiness for Milestone 4 to consume. Never a single pass/fail —
    the same photo can be ready for one category and not another."""

    face_ready: bool
    ears_ready: bool
    left_ear_ready: bool
    right_ear_ready: bool
    neck_ready: bool
    hands_ready: bool
    reasons: Dict[str, str] = field(default_factory=dict)  # category -> human-readable reason if not ready
    raw_confidences: Dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "face_ready": self.face_ready,
            "ears_ready": self.ears_ready,
            "left_ear_ready": self.left_ear_ready,
            "right_ear_ready": self.right_ear_ready,
            "neck_ready": self.neck_ready,
            "hands_ready": self.hands_ready,
            "reasons": self.reasons,
            "raw_confidences": self.raw_confidences,
        }
