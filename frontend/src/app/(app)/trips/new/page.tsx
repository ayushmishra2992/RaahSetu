"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTimeInput, FormShell } from "@/components/forms";
import { api } from "@/lib/api";
import { Card, Field, Loading, PageHeader, Select, Textarea } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import type { Driver, Order, Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function NewTripPage() {
  const router = useRouter();
  const vehicles = useApi<Vehicle[]>("/vehicles?status=AVAILABLE");
  const drivers = useApi<Driver[]>("/drivers?status=AVAILABLE");
  const orders = useApi<Order[]>("/orders?status=PENDING");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [plannedStart, setPlannedStart] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  if (vehicles.loading || drivers.loading || orders.loading) return <Loading />;
  const vehicle = vehicles.data?.find((v) => v.id === Number(vehicleId));
  const load = (orders.data ?? []).filter((o) => selected.includes(o.id)).reduce((a, o) => a + o.weightKg, 0);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Create trip manually" subtitle="Choose a vehicle, driver and pending orders. OptiRoute sequences the stops and rejects the trip if any hard constraint would be broken." />
      <Card>
        <FormShell submitLabel="Create trip" onSubmit={async () => {
          const trip = await api<{ id: number }>("/trips", { body: { vehicleId: Number(vehicleId), driverId: Number(driverId), orderIds: selected, plannedStart: plannedStart ?? undefined, notes: notes || null } });
          router.push(`/trips/${trip.id}`);
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vehicle (available)"><Select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">Select…</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.registrationNumber} · {fmtNum(v.capacityKg, "kg")}</option>)}</Select></Field>
            <Field label="Driver (available)"><Select required value={driverId} onChange={(e) => setDriverId(e.target.value)}><option value="">Select…</option>{drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Earliest departure" hint="Defaults to ~15 minutes from now"><DateTimeInput value={plannedStart} onChange={setPlannedStart} /></Field>
            <Field label="Notes"><Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Pending orders <span className="text-muted">— selected load {fmtNum(load, "kg")}{vehicle ? ` of ${fmtNum(vehicle.capacityKg, "kg")}` : ""}</span></p>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-line p-2">
              {(orders.data ?? []).length === 0 && <p className="p-2 text-sm text-muted">No pending orders.</p>}
              {orders.data?.map((o) => (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-canvas">
                  <input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} />
                  <span className="font-medium">{o.orderNumber}</span>
                  <span className="text-muted">{o.pickupLocation?.name} → {o.dropLocation?.name} · {fmtNum(o.weightKg, "kg")} · {o.priority}</span>
                </label>
              ))}
            </div>
          </div>
        </FormShell>
      </Card>
    </div>
  );
}
