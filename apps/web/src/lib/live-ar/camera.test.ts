import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CAMERA_CONSTRAINTS, startLiveCamera, stopLiveCamera } from "@/lib/live-ar/camera";

describe("startLiveCamera", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with a stream on success", async () => {
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const result = await startLiveCamera();
    expect(result).toEqual({ success: true, stream: fakeStream });
    expect(getUserMedia).toHaveBeenCalledWith(DEFAULT_CAMERA_CONSTRAINTS);
  });

  it("maps NotAllowedError to CAMERA_PERMISSION_DENIED", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const result = await startLiveCamera();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("CAMERA_PERMISSION_DENIED");
  });

  it("maps NotFoundError to NO_CAMERA", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const result = await startLiveCamera();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NO_CAMERA");
  });

  it("maps an unrecognized failure to CAMERA_UNAVAILABLE", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("busy", "NotReadableError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const result = await startLiveCamera();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("CAMERA_UNAVAILABLE");
  });

  it("reports CAMERA_UNAVAILABLE when getUserMedia does not exist at all", async () => {
    vi.stubGlobal("navigator", {});
    const result = await startLiveCamera();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("CAMERA_UNAVAILABLE");
  });
});

describe("stopLiveCamera", () => {
  it("stops every track on the stream", () => {
    const stop1 = vi.fn();
    const stop2 = vi.fn();
    const stream = { getTracks: () => [{ stop: stop1 }, { stop: stop2 }] } as unknown as MediaStream;
    stopLiveCamera(stream);
    expect(stop1).toHaveBeenCalled();
    expect(stop2).toHaveBeenCalled();
  });

  it("does nothing when passed null", () => {
    expect(() => stopLiveCamera(null)).not.toThrow();
  });
});
