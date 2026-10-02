"use client";

/* eslint-disable @next/next/no-img-element -- signed, short-lived backend URL. */

import Link from "next/link";

import { BotMessage } from "@/components/jewellery-ai/ChatMessage";
import type { IntakeResponse } from "@/lib/jewellery-ai-types";

export function SuccessStep({ intake, onAddAnother }: { intake: IntakeResponse; onAddAnother: () => void }) {
  const metadata = intake.user_metadata;
  return (
    <div className="flex flex-col gap-4">
      <BotMessage>Your jewellery has been added successfully ✦</BotMessage>

      <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/70 p-4 text-center">
        {intake.prepared_preview_url && (
          <img
            src={intake.prepared_preview_url}
            alt={metadata.name ?? "Your jewellery"}
            className="h-28 w-28 rounded-xl border border-black/5 object-contain"
          />
        )}
        <p className="font-[family-name:var(--font-display)] text-lg font-bold text-neutral-900">
          {metadata.name}
        </p>
        <p className="text-sm text-neutral-500">
          {metadata.category_slug}
          {metadata.size ? ` • ${metadata.size}` : ""}
        </p>
      </div>

      <BotMessage>Your jewellery is now available in the catalogue and ready for try-on.</BotMessage>

      <div className="flex flex-col gap-2">
        <Link
          href="/try-on/live"
          className="rounded-full bg-[#C90016] px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-[#A8000F]"
        >
          Try It On
        </Link>
        <Link
          href="/#categories"
          className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-center text-sm font-semibold text-neutral-800 transition-colors hover:bg-[#F8EEE5]"
        >
          View Catalogue
        </Link>
        <button
          type="button"
          onClick={onAddAnother}
          className="rounded-full px-4 py-2.5 text-center text-sm font-semibold text-neutral-600 transition-colors hover:bg-[#F8EEE5]"
        >
          Add Another Jewellery
        </button>
      </div>
    </div>
  );
}
