"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Inbox, type LucideIcon } from "lucide-react";
import { cloneElement, isValidElement, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";
import { EmptyState } from "./Feedback";
import { SearchInput } from "./FormControls";

/* ─── Card ────────────────────────────────────────────────────────────────── */

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  icon: Icon,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: LucideIcon;
}) {
  const hasHeader = !!(title || actions);
  const titleId = useId();
  return (
    <section data-has-header={hasHeader} aria-labelledby={title ? titleId : undefined} className={cx("rs-card min-w-0 rounded-lg border border-line bg-surface shadow-xs", className)}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-1 pt-3.5">
          <div className="flex min-w-0 items-start gap-2">
            {Icon && <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-navy-400" />}
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="text-sm font-semibold leading-5 text-ink">
                  {title}
                </h2>
              )}
              {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("rs-card-body p-4", hasHeader && "pt-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ─── Page header ─────────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, actions, meta }: { title: string; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}

/* ─── KPI / stat ──────────────────────────────────────────────────────────── */

export function Stat({ label, value, hint, icon: Icon, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cx("min-w-0 rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-muted">{label}</span>
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-navy-300" />}
      </div>
      <div className="tabular mt-1.5 truncate text-[22px] font-semibold leading-7 tracking-[-0.01em] text-ink">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-subtle">{hint}</div>}
    </div>
  );
}

/* ─── Table (legacy API) ──────────────────────────────────────────────────── */

const thCls = "whitespace-nowrap px-3 py-2.5 text-left text-[12px] font-medium text-muted first:pl-4 last:pr-4";

export function Table({ head, children, empty, emptyMessage = "Nothing here yet.", caption }: { head: ReactNode[]; children: ReactNode; empty?: boolean; emptyMessage?: ReactNode; caption?: string }) {
  return (
    <div className="rs-table relative overflow-x-auto rounded-lg border border-line bg-surface shadow-xs">
      <table className="w-full border-collapse text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-line bg-surface-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={thCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-surface-muted">{children}</tbody>
      </table>
      {empty && (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
          <Inbox size={20} aria-hidden className="text-navy-300" />
          {emptyMessage}
        </div>
      )}
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-3 py-2.5 align-top first:pl-4 last:pr-4", className)}>{children}</td>;
}

/* ─── DataTable: client-side search, sort and pagination ─────────────────── */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  className?: string;
  /** Hide on narrow screens to keep the table readable on phones. */
  hideBelow?: "sm" | "md" | "lg";
}

const HIDE = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden" };

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = "Search…",
  toolbar,
  pageSize = 25,
  initialSort,
  empty,
  caption,
  mobileCard,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string | number;
  /** Text to match against; enables the search box when provided. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra filters rendered next to the search box. */
  toolbar?: ReactNode;
  pageSize?: number;
  initialSort?: { key: string; dir: "asc" | "desc" };
  empty?: { title: string; description?: ReactNode; icon?: LucideIcon; action?: ReactNode };
  caption?: string;
  /**
   * Card renderer for phones (< 768px). When given, phones get a card list
   * instead of a horizontally scrolling table; wider screens keep the table.
   */
  mobileCard?: (row: T) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col?.sortValue) {
      const get = col.sortValue;
      const dir = sort!.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "en-IN", { numeric: true })) * dir;
      });
    }
    return out;
  }, [rows, query, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  };

  return (
    <div>
      {(searchText || toolbar) && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {searchText && (
            <SearchInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
            />
          )}
          {toolbar}
        </div>
      )}
      {rows.length === 0 && empty ? (
        <EmptyState title={empty.title} icon={empty.icon ?? Inbox} action={empty.action}>
          {empty.description}
        </EmptyState>
      ) : (
        <>
        {mobileCard && (
          <div className="md:hidden">
            <ul aria-label={caption} className="space-y-2">
              {visible.map((r) => (
                <li key={rowKey(r)}>{mobileCard(r)}</li>
              ))}
            </ul>
            {filtered.length === 0 && <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm text-muted">No results match “{query}”.</p>}
            {filtered.length > pageSize && (
              <div className="mt-2 rounded-lg border border-line bg-surface">
                <Pagination page={current} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} />
              </div>
            )}
          </div>
        )}
        <div className={cx("rs-table relative overflow-x-auto rounded-lg border border-line bg-surface shadow-xs", mobileCard && "max-md:hidden")}>
          <table className="w-full border-collapse text-left text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cx(thCls, c.align === "right" && "text-right", c.hideBelow && HIDE[c.hideBelow])}
                    >
                      {c.sortValue ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className={cx("inline-flex items-center gap-1 rounded hover:text-ink", active && "text-ink")}>
                          {c.header}
                          {active ? sort!.dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden /> : <ChevronsUpDown size={12} aria-hidden className="opacity-50" />}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-surface-muted">
              {visible.map((r) => (
                <tr key={rowKey(r)}>
                  {columns.map((c) => (
                    <td key={c.key} className={cx("px-3 py-2.5 align-top first:pl-4 last:pr-4", c.align === "right" && "tabular whitespace-nowrap text-right", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">No results match “{query}”.</p>}
          {filtered.length > pageSize && <Pagination page={current} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} />}
        </div>
        </>
      )}
    </div>
  );
}

export function Pagination({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const from = page * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)} />
        <span className="tabular px-1" aria-current="page">
          Page {page + 1} of {pages}
        </span>
        <IconButton icon={ChevronRight} label="Next page" size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}

/* ─── ListCard: one record as a card (mobile lists) ─────────────────────── */

/** Compact record card used for phone layouts: title + status, details, actions. */
export function ListCard({ title, status, subtitle, details, actions }: { title: ReactNode; status?: ReactNode; subtitle?: ReactNode; details?: Array<[label: string, value: ReactNode, wide?: boolean]>; actions?: ReactNode }) {
  return (
    <article className="rounded-lg border border-line bg-surface px-4 py-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-medium text-ink">{title}</div>
        {status && <div className="flex shrink-0 flex-wrap justify-end gap-1">{status}</div>}
      </div>
      {subtitle && <div className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</div>}
      {details && details.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          {details.map(([k, v, wide]) => (
            <div key={k} className={cx("min-w-0", wide && "col-span-2")}>
              <dt className="text-subtle">{k}</dt>
              <dd className={cx("text-ink", wide ? "break-words" : "truncate")}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions && <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">{actions}</div>}
    </article>
  );
}

/* ─── Tabs ────────────────────────────────────────────────────────────────── */

export function Tabs({ tabs, value, onChange, label }: { tabs: Array<{ id: string; label: ReactNode; count?: number }>; value: string; onChange: (id: string) => void; label: string }) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${base}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              selected ? "border-brand-600 text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.count != null && <span className={cx("tabular rounded-full px-1.5 text-xs", selected ? "bg-brand-50 text-brand-700" : "bg-navy-50 text-navy-500")}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Tooltip ─────────────────────────────────────────────────────────────── */

/** Short text hint on hover and keyboard focus. The trigger is described by it (aria-describedby). */
export function Tooltip({ content, children, side = "top" }: { content: string; children: ReactNode; side?: "top" | "right" | "bottom" }) {
  const id = useId();
  const pos = side === "right" ? "left-full top-1/2 ml-2 -translate-y-1/2" : side === "bottom" ? "top-full left-1/2 mt-2 -translate-x-1/2" : "bottom-full left-1/2 mb-2 -translate-x-1/2";
  return (
    <span className="group/tt relative inline-flex">
      {isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": id }) : children}
      <span
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-navy-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-pop transition-opacity delay-150 duration-150",
          "group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          pos,
        )}
      >
        {content}
      </span>
    </span>
  );
}
