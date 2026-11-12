"use client";

import { FlaskConical, GitCompareArrows, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Badge, Button, ErrorState, LinkButton, Loading, PageHeader, useConfirm, useToast } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { Run } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { RunDetails } from "../../RunView";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: run, error, loading, reload } = useApi<Run>(`/optiroute/runs/${id}`);
  const [busy, setBusy] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  if (loading) return <Loading variant="page" label="Loading run…" />;
  if (error || !run) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const hasVirtual = Object.values(run.result.orders).some((o) => o.virtual);
  const blocked = !run.feasible ? "The plan breaks a hard constraint, so trips can't be created from it." : run.result.routes.length === 0 ? "The plan has no routes." : hasVirtual ? "The plan contains a simulated urgent order; approve its scenario first." : null;

  async function createTrips() {
    const ok = await confirm({
      title: `Create trips from run #${run!.id}?`,
      description: `${run!.result.routes.length} trip(s) will be created in Planned state and the plan’s orders assigned to them. The server re-checks that orders, vehicles and drivers are still available; dispatch each trip separately from Trips.`,
      confirmLabel: "Create trips",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    setDispatchError(null);
    try {
      const r = await api<{ trips: unknown[] }>(`/optiroute/runs/${run!.id}/dispatch`, { method: "POST" });
      toast.success("Trips created", `${r.trips.length} trip(s) are now planned. Dispatch each one from Trips.`);
      reload();
    } catch (e) {
      // 409: already dispatched, infeasible, or stale (orders/vehicles changed since the run).
      setDispatchError(errorMessage(e));
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Run #${run.id}${run.name ? ` · ${run.name}` : ""}`}
        subtitle={`Created ${fmtDateTime(run.createdAt)} · plan start ${fmtDateTime(run.result.planStart)}`}
        meta={
          <>
            {run.feasible ? <Badge color="green" dot>Feasible</Badge> : <Badge color="red" dot>Infeasible</Badge>}
            <Badge>{humanize(run.algorithm)}</Badge>
            {run.dispatchedAt && <Badge color="blue">Trips created {fmtDateTime(run.dispatchedAt)}</Badge>}
          </>
        }
        actions={
          <>
            <LinkButton href={`/optiroute/compare?a=${run.id}`} variant="secondary" icon={GitCompareArrows}>
              Compare
            </LinkButton>
            {can("optimize:run") && (
              <LinkButton href={`/scenarios?baseRunId=${run.id}`} variant="secondary" icon={FlaskConical}>
                What-if scenario
              </LinkButton>
            )}
            {can("trips:write") && !run.dispatchedAt && (
              <Button icon={Truck} loading={busy} disabled={!!blocked} title={blocked ?? undefined} onClick={createTrips}>
                Create trips from plan
              </Button>
            )}
          </>
        }
      />
      {dispatchError && <Alert title="Trips were not created">{dispatchError}</Alert>}
      {can("trips:write") && !run.dispatchedAt && blocked && <Alert kind={hasVirtual ? "info" : "warning"}>{blocked}</Alert>}
      {run.trips.length > 0 && (
        <Alert kind="success" title="Trips from this plan">
          {run.trips.map((t, i) => (
            <span key={t.id}>
              {i ? ", " : ""}
              <Link href={`/trips/${t.id}`}>{t.tripNumber}</Link> ({humanize(t.status).toLowerCase()})
            </span>
          ))}
        </Alert>
      )}
      <RunDetails result={run.result} />
    </div>
  );
}
