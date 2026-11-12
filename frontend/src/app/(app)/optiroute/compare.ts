/**
 * Direction-aware comparison of two OptiRoute results (also used for
 * scenario before/after deltas). "better" depends on the metric: fewer km is
 * better, more served orders is better, runtime and vehicles used are neutral.
 */
import type { RunResult } from "@/lib/types";

export type Direction = "lower" | "higher" | "neutral";
export type Verdict = "better" | "worse" | "same" | "neutral";

export function verdict(delta: number, direction: Direction, epsilon = 1e-6): Verdict {
  if (Math.abs(delta) <= epsilon) return "same";
  if (direction === "neutral") return "neutral";
  return (direction === "lower" ? delta < 0 : delta > 0) ? "better" : "worse";
}

export interface CompareRow {
  key: string;
  label: string;
  a: number;
  b: number;
  delta: number;
  verdict: Verdict;
  format: "num" | "int" | "money" | "minutes" | "ms";
}

const METRICS: Array<{ key: string; label: string; get: (r: RunResult) => number; direction: Direction; format: CompareRow["format"] }> = [
  { key: "objective", label: "Objective J", get: (r) => r.objective.total, direction: "lower", format: "num" },
  { key: "served", label: "Served orders", get: (r) => r.totals.servedOrders, direction: "higher", format: "int" },
  { key: "unserved", label: "Unserved orders", get: (r) => r.unserved.length, direction: "lower", format: "int" },
  { key: "vehicles", label: "Vehicles used", get: (r) => r.totals.vehiclesUsed, direction: "neutral", format: "int" },
  { key: "distance", label: "Distance (km)", get: (r) => r.totals.distanceKm, direction: "lower", format: "num" },
  { key: "duration", label: "Route time", get: (r) => r.totals.durationMin, direction: "lower", format: "minutes" },
  { key: "cost", label: "Est. operating cost", get: (r) => r.totals.operatingCost, direction: "lower", format: "money" },
  { key: "co2", label: "Est. CO₂ (kg)", get: (r) => r.totals.co2Kg, direction: "lower", format: "num" },
  { key: "lateness", label: "Lateness (min)", get: (r) => r.totals.latenessMin, direction: "lower", format: "num" },
  { key: "runtime", label: "Solver runtime", get: (r) => r.runtimeMs, direction: "neutral", format: "ms" },
];

export function compareRuns(a: RunResult, b: RunResult): CompareRow[] {
  return METRICS.map((m) => {
    const va = m.get(a);
    const vb = m.get(b);
    return { key: m.key, label: m.label, a: va, b: vb, delta: vb - va, verdict: verdict(vb - va, m.direction), format: m.format };
  });
}

export function sameOrders(a: RunResult, b: RunResult): boolean {
  const ka = Object.keys(a.orders).filter((k) => !a.orders[k].virtual).sort();
  const kb = Object.keys(b.orders).filter((k) => !b.orders[k].virtual).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Scenario comparison keys (backend `comparison.delta`) → direction. */
export const SCENARIO_DIRECTION: Record<string, Direction> = {
  objective: "lower",
  distanceKm: "lower",
  durationMin: "lower",
  operatingCost: "lower",
  co2Kg: "lower",
  latenessMin: "lower",
  servedOrders: "higher",
  unservedOrders: "lower",
  vehiclesUsed: "neutral",
};
