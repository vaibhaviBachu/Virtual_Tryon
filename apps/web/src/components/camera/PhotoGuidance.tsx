/**
 * Lightweight photo guidance text (Milestone 3 spec: "lightweight (not overloaded)
 * photo guidance ... for face/ears/neck-shoulders/hands visibility and lighting").
 * Deliberately short — a bullet list, not a wizard or a modal — shown once above the
 * capture/upload controls, not repeated on every screen.
 */
export function PhotoGuidance() {
  return (
    <ul className="mx-auto mb-2 max-w-sm list-disc space-y-1 pl-5 text-left text-xs text-neutral-500 dark:text-neutral-400">
      <li>Face the camera in good, even lighting</li>
      <li>Keep your ears visible (move hair away from them if needed)</li>
      <li>Include your shoulders and, if trying rings or bangles, your hand(s)</li>
      <li>Avoid strong backlight or a blurry/shaky shot</li>
    </ul>
  );
}
