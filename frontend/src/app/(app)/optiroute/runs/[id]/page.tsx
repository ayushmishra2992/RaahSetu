"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, ErrorState, Loading, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Run } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { RunDetails } from "../../RunView";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: run, error, loading, reload } = useApi<Run>(`/optiroute/runs/${id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  if (loading) return <Loading />;
  if (error || !run) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const hasVirtual = Object.values(run.result.orders).some((o) => o.virtual);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Run #${run.id} ${run.name ?? ""}`}
        subtitle={`Created ${fmtDateTime(run.createdAt)} · plan start ${fmtDateTime(run.result.planStart)}`}
        actions={<>
          {can("optimize:run") && <Link href={`/scenarios?baseRunId=${run.id}`} className="rounded-md border border-line bg-white px-3.5 py-2 text-sm font-medium hover:bg-canvas">What-if scenario</Link>}
          {can("trips:write") && !run.dispatchedAt && (
            <Button loading={busy} disabled={!run.feasible || run.result.routes.length === 0 || hasVirtual} onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const r = await api<{ trips: unknown[] }>(`/optiroute/runs/${run.id}/dispatch`, { method: "POST" });
                setMsg({ kind: "success", text: `${r.trips.length} trip(s) created in PLANNED state. Dispatch each one from Trips.` });
                reload();
              } catch (e) {
                setMsg({ kind: "error", text: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}>Create trips from plan</Button>
          )}
        </>}
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {hasVirtual && !run.dispatchedAt && <Alert kind="info">This plan contains a simulated urgent order. Approve the scenario first; the order is then created and the plan becomes dispatchable.</Alert>}
      {run.trips.length > 0 && (
        <Alert kind="success">Trips: {run.trips.map((t, i) => <span key={t.id}>{i ? ", " : ""}<Link className="underline" href={`/trips/${t.id}`}>{t.tripNumber}</Link> ({t.status.toLowerCase()})</span>)}</Alert>
      )}
      <RunDetails result={run.result} />
    </div>
  );
}
