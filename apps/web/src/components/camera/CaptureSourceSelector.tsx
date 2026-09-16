"use client";

import { useState } from "react";

import { CameraCapture } from "@/components/camera/CameraCapture";
import { PhotoUpload } from "@/components/camera/PhotoUpload";
import type { CapturedPhoto } from "@/components/camera/types";

interface CaptureSourceSelectorProps {
  onCapture: (photo: CapturedPhoto) => void;
}

/**
 * Top-level capture abstraction referenced by docs/architecture.md §3: tries the camera
 * first, falls back to upload automatically if the camera is unavailable, and always
 * offers upload as an explicit alternative (mobile camera vs. desktop upload, per the
 * spec's camera-architecture requirement).
 */
export function CaptureSourceSelector({ onCapture }: CaptureSourceSelectorProps) {
  const [cameraAvailable, setCameraAvailable] = useState(true);

  return (
    <div className="flex flex-col items-center gap-6">
      {cameraAvailable && (
        <CameraCapture
          onCapture={onCapture}
          onUnavailable={() => setCameraAvailable(false)}
        />
      )}
      <PhotoUpload onSelect={onCapture} />
    </div>
  );
}
