# Model License Registry

Every model dependency introduced into `ai/` **must** be registered here before it is
wired into an engine, per docs/production-readiness.md risk #3. No weights are
downloaded yet in Milestone 1 — this table records the research decisions from
Milestone 0 (`docs/ai-research.md`, `docs/model-comparison.md`) so they are checked into
version control rather than living only in a conversation.

| Model | Version | Source | License | Commercial use | Checkpoint license verified | Date verified | Notes |
|---|---|---|---|---|---|---|---|
| MediaPipe Face Landmarker | current (Tasks API) | google-ai-edge/mediapipe | Apache 2.0 | ✅ Yes | ✅ | 2026-09-16 | Planned for Milestone 3/4 ear/nose/forehead anchors + head pose |
| MediaPipe Hand Landmarker | current (Tasks API) | google-ai-edge/mediapipe | Apache 2.0 | ✅ Yes | ✅ | 2026-09-16 | Planned for Milestone 5 ring placement |
| MediaPipe Pose Landmarker | current (Tasks API) | google-ai-edge/mediapipe | Apache 2.0 | ✅ Yes | ✅ | 2026-09-16 | Planned for Milestone 4/5 shoulder/neck/wrist anchors |
| MediaPipe Multiclass Selfie Segmenter | current (Tasks API) | google-ai-edge/mediapipe | Apache 2.0 | ✅ Yes | ✅ | 2026-09-16 | Planned for Milestone 6 hair/cloth occlusion masks |
| SAM2 | 2.1 | facebookresearch/sam2 | Apache 2.0 (code) | ⚠️ Verify checkpoint terms before use | ⚠️ Pending | — | **BLOCKED (Milestone 2):** selected in Milestone 0 for admin-only catalogue background removal, but not integrated — the checkpoint host (huggingface.co) returns a policy-level 403 from this project's build/runtime network egress, verified directly with `curl` (not assumed). Revisit if/when the checkpoint can be self-hosted or mirrored on a reachable host. `rembg`/U-2-Net (below) is the real, working substitute used for Milestone 2. |
| rembg | 2.0.59 | github.com/danielgatis/rembg | MIT | ✅ Yes | ✅ | 2026-09-16 | Fetched `LICENSE.txt` directly from the repo to confirm — MIT, no restrictions. Thin Python wrapper around ONNX inference; the actual model is U-2-Net (next row). Used for catalogue asset background removal (`ai/catalogue/background_remover.py`), admin-only path, CPU-only via onnxruntime. |
| U-2-Net (u2net.onnx) | v0.0.0 release asset | github.com/xuebinqin/U-2-Net (weights re-hosted by rembg's GitHub release) | Apache 2.0 | ✅ Yes | ✅ | 2026-09-16 | Fetched `LICENSE` directly from the model's own repo to confirm — Apache 2.0. Salient object segmentation, not jewellery-specific, but effective for "product on plain/simple background" catalogue photos, which is the realistic admin upload scenario. Not licensed or intended for the user-facing try-on path (out of scope for Milestone 2 regardless). |
| IDM-VTON | — | yisol/IDM-VTON | CC BY-NC-SA 4.0 | ❌ No | ✅ | 2026-09-16 | Reference/research only — excluded from this product |
| OOTDiffusion | — | levihsu/OOTDiffusion | CC BY-NC-SA 4.0 | ❌ No | ✅ | 2026-09-16 | Reference/research only — excluded |
| CatVTON | — | Zheng-Chong/CatVTON | CC BY-NC-SA 4.0 | ❌ No | ✅ | 2026-09-16 | Reference/research only — excluded |
| StableVITON | — | rlawjdghek/StableVITON | CC BY-NC-SA 4.0 | ❌ No | ✅ | 2026-09-16 | Reference/research only — excluded |

**Rule:** no PR may add a model import under `ai/` or `ai/models/` without a corresponding
row in this table, including the "date verified" and a link/citation for the license
claim. A row with an unresolved "⚠️ Verify" status blocks that model from being used in
a production code path (admin-only offline tooling is the one exception, and only if the
risk is explicitly called out in the PR description).
