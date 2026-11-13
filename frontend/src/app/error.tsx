"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ds";

/**
 * Route-level error boundary. Users see a plain explanation and a reference,
 * never the raw error message (which can contain internal details); the full
 * error goes to the browser console for developers.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-[60vh] place-items-center p-6">
      <div role="alert" className="w-full max-w-md rounded-lg border border-line bg-surface p-6 text-center shadow-xs">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-danger-50 text-danger-600">
          <AlertTriangle size={20} aria-hidden />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted">This page hit an unexpected problem. Your data hasn’t been changed by this error. Try again, or go back to the Control Tower.</p>
        {error.digest && <p className="mt-2 text-xs text-subtle">Reference: {error.digest}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button icon={RotateCcw} onClick={reset}>
            Try again
          </Button>
          <Link href="/dashboard" className="inline-flex h-9 items-center rounded-md border border-line-strong px-3.5 text-sm font-medium text-ink hover:bg-surface-muted">
            Control Tower
          </Link>
        </div>
      </div>
    </main>
  );
}
