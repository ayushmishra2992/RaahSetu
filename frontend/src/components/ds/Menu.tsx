"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type MenuItem =
  | { kind?: "item"; label: string; icon?: LucideIcon; onSelect?: () => void; href?: string; tone?: "danger" }
  | { kind: "separator" };

/**
 * Accessible dropdown menu (menu button pattern): Enter/Space/ArrowDown open it,
 * arrow keys / Home / End move between items, Escape or Tab closes it and
 * focus returns to the trigger. Clicking outside closes it.
 */
export function Menu({
  trigger,
  label,
  items,
  header,
  align = "end",
  triggerClassName,
}: {
  trigger: ReactNode;
  label: string;
  items: MenuItem[];
  header?: ReactNode;
  align?: "start" | "end";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const focusIndex = useRef(0);

  const actionable = items.map((it, i) => (it.kind === "separator" ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    itemRefs.current[actionable[focusIndex.current]]?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const move = (delta: number | "first" | "last") => {
    const n = actionable.length;
    focusIndex.current = delta === "first" ? 0 : delta === "last" ? n - 1 : (focusIndex.current + delta + n) % n;
    itemRefs.current[actionable[focusIndex.current]]?.focus();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => move("first"),
      End: () => move("last"),
      Escape: () => close(),
    };
    if (e.key === "Tab") return close(false);
    const run = actions[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex.current = e.key === "ArrowUp" ? actionable.length - 1 : 0;
      setOpen(true);
    }
  };

  const itemCls = (danger?: boolean) =>
    cx("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors", danger ? "text-danger-700 hover:bg-danger-50 focus:bg-danger-50" : "text-ink hover:bg-navy-50 focus:bg-navy-50");

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => {
          focusIndex.current = 0;
          setOpen((o) => !o);
        }}
        onKeyDown={onTriggerKey}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cx("absolute top-full z-50 mt-1.5 w-60 rounded-lg border border-line bg-surface p-1.5 shadow-pop animate-pop-in", align === "end" ? "right-0" : "left-0")}
        >
          {header && <div className="border-b border-line px-2.5 pb-2 pt-1.5 mb-1.5">{header}</div>}
          {items.map((it, i) => {
            if (it.kind === "separator") return <div key={i} role="separator" className="my-1.5 h-px bg-line" />;
            const Icon = it.icon;
            const content = (
              <>
                {Icon && <Icon size={16} aria-hidden className={it.tone === "danger" ? "" : "text-navy-400"} />}
                {it.label}
              </>
            );
            const setRef = (el: HTMLElement | null) => {
              itemRefs.current[i] = el;
            };
            return it.href ? (
              <Link key={i} ref={setRef} href={it.href} role="menuitem" tabIndex={-1} className={itemCls(it.tone === "danger")} onClick={() => close(false)}>
                {content}
              </Link>
            ) : (
              <button
                key={i}
                ref={setRef}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemCls(it.tone === "danger")}
                onClick={() => {
                  close(false);
                  it.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
