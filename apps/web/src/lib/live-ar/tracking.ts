/**
 * Real-time face/pose tracking via MediaPipe Tasks-Vision, run entirely in the browser.
 *
 * This is the "commercially appropriate MediaPipe solution" the Milestone 5 spec asks
 * for -- the browser-native `@mediapipe/tasks-vision` package's `FaceLandmarker` and
 * `PoseLandmarker` running in `VIDEO` mode against the live `<video>` element, NOT the
 * photo pipeline's server-side `ai/landmarks/face.py` / `ai/landmarks/pose.py` (those
 * run once per uploaded photo, in a worker process, via the Python MediaPipe bindings --
 * completely separate code paths, per the spec's "no per-frame server calls" rule and
 * "keep photo and live pipelines from becoming one accidental shared system").
 *
 * HONEST LIMITATIONS (documented, not silently smoothed over):
 * - FaceLandmarker's VIDEO-mode result does not expose a single scalar "detection
 *   confidence" the way the photo pipeline's face detector does -- Tasks-Vision only
 *   reports whether a face mesh was found at all for the frame. `detectionConfidence`
 *   below is therefore a real but coarse binary signal (1.0 when a face was found, 0
 *   when not), not a fabricated fine-grained score. Everything downstream
 *   (readiness.ts, geometry.ts) that treats it as a graded value degrades to a
 *   pass/fail check at that one point in the pipeline.
 * - PoseLandmarker DOES expose real per-landmark `visibility`, so
 *   `shoulderConfidence` here mirrors ai/landmarks/pose.py's own formula exactly
 *   (average of the two shoulder landmarks' visibility) -- this one is not degraded.
 * - The model/WASM assets these trackers load are fetched from Google's CDN at
 *   runtime (see `createLiveTrackers`'s `wasmBaseUrl`/model URLs) -- this requires the
 *   end user's own browser to reach that CDN. It could not be exercised inside this
 *   sandbox's network (the same restriction that blocked server-side MediaPipe Tasks
 *   API calls in Milestone 3), so initialization has been verified for correct
 *   TypeScript usage against the library's published types, not against a live model
 *   load -- that verification can only happen in a real browser (see
 *   docs/live-ar-verification.md).
 */
import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

import type { LiveFaceLandmarks, LivePoseLandmarks, NormalizedPoint } from "@/lib/live-ar/types";

const WASM_FILESET_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export interface LiveTrackers {
  faceLandmarker: FaceLandmarker;
  poseLandmarker: PoseLandmarker;
  close(): void;
}

/** Initializes both landmarkers once per Live AR session. Never call this per frame --
 * loading the WASM runtime and model files is a one-time, network-bound cost (spec
 * §12's "must not freeze the camera" concern applies here too: this should complete
 * before the render loop starts, with a loading state shown per spec §22). */
export async function createLiveTrackers(): Promise<LiveTrackers> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_FILESET_URL);

  const faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    // Phase F (docs/true-body-surface-jewellery-attachment.md): a real MediaPipe
    // Tasks-Vision option (confirmed present in the installed package's own type
    // definitions), previously available but unused. Gives a real 3D head
    // rotation+translation per frame (facialTransformationMatrixes below) instead of
    // the 2D landmark-asymmetry proxy this pipeline relied on exclusively before.
    outputFacialTransformationMatrixes: true,
  });

  const poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  return {
    faceLandmarker,
    poseLandmarker,
    close: () => {
      faceLandmarker.close();
      poseLandmarker.close();
    },
  };
}

/** Same models, but in Tasks-Vision's IMAGE running mode (`.detect()`, not
 * `.detectForVideo()`) -- for the static catalogue "model" preview (BotPreview.tsx),
 * which analyzes one fixed photo ONCE, not a per-frame video stream. Mixing modes
 * matters here: VIDEO mode requires monotonically increasing timestamps between calls
 * and is tuned for temporal smoothing across frames, neither of which applies to a
 * single still photo -- IMAGE mode is Tasks-Vision's own documented mode for this
 * exact case. A separate, independent set of landmarker instances from
 * createLiveTrackers() above (MediaPipe does not support switching an existing
 * instance's running mode). */
export async function createImageTrackers(): Promise<LiveTrackers> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_FILESET_URL);

  const faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
    runningMode: "IMAGE",
    numFaces: 1,
  });

  const poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
    runningMode: "IMAGE",
    numPoses: 1,
  });

  return {
    faceLandmarker,
    poseLandmarker,
    close: () => {
      faceLandmarker.close();
      poseLandmarker.close();
    },
  };
}

function toNormalizedPoints(landmarks: { x: number; y: number; z?: number; visibility?: number }[]): NormalizedPoint[] {
  return landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
}

