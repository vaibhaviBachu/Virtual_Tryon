"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import type { CapturedPhoto } from "@/components/camera/types";

interface PhotoUploadProps {
  onSelect: (photo: CapturedPhoto) => void;
}

/**
 * File-upload fallback for devices/browsers without camera access (desktop without a
 * webcam, permission denied, unsupported browser). Format/size/resolution validation is
 * Milestone 3 scope — this component only wires the browser file picker to the same
 * `CapturedPhoto` shape the camera path produces, so the rest of the Studio never needs
 * to know which source a photo came from.
 */
export function PhotoUpload({ onSelect }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col items-center gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const objectUrl = URL.createObjectURL(file);
          onSelect({ blob: file, objectUrl, source: "upload" });
        }}
      />
      <Button variant="secondary" size="lg" onClick={() => inputRef.current?.click()}>
        Upload a photo instead
      </Button>
    </div>
  );
}
