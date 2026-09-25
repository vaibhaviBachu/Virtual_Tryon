# Generic AR Jewellery Attachment — Review & Reconciliation

This request re-specified a generic neck-attachment pipeline (tracking → anchor →
scale → orientation → occlusion → debug → performance → tests). Auditing against
the actual repository first (rather than reimplementing blind) found that **7 of
the 8 steps already exist**, built across Phases E–G. This document maps every
requested step to its real status, reconciles two suggestions that would have been
regressions, and describes the small set of genuinely new work done this phase.

**Note on naming**: the previous commit was already labeled "Phase H" (the Diamond
Choker asset restoration). This work continues immediately after it; no separate
phase letter is claimed here to avoid a collision in the git history.

---

## Step-by-step reconciliation

### 1. "Enable MediaPipe Face and Pose tracking... output_facial_transformation_matrixes=true"

**Already done, Phase F.** `tracking.ts`'s `createLiveTrackers` already sets
`outputFacialTransformationMatrixes: true`, real-browser-verified to initialize
correctly (docs/true-body-surface-jewellery-attachment.md §5, §12).

**"Use PoseLandmarker... segmentation mask" — investigated, not adopted.**
Confirmed real in the installed package (`PoseLandmarkerOptions.
outputSegmentationMasks`, `PoseLandmarkerResult.segmentationMasks`) — but it is a
single-class person/background mask. The existing `segmentation.ts` already uses a
**separate, genuinely multi-class** `ImageSegmenter` (confirmed via
`occlusion.ts`'s `HAIR_CATEGORY = 1`, `CLOTHES_CATEGORY = 4`, distinct background/
skin categories), which is what makes the existing occlusion rule possible at all
("hair occludes; clothing occludes only below the attachment line; skin never
does"). Switching to PoseLandmarker's own mask would **lose that per-category
distinction** — a real regression, not a simplification. Kept the existing
multi-class `ImageSegmenter` unchanged.

### 2. "Compute neck anchor: shoulder midpoint + chin height + downward offset"

**Already done, since M6.2 (`neck-reference.ts`).** `computeNeckReferenceFrame`
interpolates between the real, measured chin-proxy (face bounding box bottom) and
the real shoulder midpoint — not a fixed offset, a per-frame measurement. This is
the same mechanism the request describes, already real and already tested. No
change made.

### 3. "Scale necklace... anthropometric ratios (e.g. neck width ~0.4× shoulder width)"

**Existing approach kept; the suggested ratio was evaluated and not substituted
in.** Two different things were being conflated:

- **The jewellery's own on-screen size** is already computed from the item's REAL
  `physicalWidthMm` (catalogue data) calibrated against the tracked shoulder width
  (`computeScale`'s `physical_mm_via_shoulder_width_calibration`, unchanged since
  M6.2/M6.5). This is *more* accurate than a generic ratio: it scales the actual
  item to its actual real-world size, not a generic "typical neck" placeholder.
- **A separate, already-existing neck-width ESTIMATE** (`neck-reference.ts`'s
  `NECK_WIDTH_FRACTION_OF_FACE_WIDTH = 0.8`, i.e. 80% of measured face width, not
  shoulder width) already feeds Phase G's `radiusXMm` surface estimate.

Replacing either of these with "neck width = 0.4× shoulder width, then scale the
necklace to match" would have **thrown away the item's own real physical
dimensions** in favor of a cruder generic guess — a regression in accuracy, not an
improvement. Documented here as a real, considered decision; no code changed.

### 4. "Orientation: apply head yaw/pitch... keep existing roll"

**Already done, exactly as described, Phase F/G.** `resolveNeckAttachmentOrientation`
(`body-attachment.ts`): roll from real shoulder-line tilt (unchanged since M6.4),
yaw+pitch from the real facial transformation matrix (Phase F), with a documented
2D-proxy fallback. No change made.

### 5. "Occlusion: composite using person mask; hair/clothes fully occlude"

**Already done, and already more capable than the request's own suggestion** (see
Step 1). Phase G additionally improved this to check the 3D render's own real
alpha (`applyRenderedAlphaToOcclusionMask`), not just the coarse category mask.
No change made this phase.

