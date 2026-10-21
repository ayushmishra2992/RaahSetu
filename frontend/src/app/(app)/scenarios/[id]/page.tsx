"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, ErrorState, Field, Input, Loading, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtNum, humanize } from "@/lib/format";
import type { Run, Scenario } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { RunMap } from "../../optiroute/RunView";

type ScenarioDetail = Scenario & { baseRun: Run; resultRun: Run | null };

const LABELS: Record<string, string> = {
  objective: "Objective J",
  distanceKm: "Distance (km)",
  durationMin: "Route time (min)",
  operatingCost: "Est. cost (₹)",
  co2Kg: "Est. CO₂ (kg)",
  latenessMin: "Lateness (min)",
  servedOrders: "Served orders",
  unservedOrders: "Unserved orders",
  vehiclesUsed: "Vehicles used",
};

export default function ScenarioPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: s, error, loading, reload } = useApi<ScenarioDetail>(`/scenarios/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  if (loading) return <Loading />;
  if (error || !s) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const c = s.comparison;

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setMsg(null);
    try {
      await api(`/scenarios/${s!.id}/${action}`, { body: { note: note || null } });
      setMsg({ kind: "success", text: action === "approve" ? "Approved. Changes applied; open the scenario plan to create trips." : "Rejected. No data was changed." });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={s.name} subtitle={`${humanize(s.type)} · evaluated ${fmtDateTime(s.createdAt)}`} actions={<StatusBadge status={s.status} />} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {c && (
        <Card title="Before vs after" actions={<span className="text-xs text-muted">{c.summary}</span>}>
          <Table head={["Metric", `Base (#${s.baseRunId})`, `Scenario (#${s.resultRunId})`, "Δ"]}>
            {Object.keys(LABELS).map((k) => (
              <tr key={k}>
                <Td className="font-medium">{LABELS[k]}</Td>
                <Td className="tabular">{fmtNum(c.base[k])}</Td>
                <Td className="tabular">{fmtNum(c.scenario[k])}</Td>
                <Td className={`tabular ${c.delta[k] > 0 ? "text-red-700" : c.delta[k] < 0 ? "text-emerald-700" : ""}`}>{c.delta[k] > 0 ? "+" : ""}{fmtNum(c.delta[k])}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 grid gap-4 md:grid-cols-2 text-sm">
            <div>
              <p className="font-medium">Reassigned orders ({c.reassignedOrders.length})</p>
              <ul className="mt-1 space-y-0.5 text-muted">{c.reassignedOrders.map((r) => <li key={r.orderId}>{r.label}: {r.from ?? "unserved"} → {r.to ?? "unserved"}</li>)}</ul>
            </div>
            <div>
              <p className="font-medium">Newly unserved ({c.newlyUnserved.length})</p>
              <ul className="mt-1 space-y-0.5 text-muted">{c.newlyUnserved.map((u) => <li key={u.orderId}>{u.label}: {u.reason}</li>)}</ul>
            </div>
          </div>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Base plan #${s.baseRunId}`} actions={<Link className="text-sm text-brand-700" href={`/optiroute/runs/${s.baseRunId}`}>Open →</Link>}><RunMap result={s.baseRun.result} /></Card>
        {s.resultRun && <Card title={`Scenario plan #${s.resultRun.id}`} actions={<Link className="text-sm text-brand-700" href={`/optiroute/runs/${s.resultRun.id}`}>Open →</Link>}><RunMap result={s.resultRun.result} /></Card>}
      </div>
      {s.status === "EVALUATED" && can("scenarios:approve") && (
        <Card title="Dispatcher decision">
          <p className="mb-3 text-sm text-muted">Approving applies the disruption (vehicle → maintenance, driver → off duty, road closed, or urgent order created) and cancels base-plan trips that have not started, so the new plan can be dispatched.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1"><Field label="Decision note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
            <Button loading={busy === "approve"} onClick={() => decide("approve")}>Approve & apply</Button>
            <Button variant="secondary" loading={busy === "reject"} onClick={() => decide("reject")}>Reject</Button>
          </div>
        </Card>
      )}
      {s.status !== "EVALUATED" && <Alert kind="info">Decision: {humanize(s.status)} {s.decidedAt && `on ${fmtDateTime(s.decidedAt)}`}{s.decisionNote ? ` — ${s.decisionNote}` : ""}</Alert>}
    </div>
  );
}
