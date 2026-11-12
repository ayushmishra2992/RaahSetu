"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cx } from "@/components/ds/cx";
import { isActive, type NavGroup } from "@/lib/nav";
import { Logo } from "./Logo";

/** Navigation list shared by the desktop sidebar and the mobile drawer. */
export function NavList({ groups, pathname, collapsed = false, onNavigate }: { groups: NavGroup[]; pathname: string; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {groups.map((g) => (
        <div key={g.group}>
          {collapsed ? (
            <div aria-hidden className="mx-2 mb-2 h-px bg-white/10" />
          ) : (
            <div className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-400">{g.group}</div>
          )}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = isActive(pathname, i.href);
              const Icon = i.icon;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? i.label : undefined}
                    className={cx(
                      "group relative flex h-9 items-center gap-3 rounded-md text-sm transition-colors",
                      collapsed ? "justify-center px-0" : "px-2.5",
                      active ? "bg-white/[0.09] font-medium text-white" : "text-navy-200 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent-400" />}
                    <Icon size={18} aria-hidden strokeWidth={1.8} className={cx("shrink-0", active ? "text-accent-400" : "text-navy-300 group-hover:text-navy-100")} />
                    <span className={collapsed ? "sr-only" : "truncate"}>{i.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop sidebar (≥1024px). Collapses to an icon rail. */
export function Sidebar({ groups, pathname, collapsed, onToggle, companyName }: { groups: NavGroup[]; pathname: string; collapsed: boolean; onToggle: () => void; companyName: string }) {
  return (
    <aside
      className={cx(
        "no-print sticky top-0 hidden h-dvh shrink-0 flex-col bg-navy-950 transition-[width] duration-200 ease-out lg:flex",
        collapsed ? "w-[68px]" : "w-[248px]",
      )}
    >
      <div className={cx("flex h-14 shrink-0 items-center border-b border-white/[0.06]", collapsed ? "justify-center px-0" : "px-5")}>
        <Link href="/dashboard" aria-label="RaahSetu — Control Tower" className="rounded-md">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
        <NavList groups={groups} pathname={pathname} collapsed={collapsed} />
      </div>
      <div className="shrink-0 border-t border-white/[0.06] p-3">
        {!collapsed && <p className="mb-2 truncate px-2.5 text-xs text-navy-400" title={companyName}>{companyName}</p>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cx("flex h-9 w-full items-center gap-3 rounded-md text-sm text-navy-300 transition-colors hover:bg-white/[0.05] hover:text-white", collapsed ? "justify-center" : "px-2.5")}
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
