import { cx } from "@/components/ds/cx";

/**
 * RaahSetu mark: a route ("raah") bridging ("setu") an origin and a destination,
 * with a waypoint between them. Drawn inline so it needs no image asset.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cx("shrink-0", className)}>
      <rect width="32" height="32" rx="8" fill="#147060" />
      <path d="M9.5 23 C9.5 16.5 22.5 15.5 22.5 9" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="0.1 4.6" />
      <path d="M9.5 23 C9.5 16.5 22.5 15.5 22.5 9" fill="none" stroke="#addccf" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
      <circle cx="9.5" cy="23" r="3" fill="#ffffff" />
      <circle cx="22.5" cy="9" r="3.2" fill="#2bb7a7" stroke="#ffffff" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="1.6" fill="#ffffff" />
    </svg>
  );
}

export function Logo({ collapsed = false, tone = "dark" }: { collapsed?: boolean; tone?: "dark" | "light" }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <span className={cx("truncate text-[15px] font-semibold tracking-[-0.01em]", tone === "dark" ? "text-white" : "text-ink")}>
          RaahSetu<span className={cx("ml-1 text-xs font-medium", tone === "dark" ? "text-navy-300" : "text-subtle")}>2.0</span>
        </span>
      )}
    </span>
  );
}
