import { cx } from "@/components/ds/cx";

/**
 * RaahSetu brand mark — "the route to the pin".
 *
 * A location pin whose negative space is a road: the route enters through
 * the pin's tip, bends in a gentle S (raah, the path; setu, the bridge that
 * connects) and arrives at an amber destination node at the pin's centre.
 * Drawn on a 32-unit grid with no gradients or hairlines, so it stays crisp
 * at 16–32 px. Static copies live in /public/brand and app/icon.svg.
 */
export const BRAND = {
  /** Tile / pin colour (design token brand-600). */
  teal: "#147060",
  /** Destination node. */
  amber: "#e3962f",
} as const;

const PIN = "M16 27c-4.8-4.5-8.3-8.7-8.3-13.1a8.3 8.3 0 0 1 16.6 0c0 4.4-3.5 8.6-8.3 13.1z";
const ROAD = "M16 29.5c0-4.9-4.6-5.6-4.6-9.6 0-3.8 4.6-4.3 4.6-7.4";

/** Icon-only mark on its teal tile: for the sidebar, favicon-sized slots and loading states. */
export function LogoMark({ size = 32, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cx("shrink-0", className)}
    >
      <rect width="32" height="32" rx="7.5" fill={BRAND.teal} />
      <path d={PIN} fill="#ffffff" />
      {/* The road is drawn in the tile colour, so it reads as a cut-out; it runs off the pin's tip. */}
      <path d={ROAD} fill="none" stroke={BRAND.teal} strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="16" cy="11.6" r="2.3" fill={BRAND.amber} />
    </svg>
  );
}

/** Mark + "RaahSetu" wordmark. `tone="dark"` = on a dark surface (white text). */
export function Logo({ collapsed = false, tone = "dark", size = "md" }: { collapsed?: boolean; tone?: "dark" | "light"; size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className={cx("flex min-w-0 items-center", lg ? "gap-3" : "gap-2.5")}>
      <LogoMark size={lg ? 36 : 32} />
      {!collapsed && (
        <span className={cx("truncate font-semibold tracking-[-0.01em]", lg ? "text-lg" : "text-[15px]", tone === "dark" ? "text-white" : "text-ink")}>
          RaahSetu
        </span>
      )}
    </span>
  );
}
