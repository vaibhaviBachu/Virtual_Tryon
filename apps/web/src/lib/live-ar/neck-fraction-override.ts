/**
 * Persisted, per-browser override for NECK_ATTACHMENT_FRACTION_OF_NECK_LENGTH.
 *
 * The automatic default (constants.ts) is what every Live AR necklace session uses out
 * of the box -- this module exists only so a person can drag the calibration slider
 * (LiveArStudio's debug panel) to a position that looks right on THEIR camera/setup and
 * have it "stick" without needing debug mode open every time. It is deliberately a thin,
 * isolated wrapper (not folded into asset-cache.ts or constants.ts) so it's obvious this
 * is browser-local personalization, not a change to the shipped calibration -- clearing
 * browser storage, or a different browser/device, goes right back to the automatic value.
 *
 * Guarded for SSR/build-time rendering (the /try-on/live route is statically
 * prerendered -- `window`/`localStorage` do not exist during that pass) and for private
 * browsing / storage-disabled environments (never let a storage failure break Live AR).
 */
const STORAGE_KEY = "liveAr.necklaceAttachmentFractionOverride";

export function readSavedNeckFractionOverride(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  } catch {
    return null;
  }
}

export function saveNeckFractionOverride(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Best-effort only -- a storage failure (private browsing, quota, disabled storage)
    // must never break Live AR; the session just keeps using the in-memory value.
  }
}

export function clearSavedNeckFractionOverride(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same best-effort rationale as saveNeckFractionOverride.
  }
}
