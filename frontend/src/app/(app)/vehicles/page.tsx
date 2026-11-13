"use client";

import { Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { VehicleForm } from "@/components/forms";
import { Badge, Button, Card, DataTable, ErrorState, ListCard, Modal, PageHeader, StackedBar, StatusBadge, TableSkeleton, Tabs, statusSegments, useToast, type Column } from "@/components/ds";
import { fmtNum, FUEL_UNIT, humanize } from "@/lib/format";
import type { Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const STATUSES = ["AVAILABLE", "ON_TRIP", "MAINTENANCE", "INACTIVE"] as const;

export default function VehiclesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi<Vehicle[]>("/vehicles");
  const toast = useToast();
  const all = data ?? [];
  const rows = status === "all" ? all : all.filter((v) => v.status === status);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((v) => v.status === s).length]));
  const activeCapacity = all.filter((v) => v.status !== "INACTIVE").reduce((a, v) => a + v.capacityKg, 0);
  const noDepot = all.filter((v) => !v.depotLocationId && v.status !== "INACTIVE").length;

  const columns: Array<Column<Vehicle>> = [
    {
      key: "reg",
      header: "Registration",
      sortValue: (v) => v.registrationNumber,
      cell: (v) => (
        <span className="whitespace-nowrap">
          <Link href={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">{v.registrationNumber}</Link>
          <span className="block text-xs text-muted">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</span>
        </span>
      ),
    },
    { key: "type", header: "Type", sortValue: (v) => v.type, cell: (v) => humanize(v.type), hideBelow: "sm" },
    { key: "cap", header: "Capacity", align: "right", sortValue: (v) => v.capacityKg, cell: (v) => fmtNum(v.capacityKg, "kg") },
    { key: "fuel", header: "Fuel", sortValue: (v) => v.fuelType, cell: (v) => humanize(v.fuelType), hideBelow: "md" },
    { key: "mileage", header: "Mileage", align: "right", sortValue: (v) => v.mileageKmPerUnit, cell: (v) => `${v.mileageKmPerUnit} km/${FUEL_UNIT[v.fuelType]}`, hideBelow: "lg" },
    { key: "odo", header: "Odometer", align: "right", sortValue: (v) => v.odometerKm, cell: (v) => fmtNum(v.odometerKm, "km"), hideBelow: "lg" },
    { key: "depot", header: "Depot", sortValue: (v) => v.depotLocation?.name, cell: (v) => v.depotLocation?.name ?? <Badge color="amber">Not set</Badge>, hideBelow: "md" },
    { key: "status", header: "Status", sortValue: (v) => STATUSES.indexOf(v.status), cell: (v) => <StatusBadge status={v.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicles"
        subtitle="Fleet capacity, efficiency and operating status. Vehicles on a trip are managed by dispatch."
        actions={
          can("fleet:write") && (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Add vehicle
            </Button>
          )
        }
      />
      {data && all.length > 0 && (
        <Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            <StackedBar label="Vehicles by status" segments={statusSegments(counts, [...STATUSES])} />
            <div>
              <p className="text-xs text-muted">Capacity (excl. inactive)</p>
              <p className="tabular text-lg font-semibold text-ink">{fmtNum(activeCapacity, "kg")}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Without a home depot</p>
              <p className={`tabular text-lg font-semibold ${noDepot ? "text-warning-700" : "text-ink"}`}>{noDepot}</p>
              {noDepot > 0 && <p className="text-xs text-muted">Can’t be planned by OptiRoute</p>}
            </div>
          </div>
        </Card>
      )}
      <Tabs label="Filter vehicles by status" value={status} onChange={setStatus} tabs={[{ id: "all", label: "All", count: all.length }, ...STATUSES.map((s) => ({ id: s, label: humanize(s), count: counts[s] }))]} />
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(v) => v.id}
          searchText={(v) => `${v.registrationNumber} ${v.make ?? ""} ${v.model ?? ""} ${v.type} ${v.depotLocation?.name ?? ""}`}
          searchPlaceholder="Search registration, make, depot…"
          initialSort={{ key: "reg", dir: "asc" }}
          caption="Vehicles"
          mobileCard={(v) => (
            <ListCard
              title={<Link href={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">{v.registrationNumber}</Link>}
              status={<StatusBadge status={v.status} />}
              subtitle={`${humanize(v.type)}${[v.make, v.model].some(Boolean) ? ` · ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}`}
              details={[
                ["Capacity", fmtNum(v.capacityKg, "kg")],
                ["Fuel", `${humanize(v.fuelType)} · ${v.mileageKmPerUnit} km/${FUEL_UNIT[v.fuelType]}`],
                ["Depot", v.depotLocation?.name ?? <span key="d" className="font-medium text-warning-700">Not set</span>],
                ["Odometer", fmtNum(v.odometerKm, "km")],
              ]}
            />
          )}
          empty={{
            title: all.length ? "No vehicles with this status" : "No vehicles yet",
            icon: Truck,
            description: all.length ? undefined : "Add your first vehicle to start planning routes.",
            action: !all.length && can("fleet:write") ? <Button icon={Plus} onClick={() => setCreating(true)}>Add vehicle</Button> : undefined,
          }}
        />
      )}
      <Modal open={creating} title="Add vehicle" onClose={() => setCreating(false)} wide>
        {creating && (
          <VehicleForm
            onSaved={() => {
              setCreating(false);
              toast.success("Vehicle added");
              reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
