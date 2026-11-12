"use client";

import type { ReactNode } from "react";
import { ConfirmProvider } from "./ds/Confirm";
import { ToastProvider } from "./ds/Toast";

/** App-wide client providers: toast notifications and confirmation dialogs. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
