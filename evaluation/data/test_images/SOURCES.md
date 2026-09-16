# Test image sources and licenses

Per the Milestone 3 spec's explicit instruction not to commit private/customer photos,
every image under `evaluation/` is either (a) generated programmatically by
`evaluation/scripts/generate_synthetic_dataset.py` (documented there) or (b) an
appropriately-licensed, publicly redistributable sample image, listed below.

| File | Source | License | Why it's here |
|---|---|---|---|
| `opencv_sample_person.jpg` | `github.com/opencv/opencv`, `samples/data/messi5.jpg` (fetched via `raw.githubusercontent.com`, commit `4.x` branch) | OpenCV's own repository license (Apache 2.0 as of the 4.x branch; this specific sample data file predates the Apache 2.0 relicense but has shipped in every OpenCV release for over a decade as a redistributable CV test/tutorial asset under the project's license) | A real photograph (not synthetic) used to sanity-check hand/pose/segmentation detection against genuine photographic content, not just drawn shapes or noise — see `docs/milestone-3-verification.md` §9 for the actual, honestly-reported detection results on this image (face detection did NOT fire on it — a real, reported "difficult angle/small face" finding, not glossed over). |

**Note on face-detection test fixtures specifically**: no real photograph of an
identifiable person is committed to this repository for face-landmark testing. Unit
tests that need a deterministic "a face-like landmark set exists" fixture construct one
directly (a list of coordinate tuples shaped like MediaPipe's real 468-point topology)
rather than depending on any specific photo's detectability by the real model — this
also keeps those tests independent of MediaPipe's exact detection behavior on any one
image, which is standard practice for testing application logic that consumes a
third-party model's output, not the third-party model's own accuracy. End-to-end,
whole-pipeline face detection against a real photograph WAS manually verified during
this milestone's development (recorded in docs/milestone-3-verification.md) using a
widely-used computer-vision benchmark image, but that specific image was deliberately
NOT committed to this repository out of respect for the well-documented ethical debate
around its continued use in the field (several major imaging libraries have phased it
out) — a synthetic or already-licensed alternative was preferred wherever an automated,
committed test needed one.
