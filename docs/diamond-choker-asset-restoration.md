# Diamond Choker Asset Restoration (Phase H)

**The original, detailed Diamond Choker 2D asset is restored as the customer-facing
representation.** The procedural 3D prototype from Phases D–G still exists,
still works, and is still tested — it is simply no longer reachable from the
customer-facing render path. This was a real-person test result, not a theoretical
concern: the procedural model (plain gold band, one dome pendant, cone drops)
was shown live against a real camera and correctly judged unacceptable as a
stand-in for the actual jewellery.

---

## 1. What changed

Phase E introduced `GLTF_3D_ASSET_REGISTRY` in `three-live-bridge.ts`: a single
entry mapping the Diamond Choker's real `jewelleryId` to Phase D's procedurally-
generated GLB. `resolveGltf3dAssetMetadata(jewelleryId)` returned that entry
unconditionally whenever it existed, and `useLiveArSession.ts`'s render loop
preferred the 3D path over the 2D sprite whenever `resolveGltf3dAssetMetadata`
returned non-null. The moment that registry entry existed, EVERY live session for
that one item switched from the original 2D PNG to the procedural GLB — with no
gate, no review step, no "is this actually a good representation" check anywhere
in between.

---

## 2. Why it was wrong

The procedural GLB was always documented (Phase D onward) as a "parametric
approximation," explicitly built to validate the rendering/attachment/occlusion
*pipeline* — never claimed to be an accurate depiction of this specific piece's
real appearance. Phases E/F/G's own reports repeatedly noted this. What was
missing was a **gate**: nothing stopped that prototype-status asset from silently
becoming the thing an actual customer session displayed. A real-person test
showed exactly the failure this should have prevented: a plain gold band, dome,
and cone shapes, poorly positioned, shown in place of the actual ornate diamond
choker.

---

## 3. Which original asset was restored

Nothing was restored *to* a different file — nothing was ever changed, deleted, or
overwritten. The original Diamond Choker catalogue asset (`jewellery/
b68b76b3-55ba-4808-869c-4d8266f7aff7/processed/4a524118-bc8d-4305-a5a0-
dec74c23b267.png` on Backblaze B2, the same file examined in the very first Phase A
audit) was never touched by any phase of this work. "Restoration" here means
restoring the *code path* that makes the live session use it again.

---

## 4. What was changed to restore it

One file: `apps/web/src/lib/live-ar/three/three-live-bridge.ts`.

- `GLTF_3D_ASSET_REGISTRY`'s value type changed from `Gltf3dAssetMetadata` to
  `{ status: "production_verified" | "procedural_prototype"; metadata:
  Gltf3dAssetMetadata }`.
- The Diamond Choker's entry is now explicitly `status: "procedural_prototype"`.
- `resolveGltf3dAssetMetadata` — the one function every customer-facing call site
  goes through (`loadLive3dJewelleryAsset`, called only from `useLiveArSession.ts`)
  — now returns `null` for any entry that is not `"production_verified"`. Today,
  that means it returns `null` for every item in the vault, Diamond Choker
  included, which is the honest current state: no production-verified 3D asset
  exists for anything yet.
- A new function, `resolveProceduralPrototypeMetadata`, returns an entry's metadata
  regardless of status — used only by this module's own tests, never by
  `useLiveArSession.ts` or any other customer-facing code.

This is a **generic** rule ("procedural prototypes are never customer-facing"),
not a special case for Diamond Choker — `resolveGltf3dAssetMetadata` contains no
`if (jewelleryId === ...)` anywhere, before or after this change. Any future item
added to the registry is `"procedural_prototype"` by default in spirit; only a
deliberate `"production_verified"` entry, added when someone has actually reviewed
the asset, would ever reach a real customer session.

**Effect on `useLiveArSession.ts`**: none — that file was not touched. Its 3D block
is already structured as `if (asset3d && trackedCategoryFor3d === "necklace")`,
where `asset3d = loaded3dAssetRef.current`. With `resolveGltf3dAssetMetadata` now
returning `null`, `loadLive3dJewelleryAsset` returns `null`, `asset3d` is `null`,
and the entire 3D block is skipped — falling through to the existing, unmodified
2D occlusion/render path exactly as it worked before Phase E ever existed.

