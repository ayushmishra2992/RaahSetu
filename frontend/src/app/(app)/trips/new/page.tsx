"use client";

import { Package, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateTimeInput, FormShell } from "@/components/forms";
import { Alert, Card, ErrorState, Field, Loading, Meter, PageHeader, SearchInput, Select, StatusBadge, Textarea, cx } from "@/components/ds";
import { api } from "@/lib/api";
import { daysUntil, fmtDate, fmtDateTime, fmtNum, humanize } from "@/lib/format";
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
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<{ vehicle?: string; driver?: string; orders?: string }>({});

  if (vehicles.loading || drivers.loading || orders.loading) return <Loading variant="page" label="Loading dispatch data…" />;
  const failed = vehicles.error ?? drivers.error ?? orders.error;
  if (failed)
    return (
      <ErrorState
        message={failed}
        onRetry={() => {
          vehicles.reload();
          drivers.reload();
          orders.reload();
        }}
      />
    );

  const vehicle = vehicles.data?.find((v) => v.id === Number(vehicleId));
  const driver = drivers.data?.find((d) => d.id === Number(driverId));
  const pending = orders.data ?? [];
  const load = pending.filter((o) => selected.includes(o.id)).reduce((a, o) => a + o.weightKg, 0);
  const visible = pending.filter((o) => !query || `${o.orderNumber} ${o.customerName} ${o.pickupLocation?.name} ${o.dropLocation?.name}`.toLowerCase().includes(query.toLowerCase()));
  const licenceDays = driver ? daysUntil(driver.licenseExpiry) : null;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Create trip manually" subtitle="Choose a vehicle, a driver and pending orders. OptiRoute sequences the stops and the server rejects the trip, with reasons, if any hard constraint would be broken." />
      <Card>
        <FormShell
          submitLabel="Create trip"
          onSubmit={async () => {
            const e = { vehicle: vehicleId ? undefined : "Choose a vehicle.", driver: driverId ? undefined : "Choose a driver.", orders: selected.length ? undefined : "Select at least one order." };
            setErrors(e);
            const n = Object.values(e).filter(Boolean).length;
            if (n) throw new Error(`Fix ${n} highlighted item${n === 1 ? "" : "s"} and try again.`);
            const trip = await api<{ id: number }>("/trips", { body: { vehicleId: Number(vehicleId), driverId: Number(driverId), orderIds: selected, plannedStart: plannedStart ?? undefined, notes: notes || null } });
            router.push(`/trips/${trip.id}`);
          }}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Vehicle" required hint={vehicle ? `${humanize(vehicle.type)} · ${fmtNum(vehicle.capacityKg, "kg")} · depot ${vehicle.depotLocation?.name ?? "not set"}` : "Only available vehicles are listed"} error={errors.vehicle}>
              <Select value={vehicleId} onChange={(e) => {
                  setVehicleId(e.target.value);
                  setErrors((x) => ({ ...x, vehicle: undefined }));
                }}>
                <option value="">Select…</option>
                {vehicles.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber} · {fmtNum(v.capacityKg, "kg")}
                    {v.depotLocationId ? "" : " · no depot"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Driver" required hint={driver ? `Licence valid until ${fmtDate(driver.licenseExpiry)} · shift limit ${driver.maxShiftHours} h` : "Only available drivers are listed"} error={errors.driver}>
              <Select value={driverId} onChange={(e) => {
                  setDriverId(e.target.value);
                  setErrors((x) => ({ ...x, driver: undefined }));
                }}>
                <option value="">Select…</option>
                {drivers.data?.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Earliest departure" hint="Defaults to about 15 minutes from now">
              <DateTimeInput value={plannedStart} onChange={setPlannedStart} />
            </Field>
            <Field label="Notes">
              <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </Field>
          </div>

          {vehicle && !vehicle.depotLocationId && <Alert kind="warning">{vehicle.registrationNumber} has no home depot. Set one on the vehicle before creating a trip with it.</Alert>}
          {licenceDays != null && licenceDays < 0 && <Alert kind="warning">{driver!.name}’s licence has expired; the server will refuse this trip.</Alert>}
          {(vehicles.data?.length === 0 || drivers.data?.length === 0) && (
            <Alert kind="info">
              {vehicles.data?.length === 0 ? "No vehicle is available. " : ""}
              {drivers.data?.length === 0 ? "No driver is available. " : ""}Vehicles and drivers on a trip, off duty or inactive can’t be assigned.
            </Alert>
          )}

          <fieldset className="min-w-0" aria-describedby={errors.orders ? "orders-error" : undefined}>
            <legend className="mb-2 flex w-full flex-wrap items-baseline justify-between gap-2 text-sm font-medium text-ink">
              <span className="flex items-center gap-1.5">
                <Package size={15} aria-hidden className="text-navy-400" /> Pending orders ({selected.length} selected)
              </span>
            </legend>
            {vehicle && (
              <div className="mb-3">
                <Meter label={`Selected load vs ${vehicle.registrationNumber} capacity`} value={load} max={vehicle.capacityKg} format={(v) => fmtNum(v, "kg")} />
                {load > vehicle.capacityKg && <p className="mt-1 text-xs text-warning-700">Total load exceeds capacity. The trip is only feasible if drops free up space before later pickups.</p>}
              </div>
            )}
            {errors.orders && <p id="orders-error" className="mb-2 text-xs font-medium text-danger-600">{errors.orders}</p>}
            {pending.length === 0 ? (
              <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-muted">
                No pending orders. <Link className="font-medium text-brand-700 hover:underline" href="/orders?new=1">Create an order</Link>.
              </p>
            ) : (
              <>
                <div className="mb-2">
                  <SearchInput value={query} onChange={setQuery} placeholder="Search pending orders…" label="Search pending orders" />
                </div>
                <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
                  {visible.map((o) => {
                    const on = selected.includes(o.id);
                    return (
                      <li key={o.id}>
                        <label className={cx("flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-surface-muted", on && "bg-brand-50/50")}>
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 accent-brand-600"
                            checked={on}
                            onChange={(e) => {
                              setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)));
                              setErrors((x) => ({ ...x, orders: undefined }));
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-ink">{o.orderNumber}</span>
                              <StatusBadge status={o.priority} />
                              <span className="tabular ml-auto text-xs text-muted">{fmtNum(o.weightKg, "kg")}</span>
                            </span>
                            <span className="block truncate text-xs text-muted">
                              {o.pickupLocation?.name} → {o.dropLocation?.name} · {o.customerName}
                              {o.windowEnd && ` · by ${fmtDateTime(o.windowEnd)}`}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {visible.length === 0 && <li className="p-3 text-sm text-muted">No orders match “{query}”.</li>}
                </ul>
              </>
            )}
          </fieldset>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Truck size={14} aria-hidden /> The trip is created in Planned state; dispatch it from the trip page.
          </p>
        </FormShell>
      </Card>
    </div>
  );
}
