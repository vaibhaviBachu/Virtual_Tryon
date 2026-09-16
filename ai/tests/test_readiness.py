"""
Readiness logic tests (ai/landmarks/readiness.py). Constructs realistic-shaped result
dataclasses directly (fast, deterministic, doesn't depend on any specific image's
detectability) to test the aggregation logic itself in isolation, per the spec's
required readiness scenarios: earrings ready/not-ready, necklace ready, rings
not-ready, combined readiness.
"""
from ai.landmarks.readiness import evaluate_readiness
from ai.landmarks.schemas import (
    ConfidenceLevel,
    EarRegion,
    FaceLandmarkResult,
    HandLandmarkResult,
    NormalizedPoint,
    PoseLandmarkResult,
    SegmentationResult,
    bucket_confidence,
)


def _ear(confidence: float, visible: bool) -> EarRegion:
    return EarRegion(
        side="left",
        anchor=NormalizedPoint(x=0.3, y=0.5),
        confidence=confidence,
        confidence_level=bucket_confidence(confidence),
        sufficiently_visible=visible,
        reason=None if visible else "low confidence",
    )


def test_earrings_ready_when_face_and_ears_confident():
    face = FaceLandmarkResult(
        success=True,
        detection_confidence=0.8,
        confidence_level=ConfidenceLevel.high,
        left_ear=_ear(0.7, True),
        right_ear=_ear(0.7, True),
    )
    readiness = evaluate_readiness(face, None, None, None)
    assert readiness.face_ready is True
    assert readiness.ears_ready is True
    assert readiness.left_ear_ready is True
    assert readiness.right_ear_ready is True


def test_earrings_not_ready_when_both_ears_hidden():
    face = FaceLandmarkResult(
        success=True,
        detection_confidence=0.8,
        confidence_level=ConfidenceLevel.high,
        left_ear=_ear(0.2, False),
        right_ear=_ear(0.2, False),
    )
    readiness = evaluate_readiness(face, None, None, None)
    assert readiness.face_ready is True
    assert readiness.ears_ready is False
    assert "ears" in readiness.reasons


def test_necklace_ready_from_real_pose_shoulder_confidence():
    pose = PoseLandmarkResult(success=True, shoulder_confidence=0.6, confidence_level=ConfidenceLevel.medium)
    readiness = evaluate_readiness(None, None, pose, None)
    assert readiness.neck_ready is True


def test_necklace_not_ready_when_pose_missing():
    readiness = evaluate_readiness(None, None, None, None)
    assert readiness.neck_ready is False
    assert "neck" in readiness.reasons


def test_rings_not_ready_when_no_hands():
    hands = HandLandmarkResult(success=True, hands_detected=0, state="no_hand_detected")
    readiness = evaluate_readiness(None, hands, None, None)
    assert readiness.hands_ready is False
    assert "No hands were detected" in readiness.reasons["hands"]


def test_rings_ready_when_usable_hand_detected():
    hands = HandLandmarkResult(success=True, hands_detected=1, state="one_hand")
    readiness = evaluate_readiness(None, hands, None, None)
    assert readiness.hands_ready is True


def test_combined_readiness_can_differ_per_category_on_same_photo():
    """The same photo is ready for necklace but not for earrings (ears hidden) or
    rings (no hands) — this is the exact spec requirement being tested."""
    face = FaceLandmarkResult(
        success=True,
        detection_confidence=0.8,
        confidence_level=ConfidenceLevel.high,
        left_ear=_ear(0.1, False),
        right_ear=_ear(0.1, False),
    )
    pose = PoseLandmarkResult(success=True, shoulder_confidence=0.7, confidence_level=ConfidenceLevel.high)
    hands = HandLandmarkResult(success=True, hands_detected=0, state="no_hand_detected")
    seg = SegmentationResult(success=True, confidence=0.8, confidence_level=ConfidenceLevel.high)

    readiness = evaluate_readiness(face, hands, pose, seg)
    assert readiness.face_ready is True
    assert readiness.neck_ready is True
    assert readiness.ears_ready is False
    assert readiness.hands_ready is False


def test_low_confidence_face_never_marks_ready():
    face = FaceLandmarkResult(success=True, detection_confidence=0.2, confidence_level=ConfidenceLevel.low)
    readiness = evaluate_readiness(face, None, None, None)
    assert readiness.face_ready is False
