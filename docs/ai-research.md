# AI / Computer Vision Research — Jewellery Virtual Try-On

Status: Milestone 0 research. No code has been written yet.

## 1. Why jewellery try-on is a different problem than garment try-on

Almost all public "virtual try-on" research (IDM-VTON, OOTDiffusion, CatVTON, StableVITON, VITON-HD)
targets **garments** on a full-body photo: the model is trained to *repaint a large masked region*
(torso/legs) with a new clothing texture while keeping the person's pose. That is a good fit for
diffusion because the garment is expected to deform with the body and full pixel-level regeneration
of a big region is tolerated.

Jewellery is the opposite shape of problem:

- The item occupies a **tiny fraction of the frame** (a stud earring might be 20×20 px in a
  1024×1024 photo) but must be reproduced **exactly** — a customer trying on a specific SKU needs to
  see *that* piece, not "a plausible similar piece." Diffusion models are notorious for not
  preserving fine small-object identity (this is the same failure mode as diffusion models
  mangling text or hands).
- Placement is **rigid-body geometry**, not deformation: an earring hangs from the earlobe under
  gravity, a necklace drapes on the clavicle, a bangle sits perpendicular to the wrist axis, a ring
  wraps a cylindrical finger. These are 3D pose/anchor problems, closer to AR try-on (think Snap/Meta
  Spark lens tech) than to garment-diffusion.
- Occlusion is **local and high-frequency**: individual hair strands crossing an earring wire,
  a shirt collar crossing a necklace chain, fingers occluding a ring. Garment-VTON occlusion
  handling (big binary body/garment masks) is too coarse for this.

**Conclusion of research:** treat this as an **AR/geometric compositing problem first**, with
generative AI used narrowly for *refinement* (blending, relighting, occlusion clean-up) rather than
as the primary placement mechanism. This matches the spec's instruction not to assume "an
LLM/image generation model alone is sufficient."

## 2. Candidate approaches evaluated

### A. Pure 2D AR / geometric compositing
Detect landmarks (ear, neck, wrist, finger) → estimate scale/rotation/perspective from landmark
geometry → warp the (pre-cutout, transparent-background) jewellery PNG/mesh → alpha-composite onto
the photo → add a synthetic soft shadow and a light multiply/screen pass to approximate the scene's
lighting.

- **Pros:** deterministic, fast (CPU/low-GPU, <300 ms), perfect identity preservation (it's the real
  asset image), cheap to run at scale, fully explainable/debuggable, easy to unit-test (scale error,
  angle error are measurable numbers).
- **Cons:** realism ceiling is lower — flat compositing looks "sticker-like" without careful shadow/
  light matching; occlusion (hair over earring, collar over necklace) requires a separate
  segmentation/matting step or it looks obviously fake; doesn't handle extreme head/body angles well
  without a decent 3D head/hand model.
- **This is the correct MVP core.** It is the only approach that guarantees jewellery-identity
  preservation, which the spec calls a hard requirement ("never compromise jewellery identity").

### B. Full generative AI try-on (diffusion inpainting / VTON models)
Mask the target region and let a diffusion model (IDM-VTON-style architecture, or a general
image-editing model such as SD/Flux inpainting or a hosted "nano-banana"/Gemini-image-style edit
API) regenerate the jewellery directly onto the photo from a reference image + text prompt.

- **Pros:** potentially highest photorealism for lighting/shadow/skin interaction "for free," no
  landmark/segmentation engineering needed for the visual blend itself.
- **Cons:** does **not** reliably preserve exact product identity (gemstone cut, exact metal color,
  engraving, stone count can drift) — unacceptable for a jewellery e-commerce use case where the
  customer must see the actual SKU; most published jewellery-adjacent checkpoints are academic
  research releases (see model-comparison.md) with **non-commercial licenses**; hosted commercial
  APIs (e.g., Google Gemini image editing, OpenAI image edit, fashion-specific SaaS like FASHN) are
  usable but priced per call and still don't guarantee small-object fidelity for accessories the way
  they do for garments.
- **Verdict:** not viable as the primary mechanism; potentially useful later as an optional
  "AI enhance" pass on top of the geometric result (e.g., feeding the already-composited image
  through an image-to-image "harmonization" pass at low strength to blend shadow/color grading only,
  never to regenerate the jewellery pixels themselves).

