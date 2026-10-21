"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { VehicleForm } from "@/components/forms";
import { Button, ErrorState, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { fmtNum, FUEL_UNIT, humanize } from "@/lib/format";
import type { Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function VehiclesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) }).toString();
  const { data, error, loading, reload } = useApi<Vehicle[]>(`/vehicles${qs ? `?${qs}` : ""}`);

  return (
    <div>
      <PageHeader title="Vehicles" subtitle="Your fleet, capacity and operating status." actions={can("fleet:write") && <Button onClick={() => setCreating(true)}>Add vehicle</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Search registration…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[180px]">
          <option value="">All statuses</option>
          {["AVAILABLE", "ON_TRIP", "MAINTENANCE", "INACTIVE"].map((s) => (<option key={s} value={s}>{humanize(s)}</option>))}
        </Select>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <Table head={["Registration", "Type", "Capacity", "Fuel", "Mileage", "Depot", "Status"]} empty={data?.length === 0}>
          {data?.map((v) => (
            <tr key={v.id} className="hover:bg-canvas">
              <Td><Link href={`/vehicles/${v.id}`} className="font-medium text-brand-700">{v.registrationNumber}</Link><div className="text-xs text-muted">{[v.make, v.model, v.year].filter(Boolean).join(" ")}</div></Td>
              <Td>{humanize(v.type)}</Td>
              <Td className="tabular">{fmtNum(v.capacityKg, "kg")}</Td>
              <Td>{humanize(v.fuelType)}</Td>
              <Td className="tabular">{v.mileageKmPerUnit} km/{FUEL_UNIT[v.fuelType]}</Td>
              <Td>{v.depotLocation?.name ?? <span className="text-amber-700">Not set</span>}</Td>
              <Td><StatusBadge status={v.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={creating} title="Add vehicle" onClose={() => setCreating(false)} wide>
        <VehicleForm onSaved={() => { setCreating(false); reload(); }} />
      </Modal>
    </div>
  );
}
