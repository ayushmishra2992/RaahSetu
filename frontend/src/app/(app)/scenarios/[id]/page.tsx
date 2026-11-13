"use client";

import { ArrowRightLeft, Check, CircleSlash, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, ErrorState, Field, Input, LinkButton, Loading, PageHeader, StatusBadge, Table, Td, useConfirm, useToast } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMinutes, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { Run, Scenario } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { SCENARIO_DIRECTION, verdict } from "../../optiroute/compare";
import { RunMap } from "../../optiroute/RunView";

type ScenarioDetail = Scenario & { baseRun: Run; resultRun: Run | null };

const METRICS: Array<{ key: string; label: string; fmt: (v: number) => string }> = [
  { key: "servedOrders", label: "Served orders", fmt: (v) => String(Math.round(v)) },
  { key: "unservedOrders", label: "Unserved orders", fmt: (v) => String(Math.round(v)) },
  { key: "objective", label: "Objective J", fmt: (v) => fmtNum(v) },
  { key: "distanceKm", label: "Distance", fmt: (v) => fmtNum(v, "km") },
  { key: "durationMin", label: "Route time", fmt: (v) => fmtMinutes(Math.abs(v)) },
  { key: "operatingCost", label: "Est. operating cost", fmt: (v) => fmtMoney(v) },
  { key: "co2Kg", label: "Est. CO₂", fmt: (v) => fmtNum(v, "kg") },
  { key: "latenessMin", label: "Lateness", fmt: (v) => fmtMinutes(Math.abs(v)) },
  { key: "vehiclesUsed", label: "Vehicles used", fmt: (v) => String(Math.round(v)) },
];

/** Human description of what the scenario changes, from its params. */
function describeDisruption(s: ScenarioDetail): string {
  const p = s.params as Record<string, unknown>;
  const vehicleLabel = (id: unknown) => s.baseRun.result.routes.find((r) => r.vehicleId === id)?.vehicleLabel ?? `vehicle #${id}`;
  const driverLabel = (id: unknown) => s.baseRun.result.routes.find((r) => r.driverId === id)?.driverName ?? `driver #${id}`;
  switch (s.type) {
    case "VEHICLE_BREAKDOWN":
      return `${vehicleLabel(p.vehicleId)} is unavailable (breakdown).`;
    case "DRIVER_UNAVAILABLE":
      return `${driverLabel(p.driverId)} can't work this plan.`;
    case "ROAD_CLOSURE":
      return `${Array.isArray(p.edgeIds) ? p.edgeIds.length : 0} road segment(s) closed.`;
    case "URGENT_ORDER":
      return `Urgent order for ${String(p.customerName ?? "a customer")}, ${String(p.weightKg ?? "?")} kg.`;
    default:
      return humanize(s.type);
  }
}

