"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { uploadAsset } from "@/lib/catalogue-api";
import { useAdminAuthStore } from "@/store/admin-auth-store";

type UploadPhase = "idle" | "uploading" | "uploaded" | "error";

/**
 * Real upload states only — "Uploading" while the request is in flight, "Uploaded" once
 * the API has actually accepted it (202, both asset rows created), and an explicit
 * error state with the server's real message on failure. There is deliberately no fake
 * progress percentage — the browser's fetch API doesn't expose real upload progress
 * without XHR-level plumbing, and a fabricated bar would violate the project's
 * "never fake processing status" rule. Processing status itself (pending -> ready/
 * failed) is shown by AssetPreview's real polling, not by this component.
 */
export function AssetUploader({ jewelleryId }: { jewelleryId: string }) {
  const token = useAdminAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (file: File) => uploadAsset(jewelleryId, file, token!),
    onMutate: () => {
      setPhase("uploading");
      setErrorMessage(null);
    },
    onSuccess: () => {
      setPhase("uploaded");
      queryClient.invalidateQueries({ queryKey: ["assets", jewelleryId] });
    },
    onError: (err) => {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) mutation.mutate(file);
        }}
        className="text-sm"
      />
      {phase === "uploading" && <p className="text-sm text-neutral-500">Uploading…</p>}
      {phase === "uploaded" && (
        <p className="text-sm text-green-700 dark:text-green-400">
          Uploaded — background removal is now processing in the background.
        </p>
      )}
      {phase === "error" && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errorMessage}
        </p>
      )}
      {phase === "uploaded" && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setPhase("idle");
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        >
          Upload another photo
        </Button>
      )}
    </div>
  );
}
