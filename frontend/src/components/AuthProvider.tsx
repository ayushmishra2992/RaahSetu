"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { ErrorState, Loading } from "./ds/Feedback";
import { LogoMark } from "./shell/Logo";

interface AuthCtx {
  me: Me;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMe(await api<Me>("/auth/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load your session");
    }
  }, [router, pathname]);

  useEffect(() => {
    let active = true;
    api<Me>("/auth/me").then(
      (m) => active && setMe(m),
      (e: unknown) => {
        if (!active) return;
        if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        else setError(e instanceof Error ? e.message : "Could not load your session");
      },
    );
    return () => {
      active = false;
    };
  }, [router]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }, [router]);

  if (error)
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-md">
          <ErrorState title="Couldn't load your session" message={error} onRetry={() => window.location.reload()} />
        </div>
      </div>
    );
  if (!me)
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4">
          <LogoMark size={40} />
          <Loading variant="inline" label="Checking your session…" />
        </div>
      </div>
    );

  return <Ctx.Provider value={{ me, can: (p) => me.permissions.includes(p), refresh: load, logout }}>{children}</Ctx.Provider>;
}
