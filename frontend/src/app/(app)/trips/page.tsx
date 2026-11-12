"use client";

import { Navigation, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DataTable, ErrorState, LinkButton, PageHeader, StatusBadge, TableSkeleton, Tabs, type Column } from "@/components/ds";
import { fmtDateTime, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const STATUSES = ["PLANNED", "DISPATCHED", "IN_TRANSIT", "COMPLETED", "CANCELLED"] as const;

export default function TripsPage() {
  const { can, me } = useAuth();
  const isDriver = me.user.role === "DRIVER";
  const [status, setStatus] = useState("active");
  const { data, error, loading, reload } = useApi<Trip[]>("/trips");
  const all = data ?? [];
  const active = (t: Trip) => t.status === "PLANNED" || t.status === "DISPATCHED" || t.status === "IN_TRANSIT";
  const rows = status === "all" ? all : status === "active" ? all.filter(active) : all.filter((t) => t.status === status);

  const columns: Array<Column<Trip>> = [
    {
      key: "trip",
      header: "Trip",
      sortValue: (t) => t.tripNumber,
      cell: (t) => (
        <span className="whitespace-nowrap">
          <Link href={`/trips/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.tripNumber}</Link>
          {t.optimizationRunId && <span className="block text-xs text-muted">OptiRoute #{t.optimizationRunId}</span>}
        </span>
      ),
    },
    { key: "vehicle", header: "Vehicle", sortValue: (t) => t.vehicle.registrationNumber, cell: (t) => <span className="whitespace-nowrap">{t.vehicle.registrationNumber}</span> },
    { key: "driver", header: "Driver", sortValue: (t) => t.driver.name, cell: (t) => t.driver.name, hideBelow: "md" },
    { key: "start", header: "Planned start", sortValue: (t) => t.plannedStart, cell: (t) => <span className="whitespace-nowrap text-xs">{fmtDateTime(t.plannedStart)}</span>, hideBelow: "sm" },
    { key: "stops", header: "Stops", align: "right", sortValue: (t) => t._count?.stops, cell: (t) => t._count?.stops ?? "—", hideBelow: "lg" },
    { key: "km", header: "Distance", align: "right", sortValue: (t) => t.plannedDistanceKm, cell: (t) => fmtNum(t.plannedDistanceKm, "km"), hideBelow: "lg" },
    { key: "cost", header: "Est. cost", align: "right", sortValue: (t) => t.estCost, cell: (t) => fmtMoney(t.estCost), hideBelow: "lg" },
    { key: "status", header: "Status", sortValue: (t) => STATUSES.indexOf(t.status), cell: (t) => <StatusBadge status={t.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title={isDriver ? "My trips" : "Trips & dispatch"}
        subtitle={isDriver ? "Trips assigned to you. Open a trip to record arrivals, pickups and deliveries." : "Planned → dispatched → in transit → completed. Every transition is recorded with who made it and when."}
        actions={
          can("trips:write") && (
            <LinkButton href="/trips/new" icon={Plus}>
              Create trip manually
            </LinkButton>
          )
        }
      />
      <div className="mb-3">
        <Tabs
          label="Filter trips by status"
          value={status}
          onChange={setStatus}
          tabs={[
            { id: "active", label: "Active", count: all.filter(active).length },
            ...STATUSES.map((s) => ({ id: s, label: humanize(s), count: all.filter((t) => t.status === s).length })),
            { id: "all", label: "All", count: all.length },
          ]}
        />
      </div>
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          searchText={(t) => `${t.tripNumber} ${t.vehicle.registrationNumber} ${t.driver.name}`}
          searchPlaceholder="Search trip, vehicle or driver…"
          initialSort={{ key: "start", dir: "desc" }}
          caption="Trips"
          empty={{
            title: all.length ? "No trips with this status" : isDriver ? "No trips assigned to you" : "No trips yet",
            icon: Navigation,
            description: all.length ? "Choose another status above." : isDriver ? "Trips appear here once a dispatcher assigns them to you." : "Create trips from an OptiRoute plan or manually.",
          }}
        />
      )}
      {data && data.length >= 200 && <p className="mt-2 text-xs text-muted">Showing the 200 most recent trips (API limit).</p>}
    </div>
  );
}
