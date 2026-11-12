"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/45",
  secondary: "bg-surface text-ink border border-line-strong shadow-xs hover:bg-surface-muted hover:border-navy-300 active:bg-navy-50 disabled:text-subtle disabled:bg-surface",
  ghost: "text-brand-700 hover:bg-brand-50 active:bg-brand-100 disabled:text-subtle disabled:bg-transparent",
  danger: "bg-danger-600 text-white shadow-xs hover:bg-danger-700 disabled:bg-danger-600/45",
  subtle: "bg-navy-50 text-navy-700 hover:bg-navy-100 disabled:text-subtle",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};
const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

const BASE = "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed [&>svg]:shrink-0";

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cx(BASE, VARIANTS[variant], SIZES[size], className);
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <span aria-hidden className={cx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", className)} style={{ width: size, height: size }} />;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, iconRight: IconRight, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buttonClasses(variant, size, className)}>
      {loading ? <Spinner size={ICON_SIZE[size]} /> : Icon && <Icon size={ICON_SIZE[size]} aria-hidden strokeWidth={2} />}
      {children}
      {IconRight && !loading && <IconRight size={ICON_SIZE[size]} aria-hidden strokeWidth={2} />}
    </button>
  );
});

/** Square icon-only button. `label` is required: it becomes the accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "children" | "icon"> & { icon: LucideIcon; label: string }>(function IconButton(
  { icon: Icon, label, variant = "ghost", size = "md", className, type = "button", ...rest },
  ref,
) {
  // Square: fixed width/height and no horizontal padding (not the text-button sizes).
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-10 w-10" : "h-9 w-9";
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      {...rest}
      className={cx(BASE, variant === "ghost" ? "text-navy-600 hover:bg-navy-50 hover:text-ink active:bg-navy-100" : VARIANTS[variant], dim, className)}
    >
      <Icon size={ICON_SIZE[size] + 2} aria-hidden strokeWidth={1.9} />
    </button>
  );
});

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  className,
  ...rest
}: { href: string; children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...rest}>
      {Icon && <Icon size={ICON_SIZE[size]} aria-hidden />}
      {children}
    </Link>
  );
}
