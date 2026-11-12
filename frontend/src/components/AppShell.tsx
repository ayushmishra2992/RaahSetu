"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Drawer } from "@/components/ds/Overlay";
import { breadcrumbsFor, visibleNav } from "@/lib/nav";
import { useAuth } from "./AuthProvider";
import { Logo } from "./shell/Logo";
import { NavList, Sidebar } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";

const COLLAPSE_KEY = "rs.sidebar.collapsed";

function initialCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // Storage unavailable (private mode / blocked) — fall through to the default.
  }
  // No preference yet: use the icon rail on laptop-width screens.
  return window.innerWidth < 1280;
}

/**
 * Authenticated application frame: collapsible sidebar (desktop), navigation
 * drawer (tablet/phone), top bar with breadcrumbs, company context and account
 * menu. Rendered only after AuthProvider has loaded the session, so it never
 * server-renders and can read browser state directly.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [navOpen, setNavOpen] = useState(false);

  const groups = useMemo(() => visibleNav(can), [can]);
  const crumbs = useMemo(() => breadcrumbsFor(pathname), [pathname]);

  // Close the drawer on navigation; give each page a descriptive document title.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setNavOpen(false);
  }
  useEffect(() => {
    // Pages are client components without per-route metadata, and Next re-applies
    // the root layout's static title after client navigations — so keep ours in place.
    const title = `${crumbs.at(-1)?.label ?? "RaahSetu"} · RaahSetu`;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [crumbs]);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        // Not persisted; the toggle still works for this visit.
      }
      return !c;
    });

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm font-medium text-ink shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to main content
      </a>
      <Sidebar groups={groups} pathname={pathname} collapsed={collapsed} onToggle={toggle} companyName={me.company.name} />
      <Drawer open={navOpen} onClose={() => setNavOpen(false)} title="Navigation" hideTitle side="left" width="w-[min(18rem,86vw)]" className="bg-navy-950 text-white">
        <div className="flex h-14 items-center border-b border-white/[0.06] px-5">
          <Logo />
        </div>
        <p className="truncate px-6 pt-4 text-xs text-navy-400">{me.company.name}</p>
        <NavList groups={groups} pathname={pathname} onNavigate={() => setNavOpen(false)} />
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar me={me} crumbs={crumbs} onOpenNav={() => setNavOpen(true)} onLogout={logout} />
        <main id="main" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