### C. Hybrid (recommended)
```
photo → face/hand/body landmark detection → person/hair/cloth segmentation & matting
      → per-category anchor + pose estimation → geometric warp & placement of the *real* jewellery
        asset → occlusion compositing (hair/cloth/fingers drawn back over the jewellery per
        segmentation) → lighting/shadow synthesis (estimated scene light direction + soft shadow +
        AO) → optional low-strength generative harmonization pass (color/shadow blending only,
        jewellery region protected by a hard mask so pixels are never regenerated) → final image
```
This matches the spec's own "Hybrid Architecture" section almost exactly and is the industry
direction: mall AR mirrors and mobile AR try-on (Snap Lens Studio, banuba, Perfect Corp/YouCam,
L'Oréal ModiFace-type systems) all use landmark+geometry+segmentation pipelines for accessories,
reserving generative AI for skin retouching / lighting polish, not for the product itself.

**Decision: build the Geometry engine as the real MVP deliverable (Milestones 4–6). Design the
`TryOnEngine` abstraction so a `GenerativeTryOnEngine` and `HybridTryOnEngine` can be added later
without touching the API/DB/frontend.**

## 3. Computer-vision building blocks evaluated

| Need | Candidate | License | Notes |
|---|---|---|---|
| Face landmarks (ear, jaw, forehead/hairline, nose) | **MediaPipe Face Landmarker (478 pts)** | Apache 2.0 | Runs on CPU in real time; gives stable 3D-ish landmarks incl. ear region approximation and head pose (rotation matrix) needed for earring/maang-tikka/nose-ring rotation. |
| Hand/finger landmarks (ring placement) | **MediaPipe Hand Landmarker** | Apache 2.0 | 21-point hand skeleton, gives finger segment vectors for ring rotation + width estimate. |
| Body/shoulder/wrist pose (necklace, bangle, haaram) | **MediaPipe Pose Landmarker** | Apache 2.0 | Shoulder/neck/wrist keypoints; sufficient for MVP anchors. |
| Person / hair / clothing segmentation (occlusion) | **MediaPipe Image Segmenter (multiclass selfie)** for MVP; **SAM2** for admin-side asset cutouts and higher-end occlusion mattes | Apache 2.0 (both) | MediaPipe multiclass selfie segmenter ships hair/skin/clothing classes out of the box and is fast enough for the sync/near-real-time path. SAM2 is heavier (needs a GPU for good latency) — reserve for catalogue asset processing (background removal) and for a higher-quality "Pro" occlusion pass, not the hot path. |
| Background removal for catalogue jewellery photos | **SAM2** (promptable) or a lightweight matting net (e.g., **BiRefNet**, MIT-family license — verify per release) | Apache 2.0 (SAM2) | Admin-upload pipeline can afford a few seconds of GPU time; this is not user-facing latency. |
| Depth (optional, later) | **Depth Anything V2** | Apache 2.0 (small/base checkpoints); large checkpoint has a separate non-commercial research license in some releases — verify per checkpoint before use | Only needed later for finer 3D placement (e.g., necklace draping over a 3D neck curve); not required for MVP 2D compositing. |

All of the CV components chosen for the MVP hot path are **Apache-2.0, unambiguously commercial-
safe**. This directly satisfies the spec's rule "do not use a model with unclear commercial
licensing without flagging it."

## 4. Generative model landscape (for the later refinement / "Pro realism" pass only)

See `model-comparison.md` for the full table. Headline finding: **every well-known open-weight
garment-VTON checkpoint (IDM-VTON, OOTDiffusion, CatVTON, StableVITON, VITON-HD, HR-VITON) is
released under CC BY-NC-SA 4.0 or trained on CC BY-NC-SA datasets (VITON-HD/DressCode) — non-
commercial only.** Two exceptions exist (DCI-VTON: MIT; ViViD: Apache 2.0) but neither is
jewellery-specific and both are still garment-shape models, not validated for tiny rigid accessories.
Commercial hosted options (FASHN API, Google/OpenAI image-edit APIs) are commercially licensed but
priced per call and, per our reasoning in §2, are not trustworthy for exact product-identity
preservation without the geometric pipeline underneath them anyway. **Recommendation: do not depend
on any generative VTON checkpoint for MVP; revisit for the "AI polish" pass in Milestone 6 using
either (a) a commercially licensed hosted image-edit API restricted to a masked, jewellery-protected
region, or (b) a small in-house-trained harmonization model once we have real usage data.**

## 5. Risks and open items surfaced during research

1. **SAM2 checkpoint license nuance:** the SAM2 *code* is Apache 2.0, but confirm the exact
   checkpoint license text at integration time (Meta has in the past shipped some models under a
   bespoke "Meta license" with extra clauses) before shipping it in a commercial build.
2. **No public jewellery-specific placement dataset exists.** We will need to build our own small
   evaluation set (see `evaluation/` structure) — this was called out in the spec and is treated as
   a Milestone 0/3 deliverable, not an afterthought.
3. **Ear/finger/wrist landmark accuracy on real-world "in the wild" phone photos** (motion blur, hair
   covering ears, sleeves covering wrists) is a genuine open risk — MVP will need explicit
   "please retake photo" UX guidance (pose/occlusion pre-checks) rather than pretending every photo
   is usable.
4. **Non-frontal / extreme angle photos** (>45° head turn, hand at odd angle) degrade 2D compositing
   accuracy; MVP should constrain input guidance to front/±30° and treat wider angles as a
   post-MVP problem (this is explicitly listed as a milestone-gated limitation, not hidden).
