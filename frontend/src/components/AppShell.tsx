"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { humanize } from "@/lib/format";
import { useAuth } from "./AuthProvider";

interface NavItem {
  href: string;
  label: string;
  permission?: string;
  roles?: string[];
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: "Operations", items: [
    { href: "/dashboard", label: "Control Tower", permission: "dashboard:read" },
    { href: "/orders", label: "Orders", permission: "orders:read" },
    { href: "/trips", label: "Trips & Dispatch", permission: "trips:read" },
    { href: "/optiroute", label: "OptiRoute", permission: "optimize:read" },
    { href: "/scenarios", label: "Scenarios", permission: "optimize:read" },
  ] },
  { group: "Fleet", items: [
    { href: "/vehicles", label: "Vehicles", permission: "fleet:read" },
    { href: "/drivers", label: "Drivers", permission: "fleet:read" },
    { href: "/documents", label: "Compliance", permission: "documents:read" },
    { href: "/locations", label: "Locations & Roads", permission: "locations:read" },
  ] },
  { group: "Business", items: [
    { href: "/greenfleet", label: "GreenFleet", permission: "greenfleet:read" },
    { href: "/billing", label: "Invoices & Challans", permission: "billing:read" },
  ] },
  { group: "Admin", items: [
    { href: "/users", label: "Users", permission: "users:manage" },
    { href: "/audit", label: "Audit log", permission: "audit:read" },
    { href: "/settings", label: "Settings" },
  ] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.permission || can(i.permission));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-brand-100/70">{g.group}</div>
            <ul className="mt-1.5 space-y-0.5">
              {items.map((i) => {
                const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={() => setOpen(false)}
                      className={`block rounded-md px-2 py-1.5 text-sm ${active ? "bg-white/15 font-medium text-white" : "text-brand-50/85 hover:bg-white/10 hover:text-white"}`}
                    >
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-60 shrink-0 bg-brand-900 lg:block">
        <Link href="/dashboard" className="flex items-center gap-2 px-5 pt-5 text-white">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-sm font-bold">RS</span>
          <span className="font-semibold tracking-tight">RaahSetu 2.0</span>
        </Link>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden" onClick={() => setOpen(false)}>
          <aside className="w-64 bg-brand-900" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 font-semibold text-white">RaahSetu 2.0</div>
            {nav}
          </aside>
          <div className="flex-1 bg-slate-900/40" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2.5 lg:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-md border border-line px-2 py-1 text-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              ☰
            </button>
            <span className="text-sm font-medium text-ink">{me.company.name}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">
              {me.user.name} · {humanize(me.user.role)}
            </span>
            <button onClick={logout} className="rounded-md border border-line px-2.5 py-1 hover:bg-canvas">
              Log out
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
