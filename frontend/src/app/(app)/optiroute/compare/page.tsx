"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert, Badge, Card, EmptyState, ErrorState, Field, Loading, PageHeader, Select, Table, Td } from "@/components/ds";
import { fmtDateTime, fmtMinutes, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { Run, RunSummary } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { compareRuns, sameOrders } from "../compare";
import { RunMap } from "../RunView";

function RunPicker({ label, value, runs, onChange }: { label: string; value: string; runs: RunSummary[]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select a run…</option>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            #{r.id} {r.name ?? humanize(r.algorithm)} · {fmtDateTime(r.createdAt)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const FORMAT: Record<string, (v: number) => string> = {
  money: (v) => fmtMoney(v),
  minutes: (v) => fmtMinutes(Math.abs(v)),
  int: (v) => String(Math.round(v)),
  num: (v) => fmtNum(v),
  ms: (v) => `${Math.round(v)} ms`,
};

function Compare() {
  const p = useSearchParams();
  const router = useRouter();
  const ida = p.get("a") ?? "";
  const idb = p.get("b") ?? "";
  const runs = useApi<RunSummary[]>("/optiroute/runs");
  const a = useApi<Run>(ida ? `/optiroute/runs/${ida}` : null);
  const b = useApi<Run>(idb ? `/optiroute/runs/${idb}` : null);
  const pick = (key: "a" | "b") => (v: string) => {
    const q = new URLSearchParams(p.toString());
    if (v) q.set(key, v);
    else q.delete(key);
    router.replace(`/optiroute/compare?${q.toString()}`);
  };

  const ready = a.data && b.data;
  const rows = ready ? compareRuns(a.data!.result, b.data!.result) : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Compare plans" subtitle="Side-by-side results of two OptiRoute runs. Lower is better for every cost-type metric; more served orders is better." />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RunPicker label="Run A (baseline)" value={ida} runs={runs.data ?? []} onChange={pick("a")} />
          <RunPicker label="Run B" value={idb} runs={runs.data ?? []} onChange={pick("b")} />
        </div>
      </Card>

      {(a.loading || b.loading) && <Loading label="Loading runs…" />}
      {(a.error || b.error) && <ErrorState message={(a.error ?? b.error)!} onRetry={() => (a.error ? a.reload() : b.reload())} />}
      {!ida || !idb ? (
        <EmptyState title="Choose two runs to compare">Pick a baseline and a second run above. Fair comparisons use the same orders and vehicles.</EmptyState>
      ) : (
        ready && (
          <>
            {!sameOrders(a.data!.result, b.data!.result) && (
              <Alert kind="warning" title="Not a like-for-like comparison">
                These runs planned different sets of orders, so differences reflect the inputs as well as the algorithm.
              </Alert>
            )}
            <Table head={["Metric", `A · #${a.data!.id} ${humanize(a.data!.algorithm)}`, `B · #${b.data!.id} ${humanize(b.data!.algorithm)}`, "B vs A"]} caption="Run comparison">
              {rows.map((r) => {
                const fmt = FORMAT[r.format];
                return (
                  <tr key={r.key}>
                    <Td className="font-medium text-ink">{r.label}</Td>
                    <Td className="tabular whitespace-nowrap">{fmt(r.a)}</Td>
                    <Td className="tabular whitespace-nowrap">{fmt(r.b)}</Td>
                    <Td className="whitespace-nowrap">
                      {r.verdict === "same" ? (
                        <span className="text-muted">No change</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="tabular">
                            {r.delta > 0 ? "+" : "−"}
                            {fmt(Math.abs(r.delta))}
                          </span>
                          {r.verdict === "better" && <Badge color="green">Better</Badge>}
                          {r.verdict === "worse" && <Badge color="red">Worse</Badge>}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card title={`A · run #${a.data!.id}`}>
                <RunMap result={a.data!.result} />
              </Card>
              <Card title={`B · run #${b.data!.id}`}>
                <RunMap result={b.data!.result} />
              </Card>
            </div>
          </>
        )
      )}
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
