"use client";

import Link from "next/link";
import { Building2, ChevronDown, ChevronRight, LogOut, Menu as MenuIcon, UserCog } from "lucide-react";
import { IconButton } from "@/components/ds/Button";
import { Badge } from "@/components/ds/Feedback";
import { Menu } from "@/components/ds/Menu";
import { humanize } from "@/lib/format";
import type { Crumb } from "@/lib/nav";
import type { Me } from "@/lib/types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      {/* Phones: just the current page. */}
      <p className="truncate text-sm font-semibold text-ink sm:hidden">{crumbs.at(-1)?.label}</p>
      <ol className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight size={14} aria-hidden className="shrink-0 text-subtle" />}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-ink">{c.label}</span>
              ) : c.href ? (
                <Link href={c.href} className="truncate rounded text-muted hover:text-ink">{c.label}</Link>
              ) : (
                <span className="truncate text-subtle">{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Topbar({ me, crumbs, onOpenNav, onLogout }: { me: Me; crumbs: Crumb[]; onOpenNav: () => void; onLogout: () => void }) {
  const company = me.company;
  return (
    <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6 lg:px-8">
      <IconButton icon={MenuIcon} label="Open navigation" onClick={onOpenNav} className="-ml-1.5 lg:hidden" />
      <div className="min-w-0 flex-1">
        <Breadcrumbs crumbs={crumbs} />
      </div>
      <div className="hidden min-w-0 items-center gap-2 rounded-md border border-line bg-surface-muted px-2.5 py-1 md:flex" title="Company workspace">
        <Building2 size={15} aria-hidden className="shrink-0 text-navy-400" />
        <span className="max-w-[14rem] truncate text-[13px] font-medium text-ink">{company.name}</span>
        {company.city && <span className="hidden truncate text-xs text-subtle xl:inline">{company.city}</span>}
      </div>
      <Menu
        label={`Account menu for ${me.user.name}`}
        triggerClassName="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 text-left transition-colors hover:bg-navy-50"
        trigger={
          <>
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials(me.user.name)}</span>
            <span className="hidden min-w-0 leading-tight sm:block">
              <span className="block max-w-[10rem] truncate text-[13px] font-medium text-ink">{me.user.name}</span>
              <span className="block text-xs text-muted">{humanize(me.user.role)}</span>
            </span>
            <ChevronDown size={14} aria-hidden className="hidden text-subtle sm:block" />
          </>
        }
        header={
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{me.user.name}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge color="teal">{humanize(me.user.role)}</Badge>
              <span className="truncate text-xs text-muted">{company.name}</span>
            </div>
          </div>
        }
        items={[
          { label: "Account & settings", icon: UserCog, href: "/settings" },
          { kind: "separator" },
          { label: "Log out", icon: LogOut, onSelect: onLogout, tone: "danger" },
        ]}
      />
    </header>
  );
}
