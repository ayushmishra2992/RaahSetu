"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/api";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import type { Driver, Location, Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { Alert, Button, Field, Input, Select } from "./ui";

/** Generic submit wrapper: shows errors and busy state. */
export function FormShell({ onSubmit, children, submitLabel }: { onSubmit: () => Promise<void>; children: ReactNode; submitLabel: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function handle(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {children}
      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function VehicleForm({ vehicle, onSaved }: { vehicle?: Vehicle; onSaved: () => void }) {
  const locations = useApi<Location[]>("/locations");
  const [f, setF] = useState({
    registrationNumber: vehicle?.registrationNumber ?? "",
    type: vehicle?.type ?? "TRUCK",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year?.toString() ?? "",
    capacityKg: vehicle?.capacityKg?.toString() ?? "",
    fuelType: vehicle?.fuelType ?? "DIESEL",
    mileageKmPerUnit: vehicle?.mileageKmPerUnit?.toString() ?? "",
    avgSpeedKmph: vehicle?.avgSpeedKmph?.toString() ?? "40",
    status: vehicle?.status ?? "AVAILABLE",
    odometerKm: vehicle?.odometerKm?.toString() ?? "0",
    depotLocationId: vehicle?.depotLocationId?.toString() ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const unit = f.fuelType === "ELECTRIC" ? "km/kWh" : f.fuelType === "CNG" ? "km/kg" : "km/L";

  return (
    <FormShell
      submitLabel={vehicle ? "Save changes" : "Add vehicle"}
      onSubmit={async () => {
        const body: Record<string, unknown> = {
          registrationNumber: f.registrationNumber,
          type: f.type,
          make: f.make || null,
          model: f.model || null,
          year: f.year ? Number(f.year) : null,
          capacityKg: Number(f.capacityKg),
          fuelType: f.fuelType,
          mileageKmPerUnit: Number(f.mileageKmPerUnit),
          avgSpeedKmph: Number(f.avgSpeedKmph),
          odometerKm: Number(f.odometerKm || 0),
          depotLocationId: f.depotLocationId ? Number(f.depotLocationId) : null,
        };
        if (vehicle && f.status !== vehicle.status) body.status = f.status;
        await api(vehicle ? `/vehicles/${vehicle.id}` : "/vehicles", { method: vehicle ? "PATCH" : "POST", body });
        onSaved();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Registration number">
          <Input required value={f.registrationNumber} onChange={set("registrationNumber")} placeholder="MH04AB1234" />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={set("type")}>
            {["TRUCK", "MINI_TRUCK", "VAN", "PICKUP", "TRAILER", "TANKER"].map((t) => (
              <option key={t} value={t}>{t.replace("_", " ")}</option>
            ))}
          </Select>
        </Field>
        <Field label="Make"><Input value={f.make} onChange={set("make")} /></Field>
        <Field label="Model"><Input value={f.model} onChange={set("model")} /></Field>
        <Field label="Year"><Input type="number" min={1980} max={2100} value={f.year} onChange={set("year")} /></Field>
        <Field label="Capacity (kg)"><Input type="number" min={1} required value={f.capacityKg} onChange={set("capacityKg")} /></Field>
        <Field label="Fuel / energy">
          <Select value={f.fuelType} onChange={set("fuelType")}>
            {["DIESEL", "PETROL", "CNG", "ELECTRIC"].map((t) => (<option key={t}>{t}</option>))}
          </Select>
        </Field>
        <Field label={`Mileage (${unit}, empty)`}><Input type="number" step="0.1" min={0.1} required value={f.mileageKmPerUnit} onChange={set("mileageKmPerUnit")} /></Field>
        <Field label="Average speed (km/h)"><Input type="number" min={5} max={120} value={f.avgSpeedKmph} onChange={set("avgSpeedKmph")} /></Field>
        <Field label="Odometer (km)"><Input type="number" min={0} value={f.odometerKm} onChange={set("odometerKm")} /></Field>
        <Field label="Home depot" hint="Required for route planning">
          <Select value={f.depotLocationId} onChange={set("depotLocationId")}>
            <option value="">— none —</option>
            {(locations.data ?? []).map((l) => (<option key={l.id} value={l.id}>{l.name} ({l.type.toLowerCase()})</option>))}
          </Select>
        </Field>
        {vehicle && (
          <Field label="Status" hint="ON_TRIP is managed by dispatch">
            <Select value={f.status} onChange={set("status")} disabled={vehicle.status === "ON_TRIP"}>
              {["AVAILABLE", "MAINTENANCE", "INACTIVE", ...(vehicle.status === "ON_TRIP" ? ["ON_TRIP"] : [])].map((s) => (<option key={s}>{s}</option>))}
            </Select>
          </Field>
        )}
      </div>
    </FormShell>
  );
}

export function DriverForm({ driver, onSaved }: { driver?: Driver; onSaved: () => void }) {
  const [f, setF] = useState({
    name: driver?.name ?? "",
    phone: driver?.phone ?? "",
    licenseNumber: driver?.licenseNumber ?? "",
    licenseExpiry: driver?.licenseExpiry?.slice(0, 10) ?? "",
    maxShiftHours: driver?.maxShiftHours?.toString() ?? "10",
    status: driver?.status ?? "AVAILABLE",
    userId: driver?.userId?.toString() ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormShell
      submitLabel={driver ? "Save changes" : "Add driver"}
      onSubmit={async () => {
        const body: Record<string, unknown> = {
          name: f.name,
          phone: f.phone,
          licenseNumber: f.licenseNumber,
          licenseExpiry: new Date(`${f.licenseExpiry}T00:00:00`).toISOString(),
          maxShiftHours: Number(f.maxShiftHours),
          userId: f.userId ? Number(f.userId) : null,
        };
        if (driver && f.status !== driver.status) body.status = f.status;
        await api(driver ? `/drivers/${driver.id}` : "/drivers", { method: driver ? "PATCH" : "POST", body });
        onSaved();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name"><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label="Phone"><Input required value={f.phone} onChange={set("phone")} placeholder="+91 98xxxxxxxx" /></Field>
        <Field label="Licence number"><Input required value={f.licenseNumber} onChange={set("licenseNumber")} /></Field>
        <Field label="Licence expiry"><Input type="date" required value={f.licenseExpiry} onChange={set("licenseExpiry")} /></Field>
        <Field label="Max shift (hours)"><Input type="number" min={1} max={16} step="0.5" value={f.maxShiftHours} onChange={set("maxShiftHours")} /></Field>
        <Field label="Linked app user id (optional)" hint="A user with the DRIVER role, so they can update their own trips">
          <Input type="number" min={1} value={f.userId} onChange={set("userId")} />
        </Field>
        {driver && (
          <Field label="Status">
            <Select value={f.status} onChange={set("status")} disabled={driver.status === "ON_TRIP"}>
              {["AVAILABLE", "OFF_DUTY", "INACTIVE", ...(driver.status === "ON_TRIP" ? ["ON_TRIP"] : [])].map((s) => (<option key={s}>{s}</option>))}
            </Select>
          </Field>
        )}
      </div>
    </FormShell>
  );
}

export function DateTimeInput({ value, onChange, ...rest }: { value: string | null; onChange: (iso: string | null) => void; required?: boolean }) {
  return <Input type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} {...rest} />;
}
