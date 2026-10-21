"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { humanize } from "@/lib/format";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "bg-white text-ink border border-line hover:bg-canvas disabled:text-muted",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
  ghost: "text-brand-700 hover:bg-brand-50",
};

export function Button({ variant = "primary", loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed", variants[variant], className)}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: Variant }) {
  return (
    <Link href={href} className={cx("inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium", variants[variant])}>
      {children}
    </Link>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-white", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tone: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  gray: "bg-slate-100 text-slate-600 ring-slate-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

const statusTone: Record<string, keyof typeof tone> = {
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
  URGENT: "red",
  HIGH: "amber",
  NORMAL: "gray",
  LOW: "gray",
  critical: "red",
  warning: "amber",
  info: "blue",
};

export function Badge({ children, color = "gray" }: { children: ReactNode; color?: keyof typeof tone }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tone[color])}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge color={statusTone[status] ?? "gray"}>{humanize(status)}</Badge>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none disabled:bg-canvas";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputCls, props.className)}>
      {children}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputCls, props.className)} />;
}

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", styles[kind])}>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-medium underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("w-full rounded-lg bg-white shadow-xl", wide ? "max-w-3xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-canvas">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-8 text-center text-sm text-muted">Nothing here yet.</p>}
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-3 py-2.5 align-top", className)}>{children}</td>;
}

/** Button that asks for confirmation inline instead of a browser dialog. */
export function ConfirmButton({ onConfirm, children, confirmLabel = "Confirm", variant = "secondary" }: { onConfirm: () => Promise<void> | void; children: ReactNode; confirmLabel?: string; variant?: Variant }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <Button variant={variant} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  return (
    <span className="inline-flex gap-1">
      <Button
        variant="danger"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="secondary" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function SyntheticNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{children}</p>;
}
