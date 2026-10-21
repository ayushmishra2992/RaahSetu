"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, ErrorState, Loading, PageHeader, Table, Td } from "@/components/ui";
import { fmtMinutes, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { Run } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { RunMap } from "../RunView";

function Compare() {
  const p = useSearchParams();
  const a = useApi<Run>(`/optiroute/runs/${p.get("a")}`);
  const b = useApi<Run>(`/optiroute/runs/${p.get("b")}`);
  if (a.loading || b.loading) return <Loading />;
  if (a.error || b.error || !a.data || !b.data) return <ErrorState message={a.error ?? b.error ?? "Not found"} />;
  const rows: Array<[string, (r: Run) => number, (v: number) => string]> = [
    ["Objective J", (r) => r.result.objective.total, (v) => fmtNum(v)],
    ["Served orders", (r) => r.result.totals.servedOrders, (v) => String(v)],
    ["Unserved orders", (r) => r.result.unserved.length, (v) => String(v)],
    ["Vehicles used", (r) => r.result.totals.vehiclesUsed, (v) => String(v)],
    ["Distance (km)", (r) => r.result.totals.distanceKm, (v) => fmtNum(v)],
    ["Route time", (r) => r.result.totals.durationMin, (v) => fmtMinutes(v)],
    ["Est. operating cost", (r) => r.result.totals.operatingCost, (v) => fmtMoney(v)],
    ["Est. CO₂ (kg)", (r) => r.result.totals.co2Kg, (v) => fmtNum(v)],
    ["Lateness (min)", (r) => r.result.totals.latenessMin, (v) => fmtNum(v)],
    ["Runtime (ms)", (r) => r.result.runtimeMs, (v) => String(v)],
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Compare plans" subtitle="Only compare runs over the same orders and vehicles for a fair comparison." />
      <Table head={["Metric", `#${a.data.id} ${humanize(a.data.algorithm)}`, `#${b.data.id} ${humanize(b.data.algorithm)}`, "Δ (B − A)"]}>
        {rows.map(([label, get, fmt]) => {
          const va = get(a.data!);
          const vb = get(b.data!);
          const d = vb - va;
          return (
            <tr key={label}>
              <Td className="font-medium">{label}</Td>
              <Td className="tabular">{fmt(va)}</Td>
              <Td className="tabular">{fmt(vb)}</Td>
              <Td className={`tabular ${d < 0 ? "text-emerald-700" : d > 0 ? "text-red-700" : ""}`}>{d > 0 ? "+" : ""}{fmtNum(d)}</Td>
            </tr>
          );
        })}
      </Table>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Run #${a.data.id}`}><RunMap result={a.data.result} /></Card>
        <Card title={`Run #${b.data.id}`}><RunMap result={b.data.result} /></Card>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Compare />
    </Suspense>
  );
}
