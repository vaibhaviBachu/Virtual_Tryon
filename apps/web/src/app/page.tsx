"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const CATEGORIES = [
  { slug: "earring", label: "Earrings" },
  { slug: "necklace", label: "Necklace" },
  { slug: "haaram", label: "Long Haaram" },
  { slug: "bangle", label: "Bangles" },
  { slug: "bracelet", label: "Bracelets" },
  { slug: "ring", label: "Rings" },
  { slug: "maang_tikka", label: "Maang Tikka" },
  { slug: "nose_ring", label: "Nose Ring" },
  { slug: "set", label: "Jewellery Sets" },
] as const;

const STEPS = [
  { title: "Go live", description: "Open your camera — no photo needed, nothing to upload." },
  { title: "Browse", description: "Choose a piece from the jewellery catalogue." },
  { title: "Try it on", description: "See the actual piece on you in real time, live on camera." },
  { title: "See how you look", description: "Move, turn, check every angle — it follows you live." },
] as const;

const HERO_FEATURES = [
  {
    label: "Real-time\nTracking",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="9" />
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

// `window.matchMedia` doesn't exist in every environment (older browsers, and the
// jsdom test environment this page is unit-tested under) -- guard it everywhere
// rather than assume it's always present.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Reveals children with a soft fade/rise once scrolled into view -- a plain
 * IntersectionObserver + CSS transition, no animation library. Honors
 * prefers-reduced-motion via the CSS rule in globals below (forces opacity/transform
 * to their resting state regardless of the JS-added class). Falls back to showing
 * content immediately when IntersectionObserver isn't available (older browsers, and
 * the jsdom test environment). */
function Reveal({ children, className = "", delayMs = 0 }: { children: React.ReactNode; className?: string; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // Must start false on BOTH server and client -- `typeof IntersectionObserver` is
  // "undefined" during server rendering (Node has no such global) but "function" in
  // every real browser, so using that check in a lazy useState initializer (which runs
  // during the client's hydration render too) produced a genuine hydration mismatch:
  // the server always rendered visible=true while the client always recomputed
  // visible=false. Fixed by always starting false and only correcting it inside the
  // effect below (which never runs during SSR), accepting the resulting
  // react-hooks/set-state-in-effect lint note as the correct tradeoff here -- same
  // pattern as `debugAllowed` elsewhere in this codebase.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "reveal-visible" : ""} ${className}`}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}

export default function LandingPage() {
  const bgRef = useRef<HTMLDivElement>(null);
  const heroTextRef = useRef<HTMLDivElement>(null);
  const heroCtaRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);

  // Subtle global mouse parallax -- direct DOM transforms on a handful of refs (never
  // React state) so continuous mousemove never triggers a re-render. Skipped entirely
  // under prefers-reduced-motion.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    function handleMove(e: MouseEvent) {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      if (bgRef.current) bgRef.current.style.transform = `translate3d(${nx * -8}px, ${ny * -8}px, 0) scale(1.05)`;
      if (heroTextRef.current) heroTextRef.current.style.transform = `translate3d(${nx * 6}px, ${ny * 4}px, 0)`;
      if (heroCtaRef.current) heroCtaRef.current.style.transform = `translate3d(${nx * 10}px, ${ny * 6}px, 0)`;
      if (featuresRef.current) featuresRef.current.style.transform = `translate3d(${nx * 14}px, ${ny * 8}px, 0)`;
    }
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  // Soft cursor-following warm spotlight behind the glass cards -- CSS custom
  // properties updated directly (no re-render), consumed by .spotlight's background.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    function handleMove(e: MouseEvent) {
      document.documentElement.style.setProperty("--spot-x", `${e.clientX}px`);
      document.documentElement.style.setProperty("--spot-y", `${e.clientY}px`);
    }
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div className="relative flex flex-1 flex-col text-[#F7EEDD]">
      {/* Fixed background -- position:fixed (not background-attachment:fixed, which is
          unreliable on mobile Safari) so it never scrolls with the page, per the
          brand photo's own requirement. Scaled up slightly (1.05) so the subtle
          parallax translate never reveals an edge. */}
      <div
        ref={bgRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 bg-cover"
        style={{
          backgroundImage: "url(/live-ar/landing-hero-bg.webp)",
          // The woman sits roughly 3/4 of the way across the photo and in its upper
          // half -- plain `bg-center` crops a narrow/tall mobile viewport to the
          // image's horizontal and vertical MIDDLE instead, which cuts her out
          // entirely and leaves only plain wall visible (exactly what showed up on a
          // phone-width screenshot). Biasing the position keeps her in frame at every
          // viewport size, not just wide desktop ones where bg-cover barely crops.
          backgroundPosition: "78% 20%",
          willChange: "transform",
        }}
      />
      {/* Cinematic readability overlay -- strongest where the hero text sits (left),
          fading out over the woman/mirror on the right so they stay visible, plus a
          gentle overall darkening so every section's text (not just the hero) stays
          readable against the one fixed photo behind it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-r from-black/80 via-black/40 to-black/20"
      />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-black/25" />
      {/* Cursor spotlight -- a soft, warm radial glow that follows the pointer very
          subtly (never a bright circle), per the "luxury showroom spotlight" brief. */}
      <div
        aria-hidden="true"
        className="spotlight pointer-events-none fixed inset-0 -z-[5]"
      />

      <div className="relative z-10 flex flex-1 flex-col">
        {/* Floating glass navigation */}
        <header className="sticky top-4 z-30 mx-4 sm:mx-6 lg:mx-8">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between rounded-full border border-amber-200/15 bg-black/50 px-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-[family-name:var(--font-display)] text-xl tracking-wide text-[#F7EEDD]">
              <span className="text-amber-300">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
                </svg>
              </span>
              Lumière
            </Link>
            <nav className="hidden items-center gap-8 text-base font-bold text-[#E8DCC6]/80 sm:flex">
              <Link href="/" className="relative text-[#F7EEDD]">
                Home
                <span className="absolute -bottom-2 left-0 right-0 h-0.5 rounded-full bg-amber-300" />
              </Link>
              <Link href="/#categories" className="hover:text-[#F7EEDD]">
                Categories
              </Link>
              <Link href="/#how-it-works" className="hover:text-[#F7EEDD]">
                How it works
              </Link>
            </nav>
            <div className="flex items-center gap-1">
              <div className="hidden items-center gap-1 sm:flex">
                {[
                  <svg key="search" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>,
                  <svg key="heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
                  </svg>,
                  <svg key="user" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
                  </svg>,
                ].map((icon, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    title="Coming soon"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[#E8DCC6]/70 hover:bg-white/10"
                  >
                    {icon}
                  </span>
                ))}
              </div>
              <Link
                href="/try-on/live"
                className="ml-2 flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-200 to-amber-400 px-5 py-2.5 text-sm font-medium text-neutral-900 shadow-[0_4px_20px_-4px_rgba(252,211,77,0.6)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_8px_26px_-6px_rgba(252,211,77,0.7)]"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Try it on
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1">
          {/* Hero -- deliberately transparent so the photo (woman + mirror) stays the
              focal point; only a left-to-right gradient (above) gives the text contrast. */}
          <section className="mx-auto max-w-6xl px-6 pb-24 pt-16 sm:pt-24">
            <div ref={heroTextRef} style={{ willChange: "transform" }}>
              <span className="mb-5 inline-block rounded-full border border-amber-200/30 bg-black/30 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-amber-200 backdrop-blur-sm">
                Virtual jewellery try-on
              </span>
              <h1 className="max-w-xl font-[family-name:var(--font-display)] text-4xl leading-[1.15] drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] sm:text-6xl">
                See the piece <span className="text-amber-300">on you</span> before it arrives.
              </h1>
              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[#E8DCC6]/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
                Try on earrings, necklaces, bangles, and more from our catalogue — instantly, on your own
                camera, with the actual product preserved down to the last detail.
              </p>
            </div>

            <div ref={heroCtaRef} className="mt-10 flex flex-wrap items-center gap-4" style={{ willChange: "transform" }}>
              <Link
                href="/try-on/live"
                className="group flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-200 to-amber-400 px-6 py-3.5 text-sm font-semibold text-neutral-900 shadow-[0_6px_24px_-6px_rgba(252,211,77,0.65)] transition-transform hover:-translate-y-1"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Start your try-on
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </Link>
              <a
                href="#how-it-works"
                className="flex items-center gap-2 rounded-full border border-[#E8DCC6]/40 bg-black/20 px-6 py-3.5 text-sm font-medium text-[#F7EEDD] backdrop-blur-sm transition-transform hover:-translate-y-1 hover:bg-black/30"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
                See how it works
              </a>
            </div>

            <div ref={featuresRef} className="mt-12 flex flex-wrap gap-3" style={{ willChange: "transform" }}>
              {HERO_FEATURES.map((f) => (
                <div
                  key={f.label}
                  className="group flex items-center gap-2 rounded-full border border-amber-200/20 bg-black/35 px-4 py-2.5 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-amber-200/40 hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.6)]"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-amber-300/15 text-amber-300 transition-transform group-hover:rotate-6">
                    {f.icon}
                  </span>
                  <span className="whitespace-pre-line text-xs font-medium leading-tight text-[#F3E8D0]">{f.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Categories -- a floating dark-glass "stage" over the fixed photo. */}
          <Reveal>
            <section id="categories" className="mx-4 rounded-t-[2.5rem] border-t border-amber-200/15 bg-black/55 px-6 py-14 backdrop-blur-xl sm:mx-6 lg:mx-8">
              <h2 className="mb-8 text-center font-[family-name:var(--font-display)] text-2xl text-[#F7EEDD]">
                <span className="mr-2 text-amber-300">✦</span>
                Every category, one workflow
                <span className="ml-2 text-amber-300">✦</span>
              </h2>
              <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible lg:grid-cols-9">
                {CATEGORIES.map((category) => (
                  <CategoryCard key={category.slug} slug={category.slug} label={category.label} />
                ))}
              </div>
            </section>
          </Reveal>

          {/* How it works */}
          <Reveal>
            <section id="how-it-works" className="mx-4 bg-black/55 px-6 py-16 backdrop-blur-xl sm:mx-6 lg:mx-8">
              <h2 className="mb-10 text-center font-[family-name:var(--font-display)] text-2xl text-[#F7EEDD]">How it works</h2>
              <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {STEPS.map((step, index) => (
                  <Reveal key={step.title} delayMs={index * 80}>
                    <div className="h-full rounded-2xl border border-amber-200/15 bg-white/[0.04] p-5 backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-amber-200/30">
                      <span className="text-xs font-semibold text-amber-300">{String(index + 1).padStart(2, "0")}</span>
                      <h3 className="mt-2 font-medium text-[#F7EEDD]">{step.title}</h3>
                      <p className="mt-1 text-sm text-[#E8DCC6]/70">{step.description}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </section>
          </Reveal>

          {/* Final CTA */}
          <Reveal>
            <section className="mx-4 rounded-b-[2.5rem] border-b border-amber-200/15 bg-gradient-to-b from-black/55 to-[#2a1708]/70 px-6 py-20 text-center backdrop-blur-xl sm:mx-6 lg:mx-8">
              <h2 className="font-[family-name:var(--font-display)] text-3xl text-[#F7EEDD]">Ready to see it on yourself?</h2>
              <p className="mt-3 text-[#E8DCC6]/70">No account required to get started.</p>
              <Link
                href="/try-on/live"
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-200 to-amber-400 px-7 py-3.5 text-sm font-semibold text-neutral-900 shadow-[0_6px_24px_-6px_rgba(252,211,77,0.65)] transition-transform hover:-translate-y-1"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Open the Try-On Studio
                <span>→</span>
              </Link>
            </section>
          </Reveal>

          <div className="h-10" />
        </main>
      </div>
    </div>
  );
}

/** One category tile -- a small, self-contained 3D-tilt-on-hover glass card driven by
 * a per-element mousemove handler (not React state), so hovering one card never
 * re-renders the page. Reuses the EXISTING catalogue icon assets (public/category-icons)
 * -- no fabricated imagery. */
function CategoryCard({ slug, label }: { slug: string; label: string }) {
  const cardRef = useRef<HTMLDivElement>(null);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card || prefersReducedMotion()) return;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(600px) rotateY(${px * 8}deg) rotateX(${py * -8}deg) translateY(-4px)`;
  }
  function handleMouseLeave() {
    if (cardRef.current) cardRef.current.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg)";
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group relative flex-none w-28 overflow-hidden rounded-2xl border border-amber-200/15 bg-black/40 p-2 backdrop-blur-sm transition-[border-color,box-shadow] duration-300 hover:border-amber-200/40 hover:shadow-[0_12px_30px_-10px_rgba(0,0,0,0.7)] sm:w-auto"
      style={{ willChange: "transform" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/category-icons/${slug}.webp`}
        alt={label}
        className="aspect-square w-full rounded-xl object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <p className="mt-2 text-center text-[11px] font-medium text-[#F3E8D0]">{label}</p>
    </div>
  );
}
