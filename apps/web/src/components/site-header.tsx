import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Decorative only -- no search/wishlist/account backend exists yet. They're rendered
// as plain non-interactive icon buttons (no onClick) so the header matches the brand
// mockup's visual density without pretending a feature is wired up.
function HeaderIconButton({ children, label, light }: { children: React.ReactNode; label: string; light?: boolean }) {
  return (
    <span
      aria-hidden="true"
      title={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full",
        light
          ? "text-neutral-500 hover:bg-[#F8EEE5]"
          : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
      )}
    >
      {children}
    </span>
  );
}

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
  </svg>
);

/**
 * `forceLight`: the Live AR hero page is a fixed brand mockup, deliberately light/ivory
 * themed regardless of the visitor's OS dark-mode preference and rendered as a floating
 * rounded pill bar (per the brand reference), rather than the rest of the app's plain
 * sticky full-width header. Default false keeps every other page unchanged.
 */
export function SiteHeader({ forceLight = false }: { forceLight?: boolean } = {}) {
  if (forceLight) {
    return (
      <header className="sticky top-4 z-20 mx-4 sm:mx-6 lg:mx-8">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between rounded-full bg-[#FFFBF6] px-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.15)] sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-[family-name:var(--font-display)] text-xl tracking-wide text-neutral-900">
            <span className="text-[#C90016]">
              <SparkleIcon />
            </span>
            Lumière
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-neutral-600 sm:flex">
            <Link href="/" className="relative text-neutral-900">
              Home
              <span className="absolute -bottom-2 left-0 right-0 h-0.5 rounded-full bg-[#C90016]" />
            </Link>
            <Link href="/#categories" className="hover:text-neutral-900">
              Categories
            </Link>
            <Link href="/#how-it-works" className="hover:text-neutral-900">
              How it works
            </Link>
          </nav>
          <div className="flex items-center gap-1">
            <div className="hidden items-center gap-1 sm:flex">
              <HeaderIconButton label="Search (coming soon)" light>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </HeaderIconButton>
              <HeaderIconButton label="Wishlist (coming soon)" light>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
                </svg>
              </HeaderIconButton>
              <HeaderIconButton label="Account (coming soon)" light>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
                </svg>
              </HeaderIconButton>
            </div>
            <Link
              href="/try-on/live"
              className="ml-2 flex items-center gap-2 rounded-full bg-[#C90016] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#A8000F]"
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
    );
  }

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/80 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-[family-name:var(--font-display)] text-xl tracking-wide">
          Lumière
        </Link>
        <nav className="flex items-center gap-6 text-sm text-neutral-600 dark:text-neutral-300">
          <Link href="/" className="hidden hover:text-neutral-900 dark:hover:text-white sm:inline">
            Home
          </Link>
          <Link href="/#categories" className="hidden hover:text-neutral-900 dark:hover:text-white sm:inline">
            Categories
          </Link>
          <Link href="/#how-it-works" className="hidden hover:text-neutral-900 dark:hover:text-white sm:inline">
            How it works
          </Link>
          <div className="hidden items-center gap-1 sm:flex">
            <HeaderIconButton label="Search (coming soon)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </HeaderIconButton>
            <HeaderIconButton label="Wishlist (coming soon)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
              </svg>
            </HeaderIconButton>
            <HeaderIconButton label="Account (coming soon)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
              </svg>
            </HeaderIconButton>
          </div>
          <Link href="/try-on/live" className={buttonVariants({ size: "sm" })}>
            Try it on
          </Link>
        </nav>
      </div>
    </header>
  );
}
