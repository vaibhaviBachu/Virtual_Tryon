import type { Metadata } from "next";

import { QueryProvider } from "@/components/providers/query-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Lumière | Virtual Jewellery Try-On",
  description:
    "Try on earrings, necklaces, bangles, and more from our jewellery catalogue — instantly, on your own photo.",
};

// Fonts are system-stack CSS (see globals.css) rather than next/font/google: a Docker
// build must succeed with no outbound network access to fonts.googleapis.com (the
// build-time egress this platform allows may not include it), and self-hosting webfonts
// is a Milestone 7/branding-pass concern, not a Milestone 1 platform-foundation one.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
