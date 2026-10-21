"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "./api";

interface State<T> {
  data?: T;
  error?: string;
  status?: number;
  loading: boolean;
}

/** Fetch `path` on mount/when it changes; `reload()` refetches. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ loading: path !== null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    api<T>(path).then(
      (data) => {
        if (!cancelled) setState({ data, loading: false });
      },
      (e: unknown) => {
        if (!cancelled) setState({ error: errorMessage(e), status: e instanceof ApiError ? e.status : undefined, loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
