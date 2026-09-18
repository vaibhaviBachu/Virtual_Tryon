/**
 * Live AR camera acquisition.
 *
 * Separate from `components/camera/CameraCapture.tsx` (the existing Milestone 3 photo
 * capture component) on purpose -- see docs/live-ar-architecture.md "Relationship to the
 * photo try-on pipeline". Photo capture opens the camera to take ONE frame and stop; Live
 * AR opens it for a continuous tracked session, needs a distinguishable set of structured
 * error codes (the spec calls out CAMERA_PERMISSION_DENIED / CAMERA_UNAVAILABLE /
 * NO_CAMERA specifically), and deliberately requests a capped resolution rather than
 * "whatever the device offers" so a phone's 4K camera doesn't feed 4K frames into
 * per-frame tracking.
 */

export type CameraErrorCode = "CAMERA_PERMISSION_DENIED" | "CAMERA_UNAVAILABLE" | "NO_CAMERA";

export interface CameraError {
  code: CameraErrorCode;
  message: string;
}

export interface CameraStartResult {
  success: true;
  stream: MediaStream;
}

export interface CameraStartFailure {
  success: false;
  error: CameraError;
}

/** Configurable, not "as high as the device supports" -- per spec §4, resolution should
 * be reasonable for real-time tracking rather than unnecessarily high (a large frame
 * costs tracking latency for no accuracy benefit at typical webcam distances). */
export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: "user",
    width: { ideal: 960, max: 1280 },
    height: { ideal: 720, max: 960 },
    frameRate: { ideal: 30, max: 30 },
  },
  audio: false,
};

function classifyGetUserMediaError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      code: "CAMERA_PERMISSION_DENIED",
      message: "Camera access was denied. Allow camera access in your browser to use Live AR try-on.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { code: "NO_CAMERA", message: "No camera was found on this device." };
  }
  return {
    code: "CAMERA_UNAVAILABLE",
    message: "The camera could not be started. It may be in use by another application.",
  };
}

/** Requests the live camera stream. Never call this per-frame -- it is meant to run once
 * per Live AR session (see `useLiveCamera`). */
export async function startLiveCamera(
  constraints: MediaStreamConstraints = DEFAULT_CAMERA_CONSTRAINTS
): Promise<CameraStartResult | CameraStartFailure> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { success: false, error: { code: "CAMERA_UNAVAILABLE", message: "Camera is not supported in this browser." } };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { success: true, stream };
  } catch (err) {
    return { success: false, error: classifyGetUserMediaError(err) };
  }
}

export function stopLiveCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
