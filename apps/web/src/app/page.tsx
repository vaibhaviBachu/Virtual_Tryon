import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { slug: "earring", label: "Earrings" },
  { slug: "necklace", label: "Necklaces" },
  { slug: "haaram", label: "Long Haaram" },
  { slug: "bangle", label: "Bangles" },
  { slug: "bracelet", label: "Bracelets" },
  { slug: "ring", label: "Rings" },
  { slug: "maang_tikka", label: "Maang Tikka" },
  { slug: "nose_ring", label: "Nose Rings" },
  { slug: "set", label: "Jewellery Sets" },
] as const;

const STEPS = [
  {
    title: "Go live",
    description: "Open your camera — no photo needed, nothing to upload.",
  },
  {
    title: "Browse",
    description: "Choose a piece from the jewellery catalogue.",
  },
  {
    title: "Try it on",
    description: "See the actual piece on you in real time, live on camera.",
  },
  {
    title: "See how you look",
    description: "Move, turn, check every angle — it follows you live.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center sm:pt-28">
          <Badge className="mb-6">Virtual jewellery try-on</Badge>
          <h1 className="mx-auto max-w-3xl font-[family-name:var(--font-display)] text-4xl leading-tight sm:text-6xl">
            See the piece on you before it arrives.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-balance text-neutral-600 dark:text-neutral-400">
            Try on earrings, necklaces, bangles, and more from our catalogue —
            instantly, on your own photo, with the actual product preserved
            down to the last detail.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/try-on/live" className={cn(buttonVariants({ size: "lg" }))}>
              Start your try-on
            </Link>
            <a
              href="#how-it-works"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
            >
              See how it works
            </a>
          </div>
        </section>

        {/* Categories */}
        <section id="categories" className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="mb-8 text-center font-[family-name:var(--font-display)] text-2xl">
            Every category, one workflow
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-9">
            {CATEGORIES.map((category) => (
              <Card key={category.slug} className="text-center">
                <CardContent className="flex flex-col items-center gap-2 p-4">
                  <div className="h-10 w-10 rounded-full bg-neutral-100 dark:bg-neutral-900" />
                  <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    {category.label}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-neutral-400">
            Catalogue browsing ships in Milestone 2 — categories shown here are
            illustrative.
          </p>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t border-neutral-200 bg-neutral-50 py-16 dark:border-neutral-800 dark:bg-neutral-900/40">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="mb-10 text-center font-[family-name:var(--font-display)] text-2xl">
              How it works
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <Card key={step.title}>
                  <CardContent>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-2 font-medium">{step.title}</h3>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                      {step.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="font-[family-name:var(--font-display)] text-3xl">
            Ready to see it on yourself?
          </h2>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">
            No account required to get started.
          </p>
          <Link href="/try-on/live" className={cn(buttonVariants({ size: "lg" }), "mt-8")}>
            Open the Try-On Studio
          </Link>
        </section>
      </main>

      <footer className="border-t border-neutral-200 py-8 text-center text-xs text-neutral-400 dark:border-neutral-800">
        Lumière Virtual Try-On — platform foundation (Milestone 1)
      </footer>
    </div>
  );
}
