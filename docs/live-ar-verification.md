# Live AR Verification — Milestone 5

This records exactly what was verified in this development sandbox, how, and what
explicitly still requires verification on a real device/browser (this sandbox has no
camera and cannot reach the domains MediaPipe's model files are hosted on). No number or
result below is fabricated; where something could not be checked, it says so.

## What this sandbox CAN verify, and did

### Automated unit/integration tests

All of `apps/web/src/lib/live-ar/*` (except the parts that require a real camera or a
real network-fetched ML model) is unit-tested with Vitest:

| File | What it tests |
|---|---|
| `coordinates.test.ts` | normalized→pixel conversion, the mirror-transform helper, and a regression guard that `denormalize()` has no hidden "mirrored" parameter |
| `body-reference.test.ts` | shoulder reference frame math, mirrors `ai/tests/test_body_reference.py`'s fixtures exactly |
| `geometry.test.ts` | anchor/scale/rotation for both categories, the dispatcher, `buildLiveTransform`, `planCategoryRenders`, and a regression test using the real production render's recovered landmark coordinates from this session's earlier necklace-rotation bug fix |
| `asset-cache.test.ts` | alpha-bounding-box pixel scan (via a stubbed canvas context) and its failure mode on a fully-transparent image |
| `smoothing.test.ts` | EMA convergence, angle-wrap handling, reset behavior |
| `tracking-state.test.ts` | the full GOOD→DEGRADED→LOST→GOOD cycle, timing boundaries, and that a lost track never re-freezes at a nonzero opacity |
| `readiness.test.ts` | NECKLACE/EARRINGS READY/DEGRADED/NOT_READY thresholds |
| `renderer.test.ts` | the exact sequence and parameters of Canvas 2D calls (translate→rotate→scale→drawImage), opacity clamping, mirroring |
| `camera.test.ts` | `getUserMedia` error-code classification (mocked `navigator.mediaDevices`) |
| `tracking.test.ts` | the pure MediaPipe-result → internal-type conversion functions, given hand-built result objects |
| `performance.test.ts` | FPS/percentile computation from real recorded sample arrays, the rolling window, the spec's example overlay format |

**Result:** 99/99 tests pass (`npx vitest run src/lib/live-ar`), and the full frontend
suite (including all pre-existing Milestone 1–4 tests plus the new Live AR ones) passes
at 138/138 (`npx vitest run`). None of these numbers are estimates — they are the actual
output of running the test suite in this sandbox on 2026-09-18.

### Type checking and build

`npx tsc --noEmit -p tsconfig.json` passes with zero errors across the whole frontend,
including every new Live AR file. `npm run build` (Next.js production build) succeeds
and the new `/try-on/live` route compiles and statically prerenders alongside the
existing routes — confirming the new page doesn't crash during Next.js's build-time
render pass, though this is not the same as verifying real runtime camera/browser
behavior (see below).

### Backend

The new `POST/GET /api/v1/live-ar/captures` endpoints, the `LiveArCapture` model, and the
additive migration were run against this sandbox's native Postgres/Redis/MinIO-compatible
(moto) stack: `alembic upgrade head` applies cleanly, and `pytest apps/api/tests` passes
86/87 (1 honest `skip` — a "rings" category isn't seeded in this environment's catalogue
fixtures, so that one negative-path test for an unsupported category skips rather than
fabricating a category that doesn't exist here). The full pre-existing API suite
(the other 81 tests from Milestones 1–4) still passes unchanged.

## What this sandbox CANNOT verify, and why

This is not a hedge — these are genuine, structural limitations of a headless cloud
sandbox with no camera and a restricted network, listed so nothing here is mistaken for
having been checked when it wasn't:

- **Real camera permission flow** (`getUserMedia` prompt, grant, deny, no-camera,
  already-in-use). `camera.test.ts` verifies the error-classification logic against a
  *mocked* `navigator.mediaDevices`, not a real browser permission dialog.
- **Real MediaPipe model loading.** `tracking.ts`'s `createLiveTrackers()` fetches WASM
  and `.task` model files from `cdn.jsdelivr.net`/`storage.googleapis.com` at runtime.
  This sandbox's network cannot reach `storage.googleapis.com` (the same restriction
  that blocked server-side MediaPipe Tasks API calls during Milestone 3's work) — so
  this call has been verified for correct TypeScript usage against the library's
  published types and API shape, never against an actual successful model load.
- **Real-world tracking accuracy** — whether the face/pose landmarks MediaPipe actually
  returns for a real face, at a real webcam's resolution and lighting, produce a
  believable earring/necklace placement. All of the anchor/scale/rotation math is tested
  against synthetic landmark fixtures, which prove the *math* is correct for given
  inputs, not that MediaPipe's real outputs will look right on a real face.
- **On-screen mirroring correctness** in an actual browser — `coordinates.test.ts`
  proves the *logic* has no per-point mirroring path, but seeing an actual left earring
  render on an actual left ear on an actual mirrored preview has not been observed.
- **Real frame rate / device performance.** No FPS, latency, or dropped-frame number for
  a real camera on real hardware exists yet — `performance.test.ts` only proves the
  *aggregation math* is correct given synthetic timing samples. The spec's 24fps-minimum/
  30fps-preferred targets have not been measured on any real device (desktop, laptop, or
  mobile) because no camera exists in this sandbox to generate frames with.
- **Cross-browser compatibility** (Chrome, Edge, Safari) — untested here; the Canvas 2D
  APIs and MediaPipe Tasks-Vision are both widely supported, but this has not been
  confirmed by actually running the app in each browser.
- **The 12 visual test scenarios** the spec lists (frontal, move left/right/closer/
  farther, turn head, move shoulders, leave/return frame, change jewellery/category,
  camera permission denied) — none of these can be performed without a camera and a
  human face in front of it.

## What still needs to happen (on a real machine, with a camera)

1. Run `npm run dev` (or the built app) in an actual browser with camera access, confirm
   the permission prompt and each `CameraError` path (deny, no device, in-use).
2. Confirm the MediaPipe model files actually load over the real network (they should,
   from a normal consumer connection — this sandbox's restriction does not apply to a
   typical developer or user machine).
3. Try on both earrings and a necklace, moving/turning naturally, and confirm: no
   left/right earring swap, no upside-down or backwards jewellery, smooth (not jittery,
   not laggy) tracking, correct TRACKING_DEGRADED/LOST behavior when stepping out of
   frame, and jewellery switching with no camera restart.
4. Record real FPS/tracking/render timings via the in-app performance overlay on at
   least one normal and one lower-performance device, and update
   `docs/live-ar-architecture.md`'s "Known limitations" with the real numbers (never
   invent them).
5. Test in Chrome, Edge, and Safari if available.
6. Perform an actual capture end-to-end (browser → `POST /api/v1/live-ar/captures` →
   confirm the signed URL round-trips a correct, unmirrored image).

This milestone's own git history (small, reviewable commits) and the automated test
suite are the artifacts a reviewer can check without a camera; the six items above are
what a reviewer WITH a camera and this app running locally should check next.
