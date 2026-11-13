"use client";

import { ScrollText } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Alert, DataTable, ErrorState, ListCard, PageHeader, Select, TableSkeleton, type Column } from "@/components/ds";
import { describeAction, entityHref, entityLabel, metadataPairs } from "@/lib/audit";
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

const TYPES = ["Company", "User", "Vehicle", "Driver", "ComplianceDocument", "Location", "RoadNode", "RoadEdge", "Order", "BillingDocument", "FuelRecord"];

function RecordLink({ e }: { e: AuditEvent }) {
  const href = entityHref(e.entityType, e.entityId);
  const text = `${entityLabel(e.entityType)}${e.entityId ? ` #${e.entityId}` : ""}`;
  return href ? <Link className="whitespace-nowrap text-brand-700 hover:underline" href={href}>{text}</Link> : <span className="whitespace-nowrap">{text}</span>;
}

function Details({ e }: { e: AuditEvent }) {
  const pairs = metadataPairs(e.metadata);
  if (!pairs.length) return <span className="text-muted">—</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
      {pairs.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AuditPage() {
  const [type, setType] = useState("");
  const [who, setWho] = useState("");
  const [limit, setLimit] = useState("200");
  const { data, error, loading, reload } = useApi<AuditEvent[]>(`/audit?limit=${limit}${type ? `&entityType=${type}` : ""}`);
  const all = data ?? [];
  const people = [...new Set(all.map((e) => e.userName ?? "System"))].sort();
  const rows = who ? all.filter((e) => (e.userName ?? "System") === who) : all;

  const columns: Array<Column<AuditEvent>> = [
    { key: "when", header: "When", sortValue: (e) => e.createdAt, cell: (e) => <span className="whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</span> },
    { key: "who", header: "Who", sortValue: (e) => e.userName ?? "", cell: (e) => e.userName ?? <span className="text-muted">System</span> },
    { key: "what", header: "What", sortValue: (e) => e.action, cell: (e) => <span className="font-medium text-ink" title={e.action}>{describeAction(e.action)}</span> },
    { key: "record", header: "Record", sortValue: (e) => e.entityType, cell: (e) => <RecordLink e={e} />, hideBelow: "md" },
    { key: "details", header: "Details", cell: (e) => <Details e={e} />, hideBelow: "lg", className: "max-w-sm" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" subtitle="Significant changes in your company: who did what, and when. Passwords and secrets are never recorded." />
      <Alert kind="info">
        Trip status changes, OptiRoute runs and scenario decisions are not yet written to this log; see each trip’s status history, and the run and scenario pages, for those.
      </Alert>
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(e) => e.id}
          searchText={(e) => `${describeAction(e.action)} ${e.action} ${e.userName ?? "System"} ${entityLabel(e.entityType)} ${e.entityId ?? ""} ${metadataPairs(e.metadata).map((p) => p.join(" ")).join(" ")}`}
          searchPlaceholder="Search actions, people, records…"
          initialSort={{ key: "when", dir: "desc" }}
          pageSize={50}
          caption="Audit events"
          toolbar={
            <>
              <Select aria-label="Filter by record type" value={type} onChange={(e) => setType(e.target.value)} className="sm:w-52">
                <option value="">All record types</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{entityLabel(t)}</option>
                ))}
              </Select>
              <Select aria-label="Filter by person" value={who} onChange={(e) => setWho(e.target.value)} className="sm:w-44">
                <option value="">Everyone</option>
                {people.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
              <Select aria-label="Number of events to load" value={limit} onChange={(e) => setLimit(e.target.value)} className="sm:w-40">
                <option value="100">Latest 100</option>
                <option value="200">Latest 200</option>
                <option value="500">Latest 500</option>
              </Select>
            </>
          }
          mobileCard={(e) => (
            <ListCard
              title={describeAction(e.action)}
              subtitle={`${e.userName ?? "System"} · ${fmtDateTime(e.createdAt)}`}
              details={[["Record", <RecordLink key="r" e={e} />, true], ...(metadataPairs(e.metadata).length ? [["Details", <Details key="d" e={e} />, true] as [string, ReactNode, boolean]] : [])]}
            />
          )}
          empty={{ title: type ? "No events for this record type" : "No audit events yet", icon: ScrollText }}
        />
      )}
      {data && data.length >= Number(limit) && <p className="text-xs text-muted">Showing the latest {limit} events (server limit per request). Narrow by record type to see older ones.</p>}
    </div>
  );
}
