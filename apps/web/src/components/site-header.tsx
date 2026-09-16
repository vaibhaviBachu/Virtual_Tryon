import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/80 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-xl tracking-wide"
        >
          Lumière
        </Link>
        <nav className="flex items-center gap-6 text-sm text-neutral-600 dark:text-neutral-300">
          <Link href="/#categories" className="hidden hover:text-neutral-900 dark:hover:text-white sm:inline">
            Categories
          </Link>
          <Link href="/#how-it-works" className="hidden hover:text-neutral-900 dark:hover:text-white sm:inline">
            How it works
          </Link>
          <Link href="/try-on" className={buttonVariants({ size: "sm" })}>
            Try it on
          </Link>
        </nav>
      </div>
    </header>
  );
}
