# Model Comparison — Jewellery Virtual Try-On

Legend: ✅ commercial-safe · ⚠️ verify/limited · ❌ non-commercial

## Landmark / pose detection

| Model | Purpose | License | GPU/VRAM | Latency (single image) | Commercial | Notes |
|---|---|---|---|---|---|---|
| MediaPipe Face Landmarker | 478-pt face mesh, head pose, ear/nose/forehead region | Apache 2.0 | CPU-only viable | 10–40 ms | ✅ | Google-maintained, very stable API |
| MediaPipe Hand Landmarker | 21-pt hand/finger skeleton | Apache 2.0 | CPU-only viable | 10–30 ms | ✅ | Needed for ring placement |
| MediaPipe Pose Landmarker | shoulders/neck/wrist | Apache 2.0 | CPU-only viable | 15–40 ms | ✅ | Needed for necklace/bangle/haaram |
| YOLOv8/v11-pose (Ultralytics) | alt. body pose, higher accuracy at cost of GPU | AGPL-3.0 *or* paid Ultralytics Enterprise license | GPU preferred | 20–50 ms (GPU) | ⚠️ | AGPL requires open-sourcing derivative *or* buying a commercial license — avoid unless budget allows the license, MediaPipe covers MVP needs |

## Segmentation / matting

| Model | Purpose | License | GPU/VRAM | Latency | Commercial | Notes |
|---|---|---|---|---|---|---|
| MediaPipe Multiclass Selfie Segmenter | hair/skin/clothing masks for occlusion | Apache 2.0 | CPU viable | 20–50 ms | ✅ | Good enough for MVP occlusion layering |
| SAM2 (Meta) | promptable segmentation, admin asset cutouts, high-quality occlusion mattes | Apache 2.0 (code); verify checkpoint terms | GPU, ~4–8 GB VRAM (base/large) | 100–400 ms (GPU) | ✅ (verify checkpoint) | Best for catalogue asset background removal (offline/admin path, latency not user-facing) |
| BiRefNet / RMBG-family matting nets | fine hair-strand matting | Varies by release (check per checkpoint, some Apache/MIT, some CC-BY-NC) | GPU, 2–4 GB | 100–300 ms | ⚠️ | Nice-to-have for Milestone 6 hair-occlusion polish; pick a specific Apache/MIT checkpoint at implementation time |
| Depth Anything V2 (small/base) | optional depth for 3D-aware placement | Apache 2.0 (small/base) | GPU, 1–3 GB | 50–150 ms | ✅ | Post-MVP; large checkpoint may carry different terms — verify |

## Generative / diffusion try-on (reference only — NOT used for MVP placement)

| Model | License | Commercial | Why excluded from MVP |
|---|---|---|---|
| IDM-VTON | CC BY-NC-SA 4.0 | ❌ | Research-only license; also garment-shaped, not accessory-shaped |
| OOTDiffusion | CC BY-NC-SA 4.0 | ❌ | Same |
| CatVTON | CC BY-NC-SA 4.0 | ❌ | Same |
| StableVITON | CC BY-NC-SA 4.0 | ❌ | Same |
| VITON-HD / HR-VITON (+ datasets) | CC BY-NC-SA 4.0 (code and training data) | ❌ | Any model fine-tuned on these datasets inherits the non-commercial restriction even if the code license differs |
| DCI-VTON | MIT | ✅ (license only) | Commercial-safe license, but still a full-body garment model; not validated for small rigid jewellery objects — candidate for future R&D, not MVP |
| ViViD | Apache 2.0 | ✅ (license only) | Same caveat as DCI-VTON |
| Hosted commercial image-edit APIs (e.g., FASHN VTON API, Google/OpenAI image-edit endpoints) | Commercial ToS, per-call pricing | ✅ (contractual) | Usable later for an optional "AI polish" pass on a masked, jewellery-protected region; per-request cost and no product-identity guarantee out of the box |

## Recommendation

- **MVP placement engine = geometry/AR compositing**, built entirely on Apache-2.0 CV components
  (MediaPipe + in-house warp/composite/shadow code). Zero licensing risk, zero per-inference GPU
  cost for the hot path.
- **SAM2** used only in the *admin* asset-processing pipeline (background removal for catalogue
  uploads) and, later, as an optional higher-quality occlusion matting step — both are not on the
  user-facing critical latency path.
- **No generative VTON checkpoint is used for MVP.** Revisit in Milestone 6 with a scoped,
  commercially licensed hosted API for a *harmonization-only* pass, with the jewellery pixels
  hard-masked from regeneration, once we have real evaluation data to justify the added cost/latency.
