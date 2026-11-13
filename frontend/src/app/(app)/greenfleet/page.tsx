"use client";

import { Calculator, Fuel, Leaf, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmButton,
  DataTable,
  ErrorState,
  Field,
  Input,
  ListCard,
  Loading,
  PageHeader,
  PairedBars,
  Select,
  Stat,
  SyntheticNote,
  TableSkeleton,
  Tabs,
  useToast,
  type Column,
} from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtMinutes, fmtMoney, fmtNum, FUEL_UNIT, humanize, todayIso } from "@/lib/format";
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

interface SummaryRow {
  vehicleId: number;
  registrationNumber: string;
  fuelType: string;
  fuelUnit: string;
  completedTrips: number;
  estimated: { distanceKm: number; fuelUnits: number; co2Kg: number; operatingCost: number };
  logged: { fills: number; quantity: number; cost: number; co2KgFromFuel: number };
  configuredMileage: number;
  observedMileage: number | null;
}
interface Summary {
  periodDays: number;
  rows: SummaryRow[];
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
  return (
    <Suspense fallback={<Loading />}>
      <GreenFleetInner />
    </Suspense>
  );
}

function GreenFleetInner() {
  const { can, me } = useAuth();
  // ?tab=fuel deep-links to the fuel log (Control Tower quick action, vehicle pages).
  const [tab, setTab] = useState(useSearchParams().get("tab") === "fuel" ? "fuel" : "overview");
  const [days, setDays] = useState("30");
  const summary = useApi<Summary>(`/greenfleet/summary?days=${days}`);
  const fuel = useApi<FuelRecord[]>("/fuel-records");
  const vehicles = useApi<Vehicle[]>("/vehicles");
  const s = me.company.settings;

  return (
    <div className="space-y-5">
      <PageHeader title="GreenFleet" subtitle="Fuel, cost and CO₂ estimates from your own factors, compared with the fuel you actually logged." />
      <SyntheticNote>
        <strong>Estimates</strong> use the factors in Settings: diesel {s.emissionKgPerUnit.DIESEL} kg CO₂/L, petrol {s.emissionKgPerUnit.PETROL} kg/L, CNG {s.emissionKgPerUnit.CNG} kg/kg, grid electricity {s.emissionKgPerUnit.ELECTRIC} kg/kWh, with fuel use rising up to {Math.round(s.loadPenaltyAtFullLoad * 100)}% at full load. <strong>Logged</strong> figures come from fuel records you entered. Neither is a certified emissions measurement, and no ML model is used.
      </SyntheticNote>
      <Tabs
        label="GreenFleet sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Estimated vs logged" },
          { id: "estimate", label: "Compare vehicles for a job" },
          { id: "fuel", label: "Fuel log", count: fuel.data?.length },
        ]}
      />
      {tab === "overview" && <Overview summary={summary} days={days} setDays={setDays} />}
      {tab === "estimate" && <Estimator />}
      {tab === "fuel" && <FuelLog fuel={fuel} vehicles={vehicles.data ?? []} canWrite={can("fuel:write")} onChanged={summary.reload} />}
    </div>
  );
}

