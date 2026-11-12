"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}
interface ToastApi {
  toast: (t: { title: string; description?: string; tone?: ToastTone }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info };
const ACCENT = { success: "text-success-600", error: "text-danger-600", info: "text-info-600" };

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.tone === "error" ? 8000 : 5000);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const t = window.setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current -= Date.now() - started;
    };
  }, [paused, item.id, onDismiss]);
  const Icon = ICON[item.tone];
  return (
    <li
      role={item.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-pop animate-toast-in"
    >
      <Icon size={18} aria-hidden className={cx("mt-px shrink-0", ACCENT[item.tone])} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{item.title}</p>
        {item.description && <p className="mt-0.5 break-words text-muted">{item.description}</p>}
      </div>
      <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss(item.id)} className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:bg-navy-50 hover:text-ink">
        <X size={14} aria-hidden />
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), []);
  const api = useMemo<ToastApi>(() => {
    const toast: ToastApi["toast"] = ({ title, description, tone = "info" }) => {
      const id = nextId.current++;
      setItems((s) => [...s.slice(-3), { id, title, description, tone }]);
    };
    return {
      toast,
      success: (title, description) => toast({ title, description, tone: "success" }),
      error: (title, description) => toast({ title, description, tone: "error" }),
      info: (title, description) => toast({ title, description, tone: "info" }),
    };
  }, []);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <section aria-label="Notifications" className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4 sm:inset-x-auto sm:right-0 sm:justify-end" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <ol className="flex w-full max-w-sm flex-col gap-2" aria-live="polite">
          {items.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}
