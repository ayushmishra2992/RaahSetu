"use client";

import { IdCard, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DriverForm } from "@/components/forms";
import { Button, Card, DataTable, ErrorState, Modal, PageHeader, StackedBar, StatusBadge, TableSkeleton, Tabs, statusSegments, useToast, type Column } from "@/components/ds";
import { daysUntil, expiryStateOf, fmtDate, fmtRelDays, humanize } from "@/lib/format";
import type { Driver } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const STATUSES = ["AVAILABLE", "ON_TRIP", "OFF_DUTY", "INACTIVE"] as const;

export default function DriversPage() {
  const { can, me } = useAuth();
  const alertDays = me.company.settings.documentExpiryAlertDays;
  const { data, error, loading, reload } = useApi<Driver[]>("/drivers");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("all");
  const toast = useToast();
  const all = data ?? [];
  const rows = status === "all" ? all : all.filter((d) => d.status === status);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((d) => d.status === s).length]));
  const licence = (d: Driver) => expiryStateOf(d.licenseExpiry, alertDays);
  const expired = all.filter((d) => d.status !== "INACTIVE" && licence(d) === "EXPIRED").length;
  const expiring = all.filter((d) => d.status !== "INACTIVE" && licence(d) === "EXPIRING_SOON").length;

  const columns: Array<Column<Driver>> = [
    { key: "name", header: "Name", sortValue: (d) => d.name, cell: (d) => <Link href={`/drivers/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.name}</Link> },
    { key: "phone", header: "Phone", cell: (d) => <span className="whitespace-nowrap">{d.phone}</span>, hideBelow: "md" },
    { key: "licence", header: "Licence", cell: (d) => <span className="whitespace-nowrap text-xs">{d.licenseNumber}</span>, hideBelow: "lg" },
    {
      key: "expiry",
      header: "Licence expiry",
      sortValue: (d) => d.licenseExpiry,
      cell: (d) => {
        const st = licence(d);
        return (
          <span className="whitespace-nowrap text-xs">
            {fmtDate(d.licenseExpiry)}
            {st !== "VALID" && <span className={`block font-medium ${st === "EXPIRED" ? "text-danger-700" : "text-warning-700"}`}>{fmtRelDays(daysUntil(d.licenseExpiry))}</span>}
          </span>
        );
      },
      hideBelow: "sm",
    },
    { key: "shift", header: "Shift limit", align: "right", sortValue: (d) => d.maxShiftHours, cell: (d) => `${d.maxShiftHours} h`, hideBelow: "lg" },
    { key: "login", header: "App login", cell: (d) => (d.user ? <span className="text-xs">{d.user.email}</span> : <span className="text-muted">—</span>), hideBelow: "lg" },
    { key: "status", header: "Status", sortValue: (d) => STATUSES.indexOf(d.status), cell: (d) => <StatusBadge status={d.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drivers"
        subtitle="Licences, availability and shift limits. OptiRoute only pairs available drivers whose licence is valid at plan start."
        actions={
          can("fleet:write") && (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Add driver
            </Button>
          )
        }
      />
      {data && all.length > 0 && (
        <Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            <StackedBar label="Drivers by status" segments={statusSegments(counts, [...STATUSES])} />
            <div>
              <p className="text-xs text-muted">Licence expired</p>
              <p className={`tabular text-lg font-semibold ${expired ? "text-danger-700" : "text-ink"}`}>{expired}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Licence due within {alertDays} days</p>
              <p className={`tabular text-lg font-semibold ${expiring ? "text-warning-700" : "text-ink"}`}>{expiring}</p>
            </div>
          </div>
        </Card>
      )}
      <Tabs label="Filter drivers by status" value={status} onChange={setStatus} tabs={[{ id: "all", label: "All", count: all.length }, ...STATUSES.map((s) => ({ id: s, label: humanize(s), count: counts[s] }))]} />
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(d) => d.id}
          searchText={(d) => `${d.name} ${d.phone} ${d.licenseNumber} ${d.user?.email ?? ""}`}
          searchPlaceholder="Search name, phone, licence…"
          initialSort={{ key: "name", dir: "asc" }}
          caption="Drivers"
          empty={{ title: all.length ? "No drivers with this status" : "No drivers yet", icon: IdCard, description: all.length ? undefined : "Add drivers so OptiRoute can pair them with vehicles." }}
        />
      )}
      <Modal open={creating} title="Add driver" onClose={() => setCreating(false)} wide>
        {creating && (
          <DriverForm
            onSaved={() => {
              setCreating(false);
              toast.success("Driver added");
              reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