function Overview({ summary, days, setDays }: { summary: ReturnType<typeof useApi<Summary>>; days: string; setDays: (d: string) => void }) {
  const columns: Array<Column<SummaryRow>> = [
    { key: "veh", header: "Vehicle", sortValue: (r) => r.registrationNumber, cell: (r) => <Link className="whitespace-nowrap font-medium text-brand-700 hover:underline" href={`/vehicles/${r.vehicleId}`}>{r.registrationNumber}</Link> },
    { key: "trips", header: "Trips", align: "right", sortValue: (r) => r.completedTrips, cell: (r) => r.completedTrips },
    { key: "km", header: "Est. km", align: "right", sortValue: (r) => r.estimated.distanceKm, cell: (r) => fmtNum(r.estimated.distanceKm), hideBelow: "lg" },
    { key: "efuel", header: "Est. fuel", align: "right", sortValue: (r) => r.estimated.fuelUnits, cell: (r) => fmtNum(r.estimated.fuelUnits, r.fuelUnit) },
    { key: "lfuel", header: "Logged fuel", align: "right", sortValue: (r) => r.logged.quantity, cell: (r) => (r.logged.fills ? fmtNum(r.logged.quantity, r.fuelUnit) : <span className="text-muted">No fills</span>) },
    { key: "eco2", header: "Est. CO₂", align: "right", sortValue: (r) => r.estimated.co2Kg, cell: (r) => fmtNum(r.estimated.co2Kg, "kg"), hideBelow: "md" },
    { key: "lcost", header: "Logged spend", align: "right", sortValue: (r) => r.logged.cost, cell: (r) => fmtMoney(r.logged.cost), hideBelow: "lg" },
    {
      key: "mileage",
      header: "Mileage: configured / observed",
      cell: (r) => (
        <span className="whitespace-nowrap text-xs">
          {r.configuredMileage} km/{r.fuelUnit} / {r.observedMileage == null ? <span className="text-muted">observed needs 2+ fills</span> : `${r.observedMileage} km/${r.fuelUnit}`}
        </span>
      ),
      hideBelow: "md",
    },
  ];
  return (
    <Card
      title="Estimated vs logged"
      icon={Leaf}
      actions={
        <Select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-36 text-[13px]">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      }
    >
      {summary.loading ? (
        <TableSkeleton rows={3} />
      ) : summary.error || !summary.data ? (
        <ErrorState message={summary.error ?? "Unavailable"} onRetry={summary.reload} />
      ) : (
        <div className="space-y-5">
          <section aria-label="Totals for the period" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="CO₂, estimated" value={fmtNum(summary.data.totals.estCo2Kg, "kg")} hint="Completed trips × factors" />
            <Stat label="CO₂ from logged fuel" value={fmtNum(summary.data.totals.loggedCo2Kg, "kg")} hint="Logged quantity × factor" />
            <Stat label="Operating cost, estimated" value={fmtMoney(summary.data.totals.estCost)} hint="Fuel + driver time" />
            <Stat label="Fuel spend, logged" value={fmtMoney(summary.data.totals.loggedFuelCost)} hint="Sum of fuel records" />
          </section>
          {summary.data.rows.length === 0 ? (
            <p className="text-sm text-muted">No vehicles yet.</p>
          ) : (
            <>
              <div>
                <h3 className="mb-2 text-sm font-medium text-ink">CO₂ per vehicle, last {summary.data.periodDays} days</h3>
                <PairedBars
                  label={`Estimated vs logged CO₂ per vehicle, last ${summary.data.periodDays} days`}
                  series={["Estimated from trips", "From logged fuel"]}
                  rows={summary.data.rows.map((r) => ({ key: String(r.vehicleId), label: r.registrationNumber, a: r.estimated.co2Kg, b: r.logged.fills ? r.logged.co2KgFromFuel : null }))}
                  format={(v) => `${fmtNum(v)} kg`}
                />
              </div>
              <DataTable
                rows={summary.data.rows}
                columns={columns}
                rowKey={(r) => r.vehicleId}
                caption="Estimated vs logged by vehicle"
                mobileCard={(r) => (
                  <ListCard
                    title={<Link className="font-medium text-brand-700 hover:underline" href={`/vehicles/${r.vehicleId}`}>{r.registrationNumber}</Link>}
                    status={<Badge>{humanize(r.fuelType)}</Badge>}
                    subtitle={`${r.completedTrips} completed trip(s)`}
                    details={[
                      ["Est. fuel", fmtNum(r.estimated.fuelUnits, r.fuelUnit)],
                      ["Logged fuel", r.logged.fills ? fmtNum(r.logged.quantity, r.fuelUnit) : "No fills"],
                      ["Est. CO₂", fmtNum(r.estimated.co2Kg, "kg")],
                      ["Logged spend", fmtMoney(r.logged.cost)],
                      ["Mileage (configured / observed)", `${r.configuredMileage} km/${r.fuelUnit} / ${r.observedMileage == null ? "needs 2+ fills" : `${r.observedMileage} km/${r.fuelUnit}`}`, true],
                    ]}
                  />
                )}
              />
            </>
          )}
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
            {summary.data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Estimator() {
  const [est, setEst] = useState({ distanceKm: "120", loadKg: "1000" });
  const [rows, setRows] = useState<EstimateRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstCarrier = rows?.find((r) => r.canCarry);
  return (
    <Card title="Which vehicle is greenest for a job?" icon={Calculator} description="Estimates every vehicle for one trip; vehicles that can't carry the load are listed but not ranked">
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          const km = Number(est.distanceKm);
          const kg = Number(est.loadKg || 0);
          if (!(km > 0)) return setErr("Distance must be more than 0 km.");
          if (!(kg >= 0)) return setErr("Load can't be negative.");
          setBusy(true);
          try {
            setRows((await api<{ rows: EstimateRow[] }>("/greenfleet/estimate", { body: { distanceKm: km, loadKg: kg } })).rows);
          } catch (e2) {
            setErr(errorMessage(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Distance (km)">
          <Input type="number" min={1} step="any" value={est.distanceKm} onChange={(e) => setEst((x) => ({ ...x, distanceKm: e.target.value }))} />
        </Field>
        <Field label="Load (kg)">
          <Input type="number" min={0} value={est.loadKg} onChange={(e) => setEst((x) => ({ ...x, loadKg: e.target.value }))} />
        </Field>
        <Button type="submit" loading={busy}>
          Estimate
        </Button>
      </form>
      {err && (
        <div className="mt-3">
          <Alert>{err}</Alert>
        </div>
      )}
      {rows && (
        <div className="mt-4">
          <DataTable
            rows={rows}
            rowKey={(r) => r.vehicleId}
            caption="Estimated fuel, cost and CO₂ per vehicle"
            columns={[
              { key: "veh", header: "Vehicle", cell: (r) => <span className="whitespace-nowrap font-medium text-ink">{r.registrationNumber} {r === firstCarrier && <Badge color="green">Lowest CO₂</Badge>}</span> },
              { key: "carry", header: "Can carry", cell: (r) => (r.canCarry ? "Yes" : <span className="text-muted">No ({fmtNum(r.capacityKg, "kg")} max)</span>) },
              { key: "time", header: "Time", cell: (r) => fmtMinutes(r.durationMin), hideBelow: "lg" },
              { key: "fuel", header: "Fuel/energy", align: "right", cell: (r) => fmtNum(r.fuelUnits, r.fuelUnit) },
              { key: "cost", header: "Est. cost", align: "right", cell: (r) => fmtMoney(r.operatingCost) },
              { key: "co2", header: "Est. CO₂", align: "right", cell: (r) => fmtNum(r.co2Kg, "kg") },
              { key: "int", header: "g CO₂/t·km", align: "right", cell: (r) => (r.co2PerTonneKm == null ? "—" : fmtNum(r.co2PerTonneKm * 1000)), hideBelow: "md" },
            ]}
            mobileCard={(r) => (
              <ListCard
                title={r.registrationNumber}
                status={r === firstCarrier ? <Badge color="green">Lowest CO₂</Badge> : !r.canCarry ? <Badge>Can’t carry</Badge> : undefined}
                details={[
                  ["Est. CO₂", fmtNum(r.co2Kg, "kg")],
                  ["Est. cost", fmtMoney(r.operatingCost)],
                  ["Fuel/energy", fmtNum(r.fuelUnits, r.fuelUnit)],
                  ["Time", fmtMinutes(r.durationMin)],
                ]}
              />
            )}
          />
        </div>
      )}
    </Card>
  );
}

function FuelLog({ fuel, vehicles, canWrite, onChanged }: { fuel: ReturnType<typeof useApi<FuelRecord[]>>; vehicles: Vehicle[]; canWrite: boolean; onChanged: () => void }) {
  const [form, setForm] = useState({ vehicleId: "", filledAt: todayIso(), quantity: "", totalCost: "", odometerKm: "" });
  const toast = useToast();
  const vehicle = vehicles.find((v) => v.id === Number(form.vehicleId));
  const unit = vehicle ? FUEL_UNIT[vehicle.fuelType] : "";
  const lastOdo = Math.max(0, ...(fuel.data ?? []).filter((r) => r.vehicle.id === Number(form.vehicleId)).map((r) => r.odometerKm));
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      {canWrite && (
        <Card title="Log a fuel or charge fill" icon={Plus} description="Measured data: what was actually filled and paid">
          <FormShell
            submitLabel="Save fill"
            onSubmit={async () => {
              if (form.filledAt > todayIso()) throw new Error("The fill date can't be in the future.");
              await api("/fuel-records", { body: { vehicleId: Number(form.vehicleId), filledAt: new Date(`${form.filledAt}T12:00:00`).toISOString(), quantity: Number(form.quantity), totalCost: Number(form.totalCost), odometerKm: Number(form.odometerKm) } });
              setForm((f) => ({ ...f, quantity: "", totalCost: "", odometerKm: "" }));
              toast.success("Fill logged");
              fuel.reload();
              onChanged();
            }}
          >
            <Field label="Vehicle" required>
              <Select required value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}>
                <option value="">Select…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber} ({FUEL_UNIT[v.fuelType]})
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <Input type="date" required max={todayIso()} value={form.filledAt} onChange={(e) => setForm((f) => ({ ...f, filledAt: e.target.value }))} />
              </Field>
              <Field label={`Quantity${unit ? ` (${unit})` : ""}`} required>
                <Input type="number" step="any" min={0.01} required value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
              </Field>
              <Field label="Total cost (₹)" required>
                <Input type="number" step="any" min={0} required value={form.totalCost} onChange={(e) => setForm((f) => ({ ...f, totalCost: e.target.value }))} />
              </Field>
              <Field label="Odometer (km)" required hint={lastOdo ? `Highest logged: ${fmtNum(lastOdo, "km")}${form.odometerKm && Number(form.odometerKm) < lastOdo ? " (this reading is lower; fine for an older fill)" : ""}` : undefined}>
                <Input type="number" min={0} required value={form.odometerKm} onChange={(e) => setForm((f) => ({ ...f, odometerKm: e.target.value }))} />
              </Field>
            </div>
          </FormShell>
        </Card>
      )}
      <Card title="Fuel log" icon={Fuel}>
        {fuel.loading ? (
          <TableSkeleton rows={3} />
        ) : fuel.error ? (
          <ErrorState message={fuel.error} onRetry={fuel.reload} />
        ) : (
          <DataTable
            rows={fuel.data ?? []}
            rowKey={(r) => r.id}
            caption="Fuel log"
            searchText={(r) => r.vehicle.registrationNumber}
            searchPlaceholder="Search vehicle…"
            initialSort={{ key: "date", dir: "desc" }}
            columns={[
              { key: "date", header: "Date", sortValue: (r) => r.filledAt, cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.filledAt)}</span> },
              { key: "veh", header: "Vehicle", sortValue: (r) => r.vehicle.registrationNumber, cell: (r) => <span className="whitespace-nowrap">{r.vehicle.registrationNumber}</span> },
              { key: "qty", header: "Quantity", align: "right", cell: (r) => fmtNum(r.quantity, FUEL_UNIT[r.vehicle.fuelType]) },
              { key: "cost", header: "Cost", align: "right", sortValue: (r) => r.totalCost, cell: (r) => fmtMoney(r.totalCost) },
              { key: "odo", header: "Odometer", align: "right", cell: (r) => fmtNum(r.odometerKm, "km"), hideBelow: "md" },
              {
                key: "actions",
                header: <span className="sr-only">Actions</span>,
                cell: (r) =>
                  canWrite && (
                    <ConfirmButton size="sm" confirmLabel="Delete" title="Delete this fill?" description={`${fmtNum(r.quantity, FUEL_UNIT[r.vehicle.fuelType])} for ${r.vehicle.registrationNumber} on ${fmtDate(r.filledAt)} is removed; logged totals and observed mileage change.`} onConfirm={async () => {
                      await api(`/fuel-records/${r.id}`, { method: "DELETE" });
                      fuel.reload();
                      onChanged();
                    }}>
                      Delete
                    </ConfirmButton>
                  ),
              },
            ]}
            empty={{ title: "No fills logged", icon: Fuel, description: "Log fuel or charge fills to compare estimates with real consumption." }}
          />
        )}
      </Card>
    </div>
  );
}
