# Milestone 4 geometry evaluation dataset — provenance

Per the spec's "no customer images — synthetic/appropriately licensed" rule (already
established for Milestone 3, see `evaluation/data/test_images/SOURCES.md`), the
Milestone 4 geometry evaluation dataset is:

1. **`evaluation/data/geometry_synthetic_cases.py`** — 18 hand-built
   `ai.landmarks.schemas` dataclasses (not photographs, not customer data, not fetched
   from anywhere) with expected anchor/scale/rotation values computed by hand from the
   documented formulas in `ai/geometry/{anchors,scale,rotation}.py`. 15 "success" cases
   (5 earring positions, 3 earring tilts, 5 necklace positions, 2 necklace tilts) plus 3
   deliberate failure cases (no face, low ear confidence, no pose) with their expected
   structured error code.

2. **The existing Milestone 3 real-image fixtures** — `evaluation/users/*` (synthetic,
   programmatically PIL-drawn images, see `evaluation/scripts/generate_synthetic_dataset.py`)
   and `evaluation/data/test_images/opencv_sample_person.jpg` (a real photograph, OpenCV's
   own redistributable sample asset, see `evaluation/data/test_images/SOURCES.md`) — reused
   here, unmodified, to run the real FaceLandmarker/PoseLandmarker + GeometryTryOnEngine
   pipeline end to end and check self-consistency against the independently-computed
   readiness gate (`evaluation/run_geometry.py`'s "Track 2").

No new images were added for Milestone 4 — the existing Milestone 3 dataset already
covers the face/pose orientation variety this milestone's evaluation needs (frontal,
45-degree turn, one/both ears hidden, hands visible/hidden, low light, blurred, no
person, multiple faces), and reusing it means Milestone 4's evaluation is directly
comparable to Milestone 3's own recorded findings for the same images.
