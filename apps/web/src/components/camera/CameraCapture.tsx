"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CapturedPhoto } from "@/components/camera/types";

interface CameraCaptureProps {
  onCapture: (photo: CapturedPhoto) => void;
  onUnavailable: () => void;
}

/**
 * Browser camera capture via MediaDevices.getUserMedia().
 *
 * This is the capture-abstraction shell described in docs/architecture.md §3 and the
 * spec's "camera architecture" section — it requests the camera, shows a live preview,
 * and hands a captured frame back through `onCapture`. It intentionally does NOT do any
 * image validation/preprocessing (format, size, resolution, orientation) — that
 * pipeline belongs to Milestone 3. If the camera is unavailable (no device, permission
 * denied, unsupported browser), it calls `onUnavailable` so the parent can fall back to
 * PhotoUpload without a broken UI state.
 */
export function CameraCapture({ onCapture, onUnavailable }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera is not supported in this browser.");
        onUnavailable();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsReady(true);
      } catch {
        setError("Camera permission was denied or no camera is available.");
        onUnavailable();
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      onCapture({ blob, objectUrl, source: "camera" });
    }, "image/jpeg", 0.92);
  }, [onCapture]);

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl bg-neutral-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      </div>
      <Button onClick={capture} disabled={!isReady} size="lg">
        Capture photo
      </Button>
    </div>
  );
}
