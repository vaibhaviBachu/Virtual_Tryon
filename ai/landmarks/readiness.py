"""
Category-aware pre-flight readiness (Milestone 3 spec: "the same photo can be ready for
one category and not another"). This module only aggregates the confidence signals
already computed by FaceLandmarker/HandLandmarker/PoseLandmarker/PersonSegmenter into a
Milestone-4-consumable decision — it never runs its own inference and never implements
placement.

Thresholds are deliberately centralized here (not sprinkled through the worker) so
Milestone 4 can review/tune them in one place.
"""
from typing import Optional

from ai.landmarks.schemas import (
    FaceLandmarkResult,
    HandLandmarkResult,
    PoseLandmarkResult,
    ReadinessResult,
    SegmentationResult,
)

FACE_CONFIDENCE_THRESHOLD = 0.5
EAR_CONFIDENCE_THRESHOLD = 0.5
NECK_CONFIDENCE_THRESHOLD = 0.45
HAND_USABLE_STATES = {"one_hand", "two_hands"}


def evaluate_readiness(
    face: Optional[FaceLandmarkResult],
    hands: Optional[HandLandmarkResult],
    pose: Optional[PoseLandmarkResult],
    segmentation: Optional[SegmentationResult],
) -> ReadinessResult:
    reasons: dict[str, str] = {}
    raw: dict[str, float] = {}

    face_ready = bool(face and face.success and face.detection_confidence >= FACE_CONFIDENCE_THRESHOLD)
    raw["face"] = face.detection_confidence if face else 0.0
    if not face_ready:
        reasons["face"] = (
            face.error_message if (face and face.error_message) else "Face was not detected with sufficient confidence."
        )

    left_ear_ready = bool(face_ready and face.left_ear and face.left_ear.sufficiently_visible)
    right_ear_ready = bool(face_ready and face.right_ear and face.right_ear.sufficiently_visible)
    raw["left_ear"] = face.left_ear.confidence if (face and face.left_ear) else 0.0
    raw["right_ear"] = face.right_ear.confidence if (face and face.right_ear) else 0.0
    ears_ready = left_ear_ready or right_ear_ready
    if not ears_ready:
        reasons["ears"] = (
            "Your ears aren't clearly visible. Please move your hair away from your ears and take another photo."
            if face_ready
            else "Ears cannot be evaluated without a confidently detected face."
        )

    neck_ready = bool(pose and pose.success and pose.shoulder_confidence >= NECK_CONFIDENCE_THRESHOLD)
    raw["neck"] = pose.shoulder_confidence if pose else 0.0
    if not neck_ready:
        reasons["neck"] = (
            pose.error_message
            if (pose and pose.error_message)
            else "Shoulders/neck area is not clearly visible. Please include your shoulders in the photo."
        )

    hands_ready = bool(hands and hands.success and hands.state in HAND_USABLE_STATES)
    raw["hands"] = float(hands.hands_detected) if hands else 0.0
    if not hands_ready:
        reasons["hands"] = (
            "Hands aren't clearly visible. For rings or bangles, please take a photo that includes your hand(s)."
            if not (hands and hands.state == "no_hand_detected")
            else "No hands were detected in this photo. For rings or bangles, please include your hand(s)."
        )

    raw["segmentation"] = segmentation.confidence if segmentation else 0.0

    return ReadinessResult(
        face_ready=face_ready,
        ears_ready=ears_ready,
        left_ear_ready=left_ear_ready,
        right_ear_ready=right_ear_ready,
        neck_ready=neck_ready,
        hands_ready=hands_ready,
        reasons=reasons,
        raw_confidences=raw,
    )
