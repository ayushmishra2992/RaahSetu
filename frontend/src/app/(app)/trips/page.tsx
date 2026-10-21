"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ErrorState, LinkButton, Loading, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function TripsPage() {
  const { can, me } = useAuth();
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useApi<Trip[]>(`/trips${status ? `?status=${status}` : ""}`);
  return (
    <div>
      <PageHeader
        title={me.user.role === "DRIVER" ? "My trips" : "Trips & dispatch"}
        subtitle="Planned → dispatched → in transit → completed, with every transition recorded."
        actions={can("trips:write") && <LinkButton href="/trips/new">Create trip manually</LinkButton>}
      />
      <div className="mb-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[200px]">
          <option value="">All statuses</option>
          {["PLANNED", "DISPATCHED", "IN_TRANSIT", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
      </div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <Table head={["Trip", "Vehicle", "Driver", "Planned start", "Stops", "Distance", "Est. cost", "Status"]} empty={data?.length === 0}>
          {data?.map((t) => (
            <tr key={t.id} className="hover:bg-canvas">
              <Td><Link href={`/trips/${t.id}`} className="font-medium text-brand-700">{t.tripNumber}</Link>{t.optimizationRunId && <div className="text-xs text-muted">OptiRoute #{t.optimizationRunId}</div>}</Td>
              <Td>{t.vehicle.registrationNumber}</Td>
              <Td>{t.driver.name}</Td>
              <Td>{fmtDateTime(t.plannedStart)}</Td>
              <Td>{t._count?.stops ?? "—"}</Td>
              <Td className="tabular">{fmtNum(t.plannedDistanceKm, "km")}</Td>
              <Td className="tabular">{fmtMoney(t.estCost)}</Td>
              <Td><StatusBadge status={t.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