---

## 5. What procedural 3D infrastructure was preserved

Everything. Nothing was deleted:

- `apps/web/src/lib/jewellery-3d-generator/` (Phase D) — the entire generic
  specification/curve/primitive/component/material/GLB-export system, untouched.
- `three-asset-loader.ts`, `three-camera.ts`, `three-scene.ts`, `three-renderer.ts`,
  `three-transform.ts` (M6.8/Phase E) — untouched.
- `head-pose.ts`, `body-attachment.ts`, `neck-surface-3d.ts` (Phases F/G) —
  untouched.
- `three-live-bridge.ts`'s own render functions (`renderLive3dFrame`,
  `renderSurfaceAttachedFrame`, `computeLive3dTransform`,
  `computeSurfaceAttachedTransform`) — untouched; still real, still callable,
  still tested.
- `resolveProceduralPrototypeMetadata` (new) is the generator's own supported way
  to keep exercising this real pipeline for engineering purposes.
- `apps/web/public/generated-3d-assets/diamond-choker.glb` — the real, generated
  file — was not deleted.

All 560 tests across `src/lib/live-ar` + `src/lib/jewellery-3d-generator` still
pass, including every Phase D–G test that exercises this infrastructure directly.

---

## 6. How production assets differ from procedural prototypes

| | `"procedural_prototype"` | `"production_verified"` |
|---|---|---|
| Source | Phase D's generic generator, from a measurement spec | A real, reviewed 3D asset |
| Visual accuracy | Not claimed, not reviewed | Confirmed to actually look like the piece |
| Customer-facing? | **Never**, by construction | Yes, once marked |
| Purpose | Prove the rendering/attachment/occlusion pipeline works | Show the customer the real item in 3D |
| Where it's reachable | `resolveProceduralPrototypeMetadata` (dev/test only) | `resolveGltf3dAssetMetadata` (customer path) |

Promoting an item from prototype to production-verified is a one-line change
(flip its `status`) — but is a **human decision**, not something a generator run
should ever do on its own.

---

## 7. Current Diamond Choker representation

Customer-facing Live AR: the original detailed 2D PNG, rendered through the
existing, unmodified 2D pipeline (anchor/scale/rotation/occlusion — all pre-Phase-E
code, never touched by any of this). Exactly the "before" behavior.

The procedural 3D prototype remains registered, tested, and loadable via
`resolveProceduralPrototypeMetadata`/`loadLive3dAssetFromMetadata` for engineering
use — it is not customer-visible.

---

## 8. Future migration path to a real detailed GLB

Unchanged from what Phase D's own `docs/jewellery-3d-asset-spec.md` already
specified: a real 3D asset — modeled from actual measurements/CAD or multiple real
reference photographs by an artist, not generated from a single front-facing PNG —
would be added to the registry with `status: "production_verified"` once someone
has looked at it rendered live and confirmed it actually represents the piece. No
code change beyond that one status flip would be needed; `resolveGltf3dAssetMetadata`
already prefers the same shape either way.

---

## Test results (Step 11)

1–6. Verified via the updated unit test suite (`three-live-bridge.test.ts`):
`resolveGltf3dAssetMetadata(DIAMOND_CHOKER_ID)` now returns `null` (restoration
confirmed at the exact function every render call site uses); `useLiveArSession.ts`
was not modified, so its existing "fall back to 2D when no 3D asset resolves"
branch — already tested — is what runs.
7. 2D fallback: unchanged code, unchanged tests, all passing.
8–9. Procedural engine + GLB tests: `resolveProceduralPrototypeMetadata` still
resolves the real entry; all Phase D–G tests for the generator/pipeline pass
unchanged.
10–13. `tsc`, `eslint`, `next build`, and the full `src/lib/live-ar` +
`src/lib/jewellery-3d-generator` suite all run clean (see status block).

---

## PHASE H STATUS

**Original Diamond Choker restored:** PASS

**Procedural engine preserved:** PASS

**2D fallback preserved:** PASS

**All tests:** PASS — 560/560 (3 new/updated in `three-live-bridge.test.ts`, zero regressions)

**TypeScript:** PASS

**Build:** PASS (same 7 routes/8 pages)

**Lint:** PASS (zero new findings)
