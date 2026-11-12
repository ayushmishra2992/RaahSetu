"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { Alert, Badge, Button, Card, ConfirmButton, ErrorState, Field, Input, Loading, PageHeader, Select, Stat, SyntheticNote, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtMinutes, fmtMoney, fmtNum, FUEL_UNIT, todayIso } from "@/lib/format";
import type { Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface EstimateRow {
  vehicleId: number;
  registrationNumber: string;
  fuelType: string;
  capacityKg: number;
  canCarry: boolean;
  durationMin: number;
  fuelUnits: number;
  fuelUnit: string;
  fuelCost: number;
  driverCost: number;
  operatingCost: number;
  co2Kg: number;
  co2PerTonneKm: number | null;
}

interface Summary {
  periodDays: number;
  rows: Array<{ vehicleId: number; registrationNumber: string; fuelType: string; fuelUnit: string; completedTrips: number; estimated: { distanceKm: number; fuelUnits: number; co2Kg: number; operatingCost: number }; logged: { fills: number; quantity: number; cost: number; co2KgFromFuel: number }; configuredMileage: number; observedMileage: number | null }>;
  totals: Record<string, number>;
  notes: string[];
}

interface FuelRecord {
  id: number;
  filledAt: string;
  quantity: number;
  totalCost: number;
  odometerKm: number;
  vehicle: { id: number; registrationNumber: string; fuelType: string };
}

export default function GreenFleetPage() {
  const { can, me } = useAuth();
  const [days, setDays] = useState("30");
  const summary = useApi<Summary>(`/greenfleet/summary?days=${days}`);
  const fuel = useApi<FuelRecord[]>("/fuel-records");
  const vehicles = useApi<Vehicle[]>("/vehicles");
  const [est, setEst] = useState({ distanceKm: "120", loadKg: "1000" });
  const [rows, setRows] = useState<EstimateRow[] | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [fuelForm, setFuelForm] = useState({ vehicleId: "", filledAt: todayIso(), quantity: "", totalCost: "", odometerKm: "" });
  const s = me.company.settings;

  return (
    <div className="space-y-5">
      <PageHeader title="GreenFleet" subtitle="Transparent fuel, cost and CO₂ estimates — and how they compare with the fuel you actually logged." />
      <SyntheticNote>
        Estimates use configurable factors (Settings): diesel {s.emissionKgPerUnit.DIESEL} kg CO₂/L, petrol {s.emissionKgPerUnit.PETROL} kg/L, CNG {s.emissionKgPerUnit.CNG} kg/kg, grid electricity {s.emissionKgPerUnit.ELECTRIC} kg/kWh; fuel use rises up to {Math.round(s.loadPenaltyAtFullLoad * 100)}% at full load. They are not measurements, and no ML model is used.
      </SyntheticNote>

      <Card title="Which vehicle is greenest for a job?">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Distance (km)"><Input type="number" min={1} value={est.distanceKm} onChange={(e) => setEst((x) => ({ ...x, distanceKm: e.target.value }))} /></Field>
          <Field label="Load (kg)"><Input type="number" min={0} value={est.loadKg} onChange={(e) => setEst((x) => ({ ...x, loadKg: e.target.value }))} /></Field>
          <Button onClick={async () => {
            setEstErr(null);
            try { setRows((await api<{ rows: EstimateRow[] }>("/greenfleet/estimate", { body: { distanceKm: Number(est.distanceKm), loadKg: Number(est.loadKg) } })).rows); } catch (e) { setEstErr(errorMessage(e)); }
          }}>Estimate</Button>
        </div>
        {estErr && <div className="mt-3"><Alert>{estErr}</Alert></div>}
        {rows && (
          <div className="mt-4">
            <Table head={["Vehicle", "Fuel", "Can carry", "Time", "Fuel/energy", "Fuel cost", "Driver cost", "Total est. cost", "Est. CO₂", "g CO₂/t·km"]} empty={rows.length === 0}>
              {rows.map((r, i) => (
                <tr key={r.vehicleId} className={!r.canCarry ? "opacity-50" : ""}>
                  <Td className="font-medium">{r.registrationNumber} {i === 0 && r.canCarry && <Badge color="green">Lowest CO₂</Badge>}</Td>
                  <Td>{r.fuelType}</Td>
                  <Td>{r.canCarry ? "Yes" : `No (${r.capacityKg} kg max)`}</Td>
                  <Td>{fmtMinutes(r.durationMin)}</Td>
                  <Td className="tabular">{fmtNum(r.fuelUnits, r.fuelUnit)}</Td>
                  <Td className="tabular">{fmtMoney(r.fuelCost)}</Td>
                  <Td className="tabular">{fmtMoney(r.driverCost)}</Td>
                  <Td className="tabular">{fmtMoney(r.operatingCost)}</Td>
                  <Td className="tabular">{fmtNum(r.co2Kg, "kg")}</Td>
                  <Td className="tabular">{r.co2PerTonneKm == null ? "—" : fmtNum(r.co2PerTonneKm * 1000)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      <Card title="Estimated vs logged" actions={<Select value={days} onChange={(e) => setDays(e.target.value)} className="w-36"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select>}>
        {summary.loading ? <Loading /> : summary.error || !summary.data ? <ErrorState message={summary.error ?? "Unavailable"} /> : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Est. CO₂ (trips)" value={`${fmtNum(summary.data.totals.estCo2Kg)} kg`} hint="From planned distance" />
              <Stat label="CO₂ from logged fuel" value={`${fmtNum(summary.data.totals.loggedCo2Kg)} kg`} hint="Logged quantity × factor" />
              <Stat label="Est. operating cost" value={fmtMoney(summary.data.totals.estCost)} />
              <Stat label="Logged fuel spend" value={fmtMoney(summary.data.totals.loggedFuelCost)} />
            </div>
            <Table head={["Vehicle", "Trips", "Est. km", "Est. fuel", "Est. CO₂", "Logged fills", "Logged qty", "Logged cost", "Configured mileage", "Observed mileage"]}>
              {summary.data.rows.map((r) => (
                <tr key={r.vehicleId}>
                  <Td className="font-medium">{r.registrationNumber}</Td>
                  <Td>{r.completedTrips}</Td>
                  <Td className="tabular">{fmtNum(r.estimated.distanceKm)}</Td>
                  <Td className="tabular">{fmtNum(r.estimated.fuelUnits, r.fuelUnit)}</Td>
                  <Td className="tabular">{fmtNum(r.estimated.co2Kg, "kg")}</Td>
                  <Td>{r.logged.fills}</Td>
                  <Td className="tabular">{fmtNum(r.logged.quantity, r.fuelUnit)}</Td>
                  <Td className="tabular">{fmtMoney(r.logged.cost)}</Td>
                  <Td className="tabular">{r.configuredMileage} km/{r.fuelUnit}</Td>
                  <Td className="tabular">{r.observedMileage == null ? <span className="text-muted">needs 2+ fills</span> : `${r.observedMileage} km/${r.fuelUnit}`}</Td>
                </tr>
              ))}
            </Table>
            <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted">{summary.data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
        {can("fuel:write") && (
          <Card title="Log a fuel / charge fill">
            <FormShell submitLabel="Save fill" onSubmit={async () => {
              await api("/fuel-records", { body: { vehicleId: Number(fuelForm.vehicleId), filledAt: new Date(`${fuelForm.filledAt}T12:00:00`).toISOString(), quantity: Number(fuelForm.quantity), totalCost: Number(fuelForm.totalCost), odometerKm: Number(fuelForm.odometerKm) } });
              setFuelForm((f) => ({ ...f, quantity: "", totalCost: "", odometerKm: "" }));
              fuel.reload();
              summary.reload();
            }}>
              <Field label="Vehicle"><Select required value={fuelForm.vehicleId} onChange={(e) => setFuelForm((f) => ({ ...f, vehicleId: e.target.value }))}><option value="">Select…</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.registrationNumber} ({FUEL_UNIT[v.fuelType]})</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date"><Input type="date" required value={fuelForm.filledAt} onChange={(e) => setFuelForm((f) => ({ ...f, filledAt: e.target.value }))} /></Field>
                <Field label="Quantity"><Input type="number" step="any" min={0.01} required value={fuelForm.quantity} onChange={(e) => setFuelForm((f) => ({ ...f, quantity: e.target.value }))} /></Field>
                <Field label="Total cost (₹)"><Input type="number" step="any" min={0} required value={fuelForm.totalCost} onChange={(e) => setFuelForm((f) => ({ ...f, totalCost: e.target.value }))} /></Field>
                <Field label="Odometer (km)"><Input type="number" min={0} required value={fuelForm.odometerKm} onChange={(e) => setFuelForm((f) => ({ ...f, odometerKm: e.target.value }))} /></Field>
              </div>
            </FormShell>
          </Card>
        )}
        <Card title="Fuel log">
          {fuel.loading ? <Loading /> : (
            <div className="max-h-96 overflow-y-auto">
              <Table head={["Date", "Vehicle", "Qty", "Cost", "Odometer", ""]} empty={fuel.data?.length === 0}>
                {fuel.data?.map((r) => (
                  <tr key={r.id}>
                    <Td>{fmtDate(r.filledAt)}</Td>
                    <Td>{r.vehicle.registrationNumber}</Td>
                    <Td className="tabular">{fmtNum(r.quantity, FUEL_UNIT[r.vehicle.fuelType])}</Td>
                    <Td className="tabular">{fmtMoney(r.totalCost)}</Td>
                    <Td className="tabular">{fmtNum(r.odometerKm, "km")}</Td>
                    <Td>{can("fuel:write") && <ConfirmButton confirmLabel="Delete" onConfirm={async () => { await api(`/fuel-records/${r.id}`, { method: "DELETE" }); fuel.reload(); summary.reload(); }}>Delete</ConfirmButton>}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
