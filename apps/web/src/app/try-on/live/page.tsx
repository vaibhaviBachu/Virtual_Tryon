import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { LiveArStudio } from "@/components/live/LiveArStudio";

/**
 * Live AR Try-On Studio route -- Milestone 5. Deliberately a separate route from
 * /try-on (the existing photo pipeline), which continues to work unchanged (spec §2:
 * "the app should support both PHOTO TRY-ON and LIVE AR TRY-ON as two modes").
 */
export default function LiveArTryOnPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 pt-10">
          <h1 className="mb-1 font-[family-name:var(--font-display)] text-2xl">Live AR Try-On</h1>
          <p className="mb-2 text-sm text-neutral-500">
            Real-time try-on using your camera -- no photo needed. This is a live geometry
            preview, not a photorealistic simulation.
          </p>
          <p className="mb-6 text-sm text-neutral-500">
            No camera, or prefer a still photo?{" "}
            <Link href="/try-on" className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-white">
              Upload a photo and pick jewellery instead
            </Link>
            .
          </p>
        </div>
        <LiveArStudio />
      </main>
    </div>
  );
}