export default function ScenarioPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: s, error, loading, reload } = useApi<ScenarioDetail>(`/scenarios/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  if (loading && !s) return <Loading variant="page" label="Loading scenario…" />;
  if (error || !s) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const c = s.comparison;

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setMsg(null);
    try {
      await api(`/scenarios/${s!.id}/${action}`, { body: { note: note.trim() || null } });
      if (action === "approve") setMsg({ kind: "success", text: "Approved. The disruption was applied; open the scenario plan to create trips." });
      else toast.success("Scenario rejected", "No data was changed.");
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={s.name}
        subtitle={`${humanize(s.type)} · evaluated ${fmtDateTime(s.createdAt)}`}
        meta={<StatusBadge status={s.status} label={s.status === "EVALUATED" ? "Awaiting decision" : undefined} />}
        actions={
          s.resultRunId && (
            <LinkButton href={`/optiroute/compare?a=${s.baseRunId}&b=${s.resultRunId}`} variant="secondary" icon={ArrowRightLeft}>
              Full comparison
            </LinkButton>
          )
        }
      />
      <Alert kind="info" title="What changes">
        {describeDisruption(s)} Base plan #{s.baseRunId} was re-optimised with the same orders, vehicles, algorithm and seed.
      </Alert>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {c ? (
        <Card title="Before vs after" description={c.summary}>
          <Table head={["Metric", `Base #${s.baseRunId}`, `Scenario #${s.resultRunId ?? "—"}`, "Change"]} caption="Scenario impact">
            {METRICS.filter((m) => m.key in c.base || m.key in c.scenario).map((m) => {
              const d = c.delta[m.key] ?? (c.scenario[m.key] ?? 0) - (c.base[m.key] ?? 0);
              const v = verdict(d, SCENARIO_DIRECTION[m.key] ?? "neutral");
              return (
                <tr key={m.key}>
                  <Td className="font-medium text-ink">{m.label}</Td>
                  <Td className="tabular whitespace-nowrap">{c.base[m.key] == null ? "—" : m.fmt(c.base[m.key])}</Td>
                  <Td className="tabular whitespace-nowrap">{c.scenario[m.key] == null ? "—" : m.fmt(c.scenario[m.key])}</Td>
                  <Td className="whitespace-nowrap">
                    {v === "same" ? (
                      <span className="text-muted">No change</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="tabular">
                          {d > 0 ? "+" : "−"}
                          {m.fmt(Math.abs(d))}
                        </span>
                        {v === "better" && <Badge color="green">Better</Badge>}
                        {v === "worse" && <Badge color="red">Worse</Badge>}
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div>
              <p className="font-medium text-ink">Reassigned orders ({c.reassignedOrders.length})</p>
              {c.reassignedOrders.length === 0 ? (
                <p className="mt-1 text-muted">None.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-muted">
                  {c.reassignedOrders.map((r) => (
                    <li key={r.orderId}>
                      <span className="text-ink">{r.label}</span>: {r.from ?? "unserved"} → {r.to ?? "unserved"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="font-medium text-ink">Newly unserved ({c.newlyUnserved.length})</p>
              {c.newlyUnserved.length === 0 ? (
                <p className="mt-1 text-muted">None. Every order served before is still served.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-muted">
                  {c.newlyUnserved.map((u) => (
                    <li key={u.orderId}>
                      <span className="font-medium text-danger-700">{u.label}</span>: {u.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Alert kind="warning">No comparison is available for this scenario.</Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={`Base plan #${s.baseRunId}`} actions={<Link className="text-xs font-medium text-brand-700 hover:underline" href={`/optiroute/runs/${s.baseRunId}`}>Open run</Link>}>
          <RunMap result={s.baseRun.result} />
        </Card>
        {s.resultRun && (
          <Card title={`Scenario plan #${s.resultRun.id}`} actions={<Link className="text-xs font-medium text-brand-700 hover:underline" href={`/optiroute/runs/${s.resultRun.id}`}>Open run</Link>}>
            <RunMap result={s.resultRun.result} />
          </Card>
        )}
      </div>

      {s.status === "EVALUATED" && can("scenarios:approve") && (
        <Card title="Decision">
          <p className="mb-3 text-sm text-muted">
            Approving applies the disruption to live data (vehicle → maintenance, driver → off duty, roads closed, or the urgent order created) and cancels base-plan trips that haven’t started, so the scenario plan can be dispatched.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[min(100%,16rem)] flex-1">
              <Field label="Decision note" hint="Optional; stored with the decision">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </Field>
            </div>
            <Button
              icon={Check}
              loading={busy === "approve"}
              disabled={!!busy}
              onClick={async () => {
                const ok = await confirm({ title: `Approve “${s.name}”?`, description: "The disruption is applied to live data and base-plan trips that have not started are cancelled, so the scenario plan can be dispatched. This can't be undone.", confirmLabel: "Approve & apply", tone: "danger" });
                if (ok) await decide("approve");
              }}
            >
              Approve & apply
            </Button>
            <Button
              variant="secondary"
              icon={X}
              loading={busy === "reject"}
              disabled={!!busy}
              onClick={async () => {
                const ok = await confirm({ title: `Reject “${s.name}”?`, description: "The scenario is closed without changing any data.", confirmLabel: "Reject scenario", tone: "primary" });
                if (ok) await decide("reject");
              }}
            >
              Reject
            </Button>
          </div>
        </Card>
      )}
      {s.status === "EVALUATED" && !can("scenarios:approve") && <Alert kind="info">A manager or admin decides whether to apply this scenario.</Alert>}
      {s.status !== "EVALUATED" && (
        <Alert kind={s.status === "APPROVED" ? "success" : "info"} title={s.status === "APPROVED" ? "Approved and applied" : "Rejected"}>
          <span className="inline-flex items-center gap-1">
            {s.status === "REJECTED" && <CircleSlash size={14} aria-hidden />}
            {s.decidedAt ? `Decided ${fmtDateTime(s.decidedAt)}` : "Decision recorded"}
            {s.decisionNote ? ` — ${s.decisionNote}` : ""}
          </span>
        </Alert>
      )}
    </div>
  );
}
