"use client";

import type { ReactNode } from "react";

/** The chat window shell: header (title, status, minimize/close) + a scrollable body
 * for whichever step is currently active. Desktop: a modest floating panel near the
 * trigger button (380-440px wide, capped height) — not a huge takeover of the screen.
 * Mobile: a near-full-screen bottom sheet, since a 400px-wide panel makes no sense on a
 * phone and the assistant needs real room for an image + form fields there. */
export function AssistantPanel({
  onClose,
  onMinimize,
  children,
}: {
  onClose: () => void;
  onMinimize: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label="Lumière Jewellery AI Assistant"
      className="fixed inset-x-0 bottom-0 top-[12vh] z-50 flex flex-col overflow-hidden rounded-t-3xl border border-black/5 bg-[#FFFBF6] shadow-[0_-8px_40px_-8px_rgba(0,0,0,0.25)] sm:inset-x-auto sm:bottom-24 sm:right-6 sm:top-auto sm:h-[650px] sm:max-h-[80vh] sm:w-[400px] sm:rounded-3xl sm:shadow-[0_20px_60px_-12px_rgba(0,0,0,0.3)]"
    >
      <header className="flex flex-none items-center justify-between border-b border-black/5 bg-white/70 px-4 py-3 backdrop-blur">
        <div>
          <p className="font-[family-name:var(--font-display)] text-base font-bold text-neutral-900">
            ✦ Lumière AI
          </p>
          <p className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Jewellery Assistant
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMinimize}
            aria-label="Minimize assistant"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-[#F8EEE5] hover:text-neutral-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-[#F8EEE5] hover:text-neutral-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
    </div>
  );
}
