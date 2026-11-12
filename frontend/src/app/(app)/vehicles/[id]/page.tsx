"use client";

import { Fuel, Gauge, MapPin, Navigation, Pencil, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ComplianceList } from "@/components/ComplianceList";
import { VehicleForm } from "@/components/forms";
import { Alert, Badge, Button, Card, ConfirmButton, ErrorState, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Td, useToast } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, FUEL_UNIT, humanize } from "@/lib/format";
import type { ComplianceDoc, Trip, Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type VehicleDetail = Vehicle & {
  documents: ComplianceDoc[];
  trips: Array<Trip & { driver: { id: number; name: string } }>;
  fuelRecords: Array<{ id: number; filledAt: string; quantity: number; totalCost: number; odometerKm: number }>;
};

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const { data: v, error, loading, reload } = useApi<VehicleDetail>(`/vehicles/${id}`);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();

  if (loading) return <Loading variant="page" label="Loading vehicle…" />;
  if (error || !v) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const unit = FUEL_UNIT[v.fuelType];
  const activeTrip = v.trips.find((t) => t.status === "DISPATCHED" || t.status === "IN_TRANSIT");

  return (
    <div className="space-y-5">
      <PageHeader
        title={v.registrationNumber}
        subtitle={`${humanize(v.type)}${[v.make, v.model, v.year].some(Boolean) ? ` · ${[v.make, v.model, v.year].filter(Boolean).join(" ")}` : ""}`}
        meta={
          <>
            <StatusBadge status={v.status} />
            {!v.depotLocationId && <Badge color="amber">No depot — can’t be planned</Badge>}
          </>
        }
        actions={
          can("fleet:write") && (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <ConfirmButton
                confirmLabel="Delete vehicle"
                title={`Delete ${v.registrationNumber}?`}
                description="Vehicles with trip history can’t be deleted; set them to Inactive instead. Documents and fuel records of this vehicle are removed with it."
                onConfirm={async () => {
                  try {
                    await api(`/vehicles/${v.id}`, { method: "DELETE" });
                    toast.success(`${v.registrationNumber} deleted`);
                    router.push("/vehicles");
                  } catch (e) {
                    setActionError(errorMessage(e));
                  }
                }}
              >
                <Trash2 size={15} aria-hidden /> Delete
              </ConfirmButton>
            </>
          )
        }
      />
      {actionError && <Alert title="Couldn't delete the vehicle">{actionError}</Alert>}
      {activeTrip && (
        <Alert kind="info">
          On trip <Link href={`/trips/${activeTrip.id}`}>{activeTrip.tripNumber}</Link> ({humanize(activeTrip.status).toLowerCase()}) with {activeTrip.driver.name}.
        </Alert>
      )}

      <section aria-label="Vehicle specification" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Capacity" icon={Truck} value={fmtNum(v.capacityKg, "kg")} />
        <Stat label="Configured mileage" icon={Gauge} value={`${v.mileageKmPerUnit} km/${unit}`} hint={`${humanize(v.fuelType)} · empty load`} />
        <Stat label="Odometer" icon={Navigation} value={fmtNum(v.odometerKm, "km")} hint={`Avg speed ${v.avgSpeedKmph} km/h`} />
        <Stat label="Home depot" icon={MapPin} value={v.depotLocation?.name ?? "Not set"} hint={v.depotLocation ? "Routes start here" : "Required for planning"} />
      </section>

      <ComplianceList docs={v.documents} owner={{ vehicleId: v.id }} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Recent trips" icon={Navigation}>
          <Table head={["Trip", "Driver", "Start", "Status"]} empty={v.trips.length === 0} emptyMessage="No trips yet." caption="Recent trips">
            {v.trips.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link className="whitespace-nowrap font-medium text-brand-700 hover:underline" href={`/trips/${t.id}`}>{t.tripNumber}</Link>
                </Td>
                <Td>{t.driver.name}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(t.plannedStart)}</Td>
                <Td>
                  <StatusBadge status={t.status} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Fuel log" icon={Fuel} description="Measured fills you recorded" actions={can("fuel:write") && <Link href="/greenfleet#log-fuel" className="text-xs font-medium text-brand-700 hover:underline">Log fuel</Link>}>
          <Table head={["Date", "Quantity", "Cost", "Odometer"]} empty={v.fuelRecords.length === 0} emptyMessage="No fills logged." caption="Fuel log">
            {v.fuelRecords.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{fmtDate(r.filledAt)}</Td>
                <Td className="tabular whitespace-nowrap">{fmtNum(r.quantity, unit)}</Td>
                <Td className="tabular whitespace-nowrap">{fmtMoney(r.totalCost)}</Td>
                <Td className="tabular whitespace-nowrap">{fmtNum(r.odometerKm, "km")}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Modal open={editing} title={`Edit ${v.registrationNumber}`} onClose={() => setEditing(false)} wide>
        {editing && (
          <VehicleForm
            vehicle={v}
            onSaved={() => {
              setEditing(false);
              toast.success("Vehicle updated");
              reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
