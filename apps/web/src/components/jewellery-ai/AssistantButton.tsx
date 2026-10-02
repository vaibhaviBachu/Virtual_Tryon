"use client";

import { useEffect, useState } from "react";

/** The floating entry point for the whole assistant — a small, premium, round button
 * fixed to the bottom-right, matching the Lumière gold/champagne/deep-red palette
 * rather than a generic chat-widget look. Deliberately understated: a brief scale-in on
 * mount, a slow/subtle idle shimmer (not a continuous attention-grabbing pulse), and a
 * hover glow + tooltip — see the component's own comments for exactly which Tailwind
 * utility does what. */
export function AssistantButton({
  onClick,
  hasUnfinishedWork,
}: {
  onClick: () => void;
  hasUnfinishedWork: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One tick after mount so the fade/scale-in transition actually has a "before"
    // state to animate from, instead of appearing instantly.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open Jewellery AI Assistant"
      title="Jewellery AI Assistant"
      className={`group fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#C9A24A] to-[#A8792E] text-white shadow-[0_8px_24px_-6px_rgba(201,162,74,0.6)] transition-all duration-300 ease-out hover:scale-110 hover:shadow-[0_10px_30px_-4px_rgba(201,162,74,0.8)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A24A] sm:bottom-6 sm:right-6 ${
        mounted ? "scale-100 opacity-100" : "scale-75 opacity-0"
      }`}
    >
      {/* Built-in `animate-pulse` utility (not an arbitrary-value animation) --
          this project's Tailwind build has previously broken on arbitrary-value CSS
          patterns, so this deliberately sticks to a plain, guaranteed-to-exist
          utility class rather than a custom keyframe/duration. */}
      <span aria-hidden="true" className="motion-safe:animate-pulse text-xl leading-none">
        ✦
      </span>
      {hasUnfinishedWork && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#C90016] text-[10px] text-white ring-2 ring-white"
        >
          ✦
        </span>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-full bg-neutral-900/90 px-3 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100"
      >
        Jewellery AI Assistant
      </span>
    </button>
  );
}
