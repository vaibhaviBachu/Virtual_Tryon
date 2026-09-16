"""
Hand landmark detection — Milestone 3.

Prior research assumed hands would be a "blocked / not available" component (no
reachable, license-clean, runnable hand-landmark model). That assumption was based on
the network-dependent MediaPipe *Tasks* API. As documented in ai/landmarks/face.py, the
older MediaPipe *Solutions* API (`mediapipe==0.10.9`) bundles its `.tflite` weights
directly in the pip wheel, including `mediapipe/modules/hand_landmark/
hand_landmark_full.tflite` and `mediapipe/modules/palm_detection/
palm_detection_full.tflite` — both Apache 2.0, both verified present in the wheel and
runnable with no network access (see ai/models/LICENSES.md). This means real hand
landmark detection IS available here, contrary to the earlier "hands are blocked"
assumption — a better outcome than assumed, not a downgrade, and reported honestly as
such rather than silently keeping the originally-planned "blocked" writeup.

Even with a real detector, "no hand detected" remains a first-class, expected, honestly
reported outcome (never fabricated wrist/finger coordinates when no hand is present).
"""
import logging

import numpy as np

from ai.landmarks.schemas import (
    ConfidenceLevel,
    HandLandmarkResult,
    HandResult,
    NormalizedPoint,
    bucket_confidence,
)

logger = logging.getLogger("ai.landmarks.hand")

_MIN_DETECTION_CONFIDENCE = 0.5
_LOW_CONFIDENCE_THRESHOLD = 0.5


class HandLandmarker:
    model_name = "mediapipe_hands_0.10.9"

    def __init__(self) -> None:
        import mediapipe as mp

        self._mp = mp
        self._hands = mp.solutions.hands.Hands(
            static_image_mode=True,
            max_num_hands=2,
            min_detection_confidence=_MIN_DETECTION_CONFIDENCE,
        )

    def detect(self, image_rgb: np.ndarray) -> HandLandmarkResult:
        height, width = image_rgb.shape[0], image_rgb.shape[1]
        try:
            result = self._hands.process(image_rgb)
        except Exception:
            logger.exception("Hand detection raised unexpectedly")
            return HandLandmarkResult(
                success=False,
                error_message="Hand detection failed unexpectedly on this image.",
                image_width_px=width,
                image_height_px=height,
            )

        multi_hands = result.multi_hand_landmarks or []
        multi_handedness = result.multi_handedness or []

        if len(multi_hands) == 0:
            # A legitimate, correctly-returned state per the spec — not a failure of
            # the module, an honest observation about the photo.
            return HandLandmarkResult(
                success=True,
                image_width_px=width,
                image_height_px=height,
                hands_detected=0,
                state="no_hand_detected",
            )

        hands: list[HandResult] = []
        for hand_landmarks, handedness in zip(multi_hands, multi_handedness):
            score = float(handedness.classification[0].score)  # real MediaPipe classification confidence
            label = handedness.classification[0].label  # "Left" | "Right" (MediaPipe's own handedness label,
            # computed from the assumption the input is a normal, non-mirrored front-camera-style image —
            # see ai/landmarks/schemas.py's coordinate-convention note on why the stored image must never
            # be silently mirrored, or this label would be inverted).
            points = [
                NormalizedPoint(x=p.x, y=p.y, z=p.z) for p in hand_landmarks.landmark
            ]
            hands.append(
                HandResult(
                    side=label.lower(),
                    landmarks=points,
                    handedness_confidence=score,
                    confidence_level=bucket_confidence(score),
                )
            )

        usable_hands = [h for h in hands if h.handedness_confidence >= _LOW_CONFIDENCE_THRESHOLD]
        if len(usable_hands) == 0:
            state = "low_confidence"
        elif len(hands) == 1:
            state = "one_hand" if len(usable_hands) == 1 else "low_confidence"
        else:
            state = "two_hands" if len(usable_hands) == 2 else "one_hand"

        return HandLandmarkResult(
            success=True,
            image_width_px=width,
            image_height_px=height,
            hands_detected=len(hands),
            state=state,
            hands=hands,
        )

    def close(self) -> None:
        self._hands.close()
