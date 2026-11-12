"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { Alert } from "./Feedback";
import { Dialog } from "./Overlay";

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for destructive actions (red button, Cancel focused first). */
  tone?: "danger" | "primary";
  /**
   * Optional work to run on confirm. The dialog stays open with a spinner while
   * it runs; if it throws, the error is shown in the dialog and nothing closes.
   */
  action?: () => unknown | Promise<unknown>;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Ask the user to confirm. Resolves true when confirmed (and `action`, if any, succeeded). */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    // A new request replaces any unanswered one (treated as cancelled).
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const p = { ...o, resolve };
      pendingRef.current = p;
      setError(null);
      setBusy(false);
      setPending(p);
    });
  }, []);

  const finish = (ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
    setBusy(false);
    setError(null);
  };

  const onConfirm = async () => {
    if (!pending) return;
    if (!pending.action) return finish(true);
    setBusy(true);
    setError(null);
    try {
      await pending.action();
      finish(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const danger = (pending?.tone ?? "danger") === "danger";
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!pending}
        size="sm"
        dismissible={!busy}
        onClose={() => finish(false)}
        title={pending?.title}
        description={pending?.description}
        footer={
          <>
            <Button variant="secondary" onClick={() => finish(false)} disabled={busy} data-autofocus={danger ? "" : undefined}>
              {pending?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm} data-autofocus={danger ? undefined : ""}>
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {error ? <Alert kind="error">{error}</Alert> : null}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Legacy API (ui.tsx): a button that confirms before running `onConfirm`.
 * Previously an inline "Confirm / Cancel" pair; now a confirmation dialog.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Confirm",
  variant = "secondary",
  size = "md",
  title,
  description,
  tone = "danger",
}: {
  onConfirm: () => Promise<void> | void;
  children: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  title?: ReactNode;
  description?: ReactNode;
  tone?: "danger" | "primary";
}) {
  const confirm = useConfirm();
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() =>
        confirm({
          title: title ?? `${confirmLabel}?`,
          description: description ?? "This action can't be undone from here.",
          confirmLabel,
          tone,
          action: onConfirm,
        })
      }
    >
      {children}
    </Button>
  );
}
