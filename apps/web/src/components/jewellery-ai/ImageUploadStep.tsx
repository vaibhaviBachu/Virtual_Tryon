"use client";

import { useRef } from "react";

import { BotMessage } from "@/components/jewellery-ai/ChatMessage";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

/** The assistant's opening screen: the welcome message plus the single upload action.
 * No prompt box, no settings to configure — the customer's only job is picking a
 * photo. There's deliberately no fabricated multi-tick progress bar while uploading
 * (the house rule from AssetUploader.tsx: "never fake processing status") — just an
 * honest "preparing your photo..." state while the one real request is in flight. */
export function ImageUploadStep({
  onSelectFile,
  isUploading,
  error,
}: {
  onSelectFile: (file: File) => void;
  isUploading: boolean;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <BotMessage>
        <p className="font-semibold">Hello ✦</p>
        <p className="mt-1">
          I can help you prepare your jewellery for virtual try-on. Upload a photo of your jewellery and I&apos;ll
          create a clean catalogue version and prepare the product details for you.
        </p>
      </BotMessage>

      <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#C9A24A]/40 bg-white/60 px-4 py-8 text-center">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          aria-label="Upload a jewellery photo"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSelectFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-full bg-[#C90016] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A8000F] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? "Preparing your photo…" : "Upload Jewellery Image"}
        </button>
        <p className="text-xs text-neutral-500">JPG, PNG or WEBP</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
