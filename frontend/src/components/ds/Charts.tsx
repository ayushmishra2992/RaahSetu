"use client";

/**
 * Small, dependency-free charts for real API data. Each chart pairs colour
 * with a text label (legend or row label) and exposes a text summary to
 * assistive technology, so nothing is communicated by colour alone.
 */
import { useId, useState, type ReactNode } from "react";
import { humanize } from "@/lib/format";
import { cx } from "./cx";
import { STATUS_TONE, type Tone } from "./Feedback";

const FILL: Record<Tone, string> = {
  green: "bg-success-600",
  blue: "bg-info-600",
  amber: "bg-warning-600",
  red: "bg-danger-600",
  gray: "bg-navy-300",
  violet: "bg-violet-600",
  teal: "bg-brand-500",
};

export interface Segment {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

/** Turn a `{ STATUS: count }` map into ordered, labelled segments. */
export function statusSegments(counts: Record<string, number> | undefined, order: string[]): Segment[] {
  const c = counts ?? {};
  const keys = [...order.filter((k) => k in c), ...Object.keys(c).filter((k) => !order.includes(k))];
  return keys.map((k) => ({ key: k, label: humanize(k), value: c[k] ?? 0, tone: STATUS_TONE[k] ?? "gray" })).filter((s) => s.value > 0);
}

/**
 * 100% stacked bar with a legend that carries the numbers. A 2px gap separates
 * segments; each segment has a native tooltip.
 */
export function StackedBar({ segments, label, emptyText = "No records yet", legend = true }: { segments: Segment[]; label: string; emptyText?: string; legend?: boolean }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const summary = total ? `${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")} (total ${total})` : `${label}: ${emptyText}`;
  return (
    <div>
      <div role="img" aria-label={summary} className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-navy-50">
        {segments.map((s) => (
          <span key={s.key} title={`${s.label}: ${s.value}`} className={cx("h-full first:rounded-l-full last:rounded-r-full", FILL[s.tone])} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
      </div>
      {legend &&
        (total ? (
          <ul aria-hidden className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {segments.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <span className={cx("h-2 w-2 rounded-full", FILL[s.tone])} />
                {s.label}
                <span className="tabular font-semibold text-ink">{s.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-subtle">{emptyText}</p>
        ))}
    </div>
  );
}

/** Single-value meter (e.g. load vs capacity). Turns amber/red past the thresholds. */
export function Meter({ value, max, label, warnAt = 0.9, format = (v) => String(v), percentOnly = false }: { value: number; max: number; label: string; warnAt?: number; format?: (v: number) => string; percentOnly?: boolean }) {
  const ratio = max > 0 ? value / max : 0;
  const tone: Tone = ratio > 1 ? "red" : ratio >= warnAt ? "amber" : "teal";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular font-medium text-ink">
          {percentOnly ? (
            `${Math.round(ratio * 100)}%`
          ) : (
            <>
              {format(value)} / {format(max)} {max > 0 && <span className="text-muted">({Math.round(ratio * 100)}%)</span>}
            </>
          )}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${format(value)} of ${format(max)}`}
        className="h-2 overflow-hidden rounded-full bg-navy-50"
      >
        <div className={cx("h-full rounded-full transition-[width] duration-300", FILL[tone])} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

/** Horizontal single-series bars with the value printed beside each row. */
export function BarList({ rows, label, format = (v) => String(v), tone = "teal" }: { rows: Array<{ key: string; label: ReactNode; value: number }>; label: string; format?: (v: number) => string; tone?: Tone }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-xs sm:grid-cols-[minmax(0,10rem)_1fr_5.5rem]">
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2 rounded-full bg-navy-50">
            <span className={cx("block h-2 rounded-full", FILL[tone])} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </span>
          <span className="tabular text-right font-medium text-ink">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two series per row (e.g. estimated vs logged). Legend always shown. */
export function PairedBars({
  rows,
  series,
  label,
  format = (v) => String(v),
}: {
  rows: Array<{ key: string; label: ReactNode; a: number | null; b: number | null }>;
  series: [string, string];
  label: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a ?? 0, r.b ?? 0]));
  const bar = (v: number | null, cls: string, name: string) => (
    <span className="flex items-center gap-2">
      <span className="h-2 flex-1 rounded-full bg-navy-50">
        <span title={`${name}: ${v == null ? "—" : format(v)}`} className={cx("block h-2 rounded-full", cls)} style={{ width: `${((v ?? 0) / max) * 100}%` }} />
      </span>
      <span className="tabular w-20 text-right text-ink">{v == null ? "—" : format(v)}</span>
    </span>
  );
  return (
    <div>
      <ul aria-hidden className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <li className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-navy-600" />{series[0]}</li>
        <li className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-accent-500" />{series[1]}</li>
      </ul>
      <table className="w-full text-xs">
        <caption className="sr-only">{label}</caption>
        <thead className="sr-only">
          <tr><th scope="col">Item</th><th scope="col">{series[0]}</th><th scope="col">{series[1]}</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="w-28 py-2 pr-3 text-left align-middle font-medium text-ink sm:w-36">{r.label}</th>
              <td className="py-2 align-middle">
                <div className="space-y-1">
                  {bar(r.a, "bg-navy-600", series[0])}
                  {bar(r.b, "bg-accent-500", series[1])}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Line chart for a single series with a hover/focus readout. */
export function LineChart({
  points,
  label,
  xLabel,
  format = (v) => String(v),
  height = 160,
}: {
  points: Array<{ x: number; y: number }>;
  label: string;
  xLabel: string;
  format?: (v: number) => string;
  height?: number;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="text-sm text-muted">Not enough data points to chart.</p>;
  const W = 600;
  const H = height;
  const pad = { l: 8, r: 8, t: 12, b: 8 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const h = hover == null ? null : points[hover];
  const nearest = (clientX: number, rect: DOMRect) => {
    const vx = ((clientX - rect.left) / rect.width) * W; // viewBox units
    const x = x0 + ((vx - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(points[best].x - x)) best = i;
    });
    return best;
  };
  return (
    <figure>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none overflow-visible"
          role="img"
          aria-labelledby={`${id}-t`}
          onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
        >
          <title id={`${id}-t`}>{`${label}: from ${format(points[0].y)} to ${format(points[points.length - 1].y)} over ${points.length} points`}</title>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} className="stroke-line" strokeWidth={1} />
          ))}
          <path d={d} fill="none" className="stroke-brand-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {h && (
            <>
              <line x1={sx(h.x)} x2={sx(h.x)} y1={pad.t} y2={H - pad.b} className="stroke-navy-300" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={sx(h.x)} cy={sy(h.y)} r={5} className="fill-brand-600 stroke-surface" strokeWidth={2} />
            </>
          )}
        </svg>
        {h && (
          <div className="pointer-events-none absolute right-2 top-0 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-pop">
            <span className="text-muted">{xLabel} {h.x}: </span>
            <span className="tabular font-semibold text-ink">{format(h.y)}</span>
          </div>
        )}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-[11px] text-muted">
        <span>
          {xLabel} {x0}
        </span>
        <span>{x1}</span>
      </div>
      <figcaption className="mt-1 text-xs text-muted">
        {label}: {format(points[0].y)} → {format(points[points.length - 1].y)}
      </figcaption>
    </figure>
  );
}
