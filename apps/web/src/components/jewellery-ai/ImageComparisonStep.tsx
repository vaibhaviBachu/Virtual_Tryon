"use client";

/* eslint-disable @next/next/no-img-element -- signed, short-lived backend URLs, not a
   static asset Next's image optimizer should process. */

import { BotMessage } from "@/components/jewellery-ai/ChatMessage";
import type { ImagePreparationStatus, IntakeResponse } from "@/lib/jewellery-ai-types";

// Distinct, honest copy per real reason -- a silent "AI did nothing" fallback (one
// generic message regardless of why) looked like a bug to a real user testing this:
// an unedited full photo resized to 200x200 looks identical whether AI was never
// configured, errored out, or ran but didn't actually isolate the jewellery.
const PREPARATION_STATUS_COPY: Record<ImagePreparationStatus, string | null> = {
  success: null,
  not_configured:
    "(AI photo touch-up isn't turned on for this shop yet, so this uses your original photo with a white-padded frame, not an isolated cutout.)",
  failed:
    "I couldn't process this photo with AI right now, so this is your original photo instead of an isolated cutout. Try Regenerate, or continue as-is.",
  rejected:
    "I wasn't able to automatically isolate just the jewellery from this photo — it may still show more than the item itself. Try Regenerate, or upload a closer photo of just the jewellery.",
};

export function ImageComparisonStep({
  intake,
  onRegenerate,
  isRegenerating,
  regenerateError,
  onContinue,
}: {
  intake: IntakeResponse;
  onRegenerate: () => void;
  isRegenerating: boolean;
  regenerateError: string | null;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <BotMessage>
        <p>Your jewellery image is ready.</p>
        {PREPARATION_STATUS_COPY[intake.image_preparation_status] && (
          <p
            className={`mt-1 text-xs ${
              intake.image_preparation_status === "not_configured" ? "text-neutral-500" : "text-amber-700"
            }`}
          >
            {PREPARATION_STATUS_COPY[intake.image_preparation_status]}
          </p>
        )}
      </BotMessage>

      <div className="grid grid-cols-2 gap-3">
        <figure className="flex flex-col items-center gap-1.5">
          <div className="flex h-32 w-full items-center justify-center overflow-hidden rounded-xl border border-black/5 bg-white">
            {intake.original_preview_url && (
              <img src={intake.original_preview_url} alt="Original upload" className="h-full w-full object-contain" />
            )}
          </div>
          <figcaption className="text-xs text-neutral-500">Original</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-1.5">
          <div className="flex h-32 w-full items-center justify-center overflow-hidden rounded-xl border border-black/5 bg-white">
            {intake.prepared_preview_url && (
              <img
                src={intake.prepared_preview_url}
                alt="Prepared catalogue image, 200 by 200 pixels"
                className="h-full w-full object-contain"
              />
            )}
          </div>
          <figcaption className="text-xs text-neutral-500">Catalogue image (200×200)</figcaption>
        </figure>
      </div>

      {regenerateError && (
        <p role="alert" className="text-sm text-red-600">
          {regenerateError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="flex-1 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:bg-[#F8EEE5] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRegenerating ? "Regenerating…" : "Regenerate"}
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="flex-1 rounded-full bg-[#C90016] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#A8000F]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
