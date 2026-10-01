"use client";

import { useEffect, useRef } from "react";

// Mirrors the same guarded helper used on the home page (app/page.tsx) -- jsdom (the
// test environment) and some older browsers don't implement `window.matchMedia`.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const SPARKLES = [
  { left: "12%", top: "14%", size: 5, delay: "0s", duration: "7s" },
  { left: "28%", top: "26%", size: 3, delay: "1.2s", duration: "9s" },
  { left: "8%", top: "42%", size: 4, delay: "2.1s", duration: "8s" },
  { left: "32%", top: "55%", size: 3, delay: "0.6s", duration: "10s" },
  { left: "15%", top: "68%", size: 5, delay: "3s", duration: "7.5s" },
  { left: "24%", top: "80%", size: 3, delay: "1.8s", duration: "9.5s" },
  { left: "6%", top: "88%", size: 4, delay: "2.6s", duration: "8.5s" },
] as const;

/**
 * Purely decorative "ambient jewellery stage" for the otherwise-empty left gutter of
 * the live try-on page (large viewports only -- see page.tsx's `hidden xl:block`).
 * Hand-authored SVG ornaments (no fabricated "jewellery assets" -- there is no real
 * illustration asset for this, so it's a tasteful approximation, same honesty rule
 * applied to the earlier FloralCorner/archway work this session). Every element is
 * `aria-hidden` and `pointer-events-none`; it never sits above or blocks the
 * catalogue, model, or camera. All motion (float + parallax) is skipped under
 * prefers-reduced-motion.
 */
export function AmbientJewelleryStage({ className = "" }: { className?: string }) {
  const ringRef = useRef<HTMLDivElement>(null);
  const sparkleGroupRef = useRef<HTMLDivElement>(null);
  const curveRef = useRef<HTMLDivElement>(null);

  // Subtle mouse parallax -- direct DOM transforms (never React state), skipped
  // entirely under reduced motion. Each layer moves a different amount so the stage
  // reads as having depth, same technique as the landing page's hero parallax.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    function handleMove(e: MouseEvent) {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      if (curveRef.current) curveRef.current.style.transform = `translate3d(${nx * -3}px, ${ny * -2}px, 0)`;
      if (ringRef.current) ringRef.current.style.transform = `translate3d(${nx * -6}px, ${ny * -4}px, 0)`;
      if (sparkleGroupRef.current) sparkleGroupRef.current.style.transform = `translate3d(${nx * -10}px, ${ny * -6}px, 0)`;
    }
    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div aria-hidden="true" className={`pointer-events-none select-none ${className}`}>
      {/* A faint vertical filigree curve -- champagne-on-ivory, extremely low contrast,
          echoing the jewellery-chain motif without competing with real content. */}
      <div ref={curveRef} className="absolute inset-0" style={{ willChange: "transform" }}>
        <svg viewBox="0 0 200 800" className="h-full w-full opacity-[0.14]" preserveAspectRatio="none">
          <path
            d="M100 10 C 60 90, 140 170, 100 250 S 60 410, 100 490 S 140 650, 100 730"
            fill="none"
            stroke="#C9A24A"
            strokeWidth="1.5"
          />
          {[120, 330, 560].map((cy, i) => (
            <g key={i} transform={`translate(100 ${cy})`} opacity="0.8">
              <circle r="3" fill="#C9A24A" />
              <path d="M-10 0 h20 M0 -10 v20" stroke="#C9A24A" strokeWidth="0.75" />
            </g>
          ))}
        </svg>
      </div>

      {/* A single slowly-floating gold ring outline -- the nearest/sharpest layer. */}
      <div
        ref={ringRef}
        className="absolute left-[18%] top-[30%] opacity-[0.22]"
        style={{ animation: "ambient-float-a 8s ease-in-out infinite", willChange: "transform" }}
      >
        <svg width="46" height="46" viewBox="0 0 46 46" fill="none">
          <circle cx="23" cy="23" r="15" stroke="#C9A24A" strokeWidth="2" />
          <path d="M23 8 L27 2 L19 2 Z" fill="#C9A24A" />
        </svg>
      </div>

      {/* A small cluster of soft gold sparkles -- the farthest/blurriest layer. */}
      <div ref={sparkleGroupRef} className="absolute inset-0" style={{ willChange: "transform" }}>
        {SPARKLES.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-amber-300 blur-[0.5px]"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              opacity: 0.35,
              animation: `ambient-twinkle ${s.duration} ease-in-out ${s.delay} infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes ambient-float-a {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        @keyframes ambient-twinkle {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(1.4); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="ambient-float-a"], [style*="ambient-twinkle"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
