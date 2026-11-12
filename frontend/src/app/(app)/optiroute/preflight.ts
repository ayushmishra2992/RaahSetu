/**
 * Pre-flight checks shown before an OptiRoute run. They only restate facts
 * visible in the selected orders and vehicles; the solver remains the
 * authority on feasibility.
 */
import type { Order, Vehicle } from "@/lib/types";

export interface Check {
  level: "error" | "warning" | "info" | "ok";
  message: string;
}

export function preflight({ orders, vehicles, hardTimeWindows, planStart, now = Date.now() }: { orders: Order[]; vehicles: Vehicle[]; hardTimeWindows: boolean; planStart: string | null; now?: number }): Check[] {
  const checks: Check[] = [];
  if (orders.length === 0) checks.push({ level: "error", message: "Select at least one order." });
  if (vehicles.length === 0) checks.push({ level: "error", message: "Select at least one vehicle." });
  if (!orders.length || !vehicles.length) return checks;

  const noDepot = vehicles.filter((v) => !v.depotLocationId);
  if (noDepot.length) checks.push({ level: "warning", message: `${noDepot.length} vehicle(s) have no home depot and will be excluded: ${noDepot.map((v) => v.registrationNumber).join(", ")}.` });

  const planned = vehicles.filter((v) => v.depotLocationId);
  const largest = Math.max(0, ...planned.map((v) => v.capacityKg));
  const tooHeavy = orders.filter((o) => o.weightKg > largest);
  if (tooHeavy.length) checks.push({ level: "warning", message: `${tooHeavy.length} order(s) are heavier than the largest eligible vehicle (${largest} kg) and will be unserved.` });

  const load = orders.reduce((a, o) => a + o.weightKg, 0);
  const capacity = planned.reduce((a, v) => a + v.capacityKg, 0);
  if (load > capacity) checks.push({ level: "warning", message: "Selected load exceeds combined capacity. Capacity frees up after drops, but some orders may be unserved." });

  const start = planStart ? new Date(planStart).getTime() : now + 15 * 60_000;
  const closed = orders.filter((o) => o.windowEnd && new Date(o.windowEnd).getTime() < start);
  if (closed.length && hardTimeWindows) checks.push({ level: "warning", message: `${closed.length} order(s) have a delivery window ending before plan start and cannot be served with hard windows.` });
  else if (closed.length) checks.push({ level: "info", message: `${closed.length} order(s) will be late: their window ends before plan start.` });

  const urgent = orders.filter((o) => o.priority === "URGENT").length;
  if (urgent) checks.push({ level: "info", message: `${urgent} urgent order(s) carry 4× the unserved penalty.` });

  if (!checks.some((c) => c.level === "warning" || c.level === "error")) checks.push({ level: "ok", message: "No issues found in the selection." });
  return checks;
}