/** Converts a raw FaceLandmarkerResult (this frame's `detectForVideo` call) into our
 * LiveFaceLandmarks shape. Returns null when no face was found -- callers treat that
 * exactly like the photo pipeline's FACE_NOT_VISIBLE case. */
export function toLiveFaceLandmarks(result: FaceLandmarkerResult): LiveFaceLandmarks | null {
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks || landmarks.length === 0) return null;

  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const point of landmarks) {
    if (point.x < xMin) xMin = point.x;
    if (point.x > xMax) xMax = point.x;
    if (point.y < yMin) yMin = point.y;
    if (point.y > yMax) yMax = point.y;
  }

  // Phase F: present only when outputFacialTransformationMatrixes was enabled
  // (createLiveTrackers, not createImageTrackers -- the static photo-preview path
  // has no use for a live head-pose signal) AND MediaPipe actually produced one for
  // this face this frame. `Matrix.rows`/`.columns` are checked, not assumed, before
  // trusting `.data` -- a defensive check against a future SDK shape change, not a
  // real observed failure.
  const rawMatrix = result.facialTransformationMatrixes?.[0];
  const faceTransformMatrix = rawMatrix && rawMatrix.rows === 4 && rawMatrix.columns === 4 ? rawMatrix.data : null;

  return {
    landmarks: toNormalizedPoints(landmarks),
    faceBoundingBox: { xMin, yMin, xMax, yMax },
    // See this module's docstring: Tasks-Vision VIDEO mode gives presence, not a
    // graded score, for FaceLandmarker specifically.
    detectionConfidence: 1.0,
    faceTransformMatrix,
  };
}

/** Converts a raw PoseLandmarkerResult into our LivePoseLandmarks shape. Returns null
 * when no pose was found. `confidence` mirrors ai/landmarks/pose.py's
 * `shoulder_confidence` formula exactly (average of the two shoulder landmarks' own
 * `visibility`, a real per-landmark score MediaPipe Pose does provide). */
export function toLivePoseLandmarks(result: PoseLandmarkerResult): LivePoseLandmarks | null {
  const landmarks = result.landmarks?.[0];
  if (!landmarks || landmarks.length <= 12) return null;

  const leftVisibility = landmarks[11].visibility ?? 0;
  const rightVisibility = landmarks[12].visibility ?? 0;

  return {
    landmarks: toNormalizedPoints(landmarks),
    confidence: (leftVisibility + rightVisibility) / 2,
  };
}

/** Runs both detectors for one video frame. `timestampMs` must be monotonically
 * increasing per MediaPipe's VIDEO-mode contract (use the same clock for both calls --
 * a video element's `currentTime * 1000`, or `performance.now()`, are both fine as
 * long as one choice is used consistently for the whole session).
 *
 * Also times each model separately (M6.4 real-device review, 2026-09-24, Step 12:
 * "Instrument separately: FaceLandmarker inference, PoseLandmarker inference... The
 * existing 'Tracking' timing appears to be the largest contributor. Determine exactly
 * what is inside Tracking = X ms.") -- folded into this one function rather than kept
 * as a second, nearly-identical implementation; callers that only need face/pose (not
 * the timing) can simply ignore the two extra fields. */
export function detectFrameWithTiming(
  trackers: LiveTrackers,
  video: HTMLVideoElement,
  timestampMs: number
): { face: LiveFaceLandmarks | null; pose: LivePoseLandmarks | null; faceDetectMs: number; poseDetectMs: number } {
  const faceStart = performance.now();
  const faceResult = trackers.faceLandmarker.detectForVideo(video, timestampMs);
  const faceDetectMs = performance.now() - faceStart;
  const poseStart = performance.now();
  const poseResult = trackers.poseLandmarker.detectForVideo(video, timestampMs);
  const poseDetectMs = performance.now() - poseStart;
  return {
    face: toLiveFaceLandmarks(faceResult),
    pose: toLivePoseLandmarks(poseResult),
    faceDetectMs,
    poseDetectMs,
  };
}

/** One-shot counterpart to detectFrameWithTiming, for IMAGE-mode trackers (createImageTrackers)
 * against a single static photo -- BotPreview.tsx calls this exactly once per loaded
 * model image, not per frame. */
export function detectStaticImage(
  trackers: LiveTrackers,
  image: HTMLImageElement
): { face: LiveFaceLandmarks | null; pose: LivePoseLandmarks | null } {
  const faceResult = trackers.faceLandmarker.detect(image);
  const poseResult = trackers.poseLandmarker.detect(image);
  return {
    face: toLiveFaceLandmarks(faceResult),
    pose: toLivePoseLandmarks(poseResult),
  };
}
