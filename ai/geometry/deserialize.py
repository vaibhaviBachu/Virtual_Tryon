"""
Reconstructs ai.landmarks.schemas dataclasses from the plain-dict shape Milestone 3's
worker persisted onto TryOnRequest.face_landmarks/pose_landmarks (see
workers/tasks/process_tryon_request.py's `_serialize_face`/`_serialize_pose`). Kept
here (not duplicated inline in the render worker task) so the exact dict shape is
documented and tested in one place.
"""
from typing import Any, Dict, Optional

from ai.landmarks.schemas import (
    ConfidenceLevel,
    EarRegion,
    FaceLandmarkResult,
    NormalizedPoint,
    PoseLandmarkResult,
)


def face_from_dict(data: Optional[Dict[str, Any]]) -> Optional[FaceLandmarkResult]:
    if not data:
        return None

    def _ear(raw: Optional[Dict[str, Any]]) -> Optional[EarRegion]:
        if raw is None:
            return None
        anchor = raw.get("anchor")
        return EarRegion(
            side=raw["side"],
            anchor=NormalizedPoint(x=anchor["x"], y=anchor["y"]) if anchor else None,
            confidence=raw.get("confidence", 0.0),
            confidence_level=ConfidenceLevel(raw.get("confidence_level", "none")),
            sufficiently_visible=raw.get("sufficiently_visible", False),
            reason=raw.get("reason"),
        )

    return FaceLandmarkResult(
        success=data.get("success", False),
        error_message=data.get("error_message"),
        image_width_px=data.get("image_width_px", 0),
        image_height_px=data.get("image_height_px", 0),
        num_faces_detected=data.get("num_faces_detected", 0),
        landmarks=[NormalizedPoint(x=p["x"], y=p["y"], z=p.get("z")) for p in data.get("landmarks", [])],
        face_bounding_box=data.get("face_bounding_box"),
        detection_confidence=data.get("detection_confidence", 0.0),
        confidence_level=ConfidenceLevel(data.get("confidence_level", "none")),
        head_pose_yaw_estimate=data.get("head_pose_yaw_estimate"),
        left_ear=_ear(data.get("left_ear")),
        right_ear=_ear(data.get("right_ear")),
        model_name=data.get("model_name", "mediapipe_face_mesh_0.10.9"),
    )


def pose_from_dict(data: Optional[Dict[str, Any]]) -> Optional[PoseLandmarkResult]:
    if not data:
        return None
    neck = data.get("neck_anchor")
    return PoseLandmarkResult(
        success=data.get("success", False),
        error_message=data.get("error_message"),
        image_width_px=data.get("image_width_px", 0),
        image_height_px=data.get("image_height_px", 0),
        landmarks=[
            NormalizedPoint(x=p["x"], y=p["y"], z=p.get("z"), visibility=p.get("visibility"))
            for p in data.get("landmarks", [])
        ],
        shoulder_confidence=data.get("shoulder_confidence", 0.0),
        confidence_level=ConfidenceLevel(data.get("confidence_level", "none")),
        neck_anchor=NormalizedPoint(x=neck["x"], y=neck["y"]) if neck else None,
        body_orientation=data.get("body_orientation"),
        method=data.get("method", "mediapipe_pose_0.10.9"),
    )
