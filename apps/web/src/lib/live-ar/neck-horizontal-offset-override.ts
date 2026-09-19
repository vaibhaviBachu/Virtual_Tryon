/**
 * Persisted, per-browser override for the necklace anchor's horizontal offset, expressed
 * as a fraction of shoulder width (so it scales correctly with camera distance, same
 * convention as every other live-ar measurement -- see neck-reference.ts).
 *
 * Mirrors neck-fraction-override.ts exactly (see that module's docstring for the full
 * rationale): a thin, isolated, per-browser wrapper around the calibration slider's
 * saved value, guarded for SSR and storage-disabled environments.
 */
const STORAGE_KEY = "liveAr.necklaceHorizontalOffsetOverride";
const MAX_ABS_VALUE = 0.5;

export function readSavedNeckHorizontalOffsetOverride(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && Math.abs(value) <= MAX_ABS_VALUE ? value : null;
  } catch {
    return null;
  }
}

export function saveNeckHorizontalOffsetOverride(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Best-effort only, same rationale as neck-fraction-override.ts.
  }
}

export function clearSavedNeckHorizontalOffsetOverride(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same best-effort rationale as neck-fraction-override.ts.
  }
}
