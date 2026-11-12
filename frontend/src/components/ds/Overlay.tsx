"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";

let lockCount = 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Drives a native modal <dialog>: showModal()/close() follow `open`, Escape and
 * backdrop clicks call onClose (unless `dismissible` is false), page scroll is
 * locked while open, and focus returns to the element that opened it.
 */
function useModalDialog(ref: RefObject<HTMLDialogElement | null>, open: boolean, onClose: () => void, dismissible: boolean) {
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    lockCount += 1;
    document.documentElement.classList.add("rs-scroll-locked");
    // Prefer an explicitly marked element, then the first field, then the dialog itself.
    const target = d.querySelector<HTMLElement>("[data-autofocus]") ?? d.querySelector<HTMLElement>(`[data-dialog-body] :is(${FOCUSABLE})`) ?? d;
    target.focus({ preventScroll: true });

    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissibleRef.current) onCloseRef.current();
    };
    d.addEventListener("cancel", onCancel);
    return () => {
      d.removeEventListener("cancel", onCancel);
      if (d.open) d.close();
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.documentElement.classList.remove("rs-scroll-locked");
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);

  /** Close when the backdrop (the <dialog> element itself) is clicked. */
  return (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && dismissibleRef.current) onCloseRef.current();
  };
}

const DIALOG_WIDTH = { sm: "w-[min(26rem,calc(100vw-2rem))]", md: "w-[min(34rem,calc(100vw-2rem))]", lg: "w-[min(50rem,calc(100vw-2rem))]" };

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onBackdrop = useModalDialog(ref, open, onClose, dismissible);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onMouseDown={onBackdrop}
      className={cx("rs-dialog m-auto max-h-[min(88dvh,56rem)] overflow-hidden rounded-xl bg-surface p-0 text-ink shadow-pop outline-none animate-pop-in", DIALOG_WIDTH[size])}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold leading-6 text-ink">{title}</h2>
            {description && <div id={descId} className="mt-1 text-sm text-muted">{description}</div>}
          </div>
          {dismissible && <IconButton icon={X} label="Close dialog" size="sm" onClick={onClose} className="-mr-1.5 -mt-1" />}
        </header>
        {children && <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <footer className="flex flex-col-reverse gap-2 border-t border-line bg-surface-muted px-5 py-3 sm:flex-row sm:justify-end">{footer}</footer>}
      </div>
    </dialog>
  );
}

/** Legacy API (ui.tsx): same props as before, now an accessible native dialog. */
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog open={open} title={title} onClose={onClose} size={wide ? "lg" : "md"}>
      {children}
    </Dialog>
  );
}

/** Side sheet (navigation on mobile, detail panels). */
export function Drawer({
  open,
  onClose,
  title,
  side = "right",
  children,
  hideTitle = false,
  width = "w-[min(24rem,88vw)]",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right";
  children: ReactNode;
  hideTitle?: boolean;
  width?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onBackdrop = useModalDialog(ref, open, onClose, true);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onMouseDown={onBackdrop}
      className={cx(
        "rs-dialog fixed inset-y-0 m-0 h-dvh max-h-none max-w-none overflow-hidden p-0 shadow-pop outline-none",
        side === "left" ? "left-0 right-auto animate-slide-in-left" : "left-auto right-0 animate-slide-in-right",
        width,
        className ?? "bg-surface text-ink",
      )}
    >
      <div className="flex h-full flex-col">
        <h2 id={titleId} className={hideTitle ? "sr-only" : "border-b border-line px-5 py-4 text-base font-semibold"}>
          {title}
        </h2>
        <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </dialog>
  );
}
