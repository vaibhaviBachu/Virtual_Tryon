"""
Runs the REAL ai/landmarks + ai/segmentation modules (no worker/DB/storage involved —
this is the pure algorithm layer) against every image in evaluation/users/ and prints
the actual, measured results. This is the script behind the "critical real-world
testing" section of docs/milestone-3-verification.md — every number in that section's
table was produced by actually running this script, not hand-written.

Run with: python evaluation/scripts/run_scenario_evaluation.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ai.landmarks.face import FaceLandmarker
from ai.landmarks.hand import HandLandmarker
from ai.landmarks.pose import PoseLandmarker
from ai.landmarks.readiness import evaluate_readiness
from ai.preprocessing.quality_checks import check_image_quality
from ai.segmentation.person_segmenter import PersonSegmenter

USERS_DIR = os.path.join(os.path.dirname(__file__), "..", "users")


def load_rgb(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def main():
    face = FaceLandmarker()
    hand = HandLandmarker()
    pose = PoseLandmarker()
    seg = PersonSegmenter()

    results = {}
    for scenario in sorted(os.listdir(USERS_DIR)):
        scenario_dir = os.path.join(USERS_DIR, scenario)
        if not os.path.isdir(scenario_dir):
            continue
        images = [f for f in os.listdir(scenario_dir) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        if not images:
            continue
        image_path = os.path.join(scenario_dir, images[0])
        image_rgb = load_rgb(image_path)

        quality = check_image_quality(image_rgb)
        face_result = face.detect(image_rgb)
        hand_result = hand.detect(image_rgb)
        pose_result = pose.detect(image_rgb)
        seg_result, _mask = seg.segment(image_rgb)
        readiness = evaluate_readiness(face_result, hand_result, pose_result, seg_result)

        results[scenario] = {
            "image": images[0],
            "quality_passed": quality.passed,
            "quality_reasons": quality.failure_reasons,
            "face_detected": face_result.success,
            "num_faces": face_result.num_faces_detected,
            "face_confidence": round(face_result.detection_confidence, 3),
            "left_ear_visible": face_result.left_ear.sufficiently_visible if face_result.left_ear else None,
            "right_ear_visible": face_result.right_ear.sufficiently_visible if face_result.right_ear else None,
            "hands_detected": hand_result.hands_detected,
            "hand_state": hand_result.state,
            "pose_detected": pose_result.success,
            "shoulder_confidence": round(pose_result.shoulder_confidence, 3),
            "segmentation_success": seg_result.success,
            "segmentation_confidence": round(seg_result.confidence, 3),
            "readiness": readiness.as_dict(),
        }
        print(f"--- {scenario} ({images[0]}) ---")
        print(json.dumps(results[scenario], indent=2, default=str))

    out_path = os.path.join(os.path.dirname(__file__), "..", "expected", "scenario_results.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