### 6. "Testing hooks: debugEnabled overlay drawing neck-surface and anchor point"

**Already done, Phase G.** `drawNeckSurfaceDebugOverlay` draws the neck ellipse
outline, its normal, and the jewellery's attachment point, gated behind the
existing `debugEnabled` toggle. No change made.

### 7. "Performance check... simplify geometry or lower detection frequency if needed"

**Measured and documented; no change needed.** Real numbers already established:

| Metric | Diamond Choker prototype | Budget (docs/jewellery-3d-asset-spec.md) |
|---|---|---|
| Triangles (authored) | 944 | <20,000 |
| Draw calls (real render, incl. transmission pass) | 16 | — |
| Segmentation cadence | 500ms (`SEGMENTATION_INTERVAL_MS_DEFAULT`, unchanged since M6.3) | — |

Both are comfortably within budget — no simplification is warranted. **No physical
mobile device was tested on** (none is available in this environment); this is
stated plainly rather than claimed. Regardless of this measurement, the 3D
attachment path is currently NOT customer-facing (see below), so this has no
live-performance impact today.

### 8. "Clean-up: no new dependencies; unit tests for transform math; update
jewellery-representation.ts and three-live-bridge.ts as needed"

**Genuinely new work this phase** — a real, useful cleanup:

- `Gltf3dAssetMetadata` (`jewellery-representation.ts`) gained one field:
  `productionVerified: boolean`. `resolveJewelleryRepresentation` now treats an
  unverified `gltf3dAsset` exactly like no `gltf3dAsset` at all.
- `three-live-bridge.ts`'s registry no longer needs its own parallel status
  wrapper (added in the previous restoration commit) — it now stores plain
  `Gltf3dAssetMetadata` objects and reads `.productionVerified` directly. **One
  real field, checked in exactly two places** (`resolveGltf3dAssetMetadata` and
  `resolveJewelleryRepresentation`), never two independent gating mechanisms that
  could silently drift apart from each other.
- The Diamond Choker's registry entry is `productionVerified: false` — unchanged
  in effect from the previous restoration, now expressed as one shared field
  instead of a bespoke enum.
- New integration test (`neck-attachment-integration.test.ts`): composes the real
  chain — `computeNeckReferenceFrame` → `resolveAttachmentOrientation` →
  `computeSurfaceAttachedTransform` → `computeNeckSurfaceFrame` → `neckSurfacePointAt`
  — with realistic (non-degenerate) shoulder/chin landmark proportions, proving the
  pieces compose correctly the way `useLiveArSession.ts`'s real render loop
  actually calls them. Previously, each piece was only tested in isolation.
- No new dependencies were added anywhere in this phase.

---

## What this phase did NOT do

- Did not re-enable the 3D path as customer-facing. `productionVerified` remains
  `false` for the Diamond Choker — the customer session still shows the original
  2D asset, exactly as the prior restoration established. Nothing in this request
  asked for that to change, and nothing here changes it.
- Did not implement a mobile-device performance test (no device available).
- Did not adopt PoseLandmarker's own segmentation mask or the 0.4×-shoulder-width
  ratio — both evaluated and rejected with reasoning above, not silently ignored.

---

## Test / build results

- 4 new tests (2 in `jewellery-representation.test.ts`, 2 in the new
  `neck-attachment-integration.test.ts`), plus fixture updates across
  `three-live-bridge.test.ts` and `jewellery-3d-generator/integration.test.ts` for
  the new `productionVerified` field.
- **564/564** passing across `src/lib/live-ar` + `src/lib/jewellery-3d-generator`.
- `tsc`, `eslint`, and `next build` all clean, zero new findings.
- No new dependencies.
