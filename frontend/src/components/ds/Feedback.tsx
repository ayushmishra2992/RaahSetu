"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Info, RotateCcw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { humanize } from "@/lib/format";
import { Button } from "./Button";
import { cx } from "./cx";

/* ─── Badges ──────────────────────────────────────────────────────────────── */

export type Tone = "green" | "blue" | "amber" | "red" | "gray" | "violet" | "teal";

const TONE: Record<Tone, { badge: string; dot: string }> = {
  green: { badge: "bg-success-50 text-success-700 ring-success-600/20", dot: "bg-success-600" },
  blue: { badge: "bg-info-50 text-info-700 ring-info-600/20", dot: "bg-info-600" },
  amber: { badge: "bg-warning-50 text-warning-700 ring-warning-600/25", dot: "bg-warning-600" },
  red: { badge: "bg-danger-50 text-danger-700 ring-danger-600/20", dot: "bg-danger-600" },
  gray: { badge: "bg-navy-50 text-navy-600 ring-navy-300/40", dot: "bg-navy-400" },
  violet: { badge: "bg-violet-50 text-violet-700 ring-violet-600/20", dot: "bg-violet-600" },
  teal: { badge: "bg-brand-50 text-brand-700 ring-brand-600/20", dot: "bg-brand-500" },
};

/** Status → tone. One table for the whole app so a status always looks the same. */
export const STATUS_TONE: Record<string, Tone> = {
  AVAILABLE: "green",
  ON_TRIP: "blue",
  MAINTENANCE: "amber",
  INACTIVE: "gray",
  OFF_DUTY: "gray",
  PENDING: "amber",
  ASSIGNED: "blue",
  IN_TRANSIT: "violet",
  DELIVERED: "green",
  CANCELLED: "gray",
  PLANNED: "gray",
  DISPATCHED: "blue",
  COMPLETED: "green",
  ARRIVED: "violet",
  SKIPPED: "gray",
  DRAFT: "gray",
  ISSUED: "blue",
  PAID: "green",
  EVALUATED: "amber",
  APPROVED: "green",
  REJECTED: "gray",
  EXPIRED: "red",
  EXPIRING_SOON: "amber",
  VALID: "green",
  NO_EXPIRY: "gray",
  COMPLIANT: "green",
  MISSING: "red",
  PENDING_VERIFICATION: "amber",
  NOT_APPLICABLE: "gray",
  VERIFIED: "green",
  ACTIVE: "green",
  PARTIALLY_DELIVERED: "amber",
  FAILED: "red",
  RETURNED: "gray",
  DISPUTED: "red",
  URGENT: "red",
  HIGH: "amber",
  NORMAL: "gray",
  LOW: "gray",
  critical: "red",
  warning: "amber",
  info: "blue",
};

export function Badge({ children, color = "gray", dot = false, className }: { children: ReactNode; color?: Tone; dot?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[color].badge, className)}>
      {dot && <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", TONE[color].dot)} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: ReactNode }) {
  return (
    <Badge color={STATUS_TONE[status] ?? "gray"} dot>
      {label ?? humanize(status)}
    </Badge>
  );
}

/* ─── Alerts ──────────────────────────────────────────────────────────────── */

type AlertKind = "error" | "info" | "success" | "warning";
const ALERT: Record<AlertKind, { cls: string; icon: LucideIcon }> = {
  error: { cls: "border-danger-600/25 bg-danger-50 text-danger-700", icon: AlertCircle },
  info: { cls: "border-info-600/20 bg-info-50 text-info-700", icon: Info },
  success: { cls: "border-success-600/25 bg-success-50 text-success-700", icon: CheckCircle2 },
  warning: { cls: "border-warning-600/25 bg-warning-50 text-warning-700", icon: AlertTriangle },
};

export function Alert({ kind = "error", title, children, className }: { kind?: AlertKind; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { cls, icon: Icon } = ALERT[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm", cls, className)}>
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(!!title && "mt-0.5", "[&_a]:underline")}>{children}</div>}
      </div>
    </div>
  );
}

/** Clearly marked note for estimated or simulated values. */
export function SyntheticNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-md border border-warning-600/20 bg-warning-50 px-3 py-2 text-xs text-warning-700">
      <Info size={14} aria-hidden className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/* ─── Loading ─────────────────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block animate-pulse rounded-md bg-navy-100/70", className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={cx("block space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </span>
  );
}

/** Placeholder rows shaped like a table while data loads. */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex gap-4 border-b border-line bg-surface-muted px-4 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-line px-4 py-3.5 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cx("h-3 flex-1", c === 0 && "max-w-[9rem]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Generic loading state: a page-shaped skeleton for screen-level loads,
 * with a visually hidden label for assistive technology.
 */
export function Loading({ label = "Loading…", variant = "block" }: { label?: string; variant?: "block" | "page" | "inline" }) {
  if (variant === "inline") {
    return (
      <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
        <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        {label}
      </span>
    );
  }
  return (
    <div role="status" aria-live="polite" className="py-2">
      <span className="sr-only">{label}</span>
      {variant === "page" ? (
        <div aria-hidden className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[84px]" />
            ))}
          </div>
          <TableSkeleton />
        </div>
      ) : (
        <div aria-hidden className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <TableSkeleton rows={4} />
        </div>
      )}
    </div>
  );
}

/* ─── Empty & error ───────────────────────────────────────────────────────── */

export function EmptyState({ title, children, icon: Icon, action, compact }: { title: string; children?: ReactNode; icon?: LucideIcon; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface text-center", compact ? "px-4 py-6" : "px-6 py-12")}>
      {Icon && (
        <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-brand-600">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, title = "Couldn't load this" }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger-600/25 bg-danger-50 px-4 py-4 text-sm text-danger-700 sm:flex-row sm:items-center">
      <AlertCircle size={18} aria-hidden className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 break-words">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
