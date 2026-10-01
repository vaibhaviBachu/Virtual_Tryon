import Link from "next/link";

// Grounded in real, already-shipped pipeline stages (see useLiveArSession.ts /
// docs/live-ar-realism-architecture.md) -- not aspirational marketing copy.
const HERO_FEATURES = [
  {
    label: "Real-time\nTracking",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    label: "Natural\nFit & Scale",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    ),
  },
  {
    label: "3D/2.5D\nRendering",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="M3.3 7 12 12l8.7-5M12 22V12" />
      </svg>
    ),
  },
  {
    label: "Works on\nAny Device",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
];

/** The marketing copy block at the top of the catalogue column -- see LiveArStudio.tsx. */
export function HeroIntro() {
  return (
    <div className="mb-8">
      <p className="mb-2 text-sm font-bold tracking-[0.2em] text-[#C90016]">VIRTUAL JEWELLERY TRY-ON</p>
      <h1 className="mb-4 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.1] text-neutral-900 sm:text-5xl">
        See the Beauty
        <br />
        <span className="text-[#C90016]">on You</span>
      </h1>
      <p className="max-w-md text-base font-bold leading-relaxed text-neutral-700">
        Try on our jewellery collection in real-time using your camera. No photo needed.
        Experience the perfect fit before you buy.
      </p>
      <p className="mt-2 text-sm font-bold text-neutral-500">
        No camera, or prefer a still photo?{" "}
        <Link href="/try-on" className="underline underline-offset-2 hover:text-neutral-700">
          Upload a photo and pick jewellery instead
        </Link>
        .
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {HERO_FEATURES.map((f) => (
          <div key={f.label} className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.12)]">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#FCE8E8] text-[#C90016]">
              {f.icon}
            </span>
            <span className="whitespace-pre-line text-sm font-bold leading-tight text-neutral-700">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
