import { SiteHeader } from "@/components/site-header";
import { LiveArStudio } from "@/components/live/LiveArStudio";
import { AmbientJewelleryStage } from "@/components/live/AmbientJewelleryStage";

const BOTTOM_FEATURES = [
  {
    label: "Live AR Tracking",
    sub: "Accurate neck alignment",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    label: "Smart Segmentation",
    sub: "Natural blending",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    ),
  },
  {
    label: "3D/2.5D Rendering",
    sub: "Realistic jewellery fit",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="M3.3 7 12 12l8.7-5M12 22V12" />
      </svg>
    ),
  },
  {
    label: "Body Movement Support",
    sub: "Works in real-time",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v6l-3 7m3-7 3 7M7 12l5-2 5 2" />
      </svg>
    ),
  },
];

/**
 * Live AR Try-On Studio route -- Milestone 5. Deliberately a SEPARATE route from
 * /try-on (the existing photo pipeline), which continues to work unchanged (spec §2:
 * "the app should support both PHOTO TRY-ON and LIVE AR TRY-ON as two modes").
 *
 * Deliberately light/ivory-themed regardless of the visitor's OS dark-mode preference
 * (see SiteHeader's forceLight doc comment) -- this page's hero/catalogue design is a
 * fixed brand mockup, not meant to invert in system dark mode the way the rest of the
 * app does. All the actual catalogue/camera/AR logic lives in LiveArStudio, unchanged
 * by this redesign -- this file only supplies the page chrome around it.
 */
export default function LiveArTryOnPage() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#FFF8F1] text-neutral-900">
      {/* The real brand background photo (uploaded by the user, stored at
          public/live-ar/hero-archway-bg.webp) -- a single wide scene (plain wall on the
          left, archway + blossom branches on the right) rather than a repeated pattern,
          so it's anchored to the top-right and left to crop on narrower viewports
          instead of stretching/distorting. Hidden below `lg` so it never competes with
          the stacked mobile layout's text contrast. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-cover bg-no-repeat opacity-90 lg:block"
        style={{ backgroundImage: "url(/live-ar/hero-archway-bg.webp)", backgroundPosition: "top right" }}
      />
      {/* Soft left-to-right fade so hero text over the plain-wall portion of the photo
          always has guaranteed contrast regardless of viewport width. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-[#FFF8F1] via-[#FFF8F1]/40 to-transparent lg:block"
      />

      {/* Fills the otherwise-empty left gutter on wide screens (beyond the centered
          max-w-7xl content) with a subtle decorative layer -- never shown below `xl`,
          where that gutter doesn't meaningfully exist and the catalogue needs the
          space instead. */}
      <AmbientJewelleryStage className="absolute inset-y-24 left-0 z-[5] hidden w-56 xl:block" />

      <div className="relative z-10 flex flex-1 flex-col">
        <SiteHeader forceLight />
        <main className="flex-1">
          <LiveArStudio />
        </main>

        <div className="mx-4 mb-6 mt-10 rounded-[2rem] bg-white shadow-[0_2px_20px_-8px_rgba(0,0,0,0.1)] sm:mx-6 lg:mx-8">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-8 sm:grid-cols-4">
            {BOTTOM_FEATURES.map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[#FCE8E8] text-[#C90016]">
                  {f.icon}
                </span>
                <div>
                  <p className="text-base font-bold text-neutral-900">{f.label}</p>
                  <p className="text-sm font-bold text-neutral-500">{f.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
