"use client";

import { useState } from "react";
import { ErrorState, Loading, PageHeader, Select, Table, Td } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/useApi";

interface AuditEvent {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
  userName: string | null;
  createdAt: string;
}

const TYPES = ["", "Company", "User", "Vehicle", "Driver", "ComplianceDocument", "Location", "RoadEdge", "Order", "Trip", "OptimizationRun", "Scenario", "BillingDocument", "FuelRecord"];

export default function AuditPage() {
  const [type, setType] = useState("");
  const { data, error, loading, reload } = useApi<AuditEvent[]>(`/audit?limit=200${type ? `&entityType=${type}` : ""}`);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Significant actions in your company. Secrets and passwords are never recorded." />
      <div className="mb-3"><Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-xs">{TYPES.map((t) => <option key={t} value={t}>{t || "All entities"}</option>)}</Select></div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <Table head={["When", "Who", "Action", "Entity", "Details"]} empty={data?.length === 0}>
          {data?.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</Td>
              <Td>{e.userName ?? "system"}</Td>
              <Td className="font-mono text-xs">{e.action}</Td>
              <Td className="text-xs">{e.entityType}{e.entityId ? ` #${e.entityId}` : ""}</Td>
              <Td className="max-w-md truncate font-mono text-xs text-muted">{e.metadata ? JSON.stringify(e.metadata) : ""}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
