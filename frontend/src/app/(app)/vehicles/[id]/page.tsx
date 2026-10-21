"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { VehicleForm } from "@/components/forms";
import { Alert, Button, Card, ConfirmButton, ErrorState, Loading, Modal, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, FUEL_UNIT, humanize, isPast } from "@/lib/format";
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

  if (loading) return <Loading />;
  if (error || !v) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const unit = FUEL_UNIT[v.fuelType];

  return (
    <div className="space-y-5">
      <PageHeader
        title={v.registrationNumber}
        subtitle={`${humanize(v.type)} · ${[v.make, v.model, v.year].filter(Boolean).join(" ")}`}
        actions={
          can("fleet:write") && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
              <ConfirmButton
                confirmLabel="Delete vehicle"
                onConfirm={async () => {
                  try {
                    await api(`/vehicles/${v.id}`, { method: "DELETE" });
                    router.push("/vehicles");
                  } catch (e) {
                    setActionError(errorMessage(e));
                  }
                }}
              >
                Delete
              </ConfirmButton>
            </>
          )
        }
      />
      {actionError && <Alert>{actionError}</Alert>}
      <div className="grid gap-4 md:grid-cols-4">
        <Card title="Status"><StatusBadge status={v.status} /></Card>
        <Card title="Capacity"><span className="tabular text-lg font-semibold">{fmtNum(v.capacityKg, "kg")}</span></Card>
        <Card title="Efficiency"><span className="tabular text-lg font-semibold">{v.mileageKmPerUnit} km/{unit}</span><div className="text-xs text-muted">configured, empty load</div></Card>
        <Card title="Depot">{v.depotLocation?.name ?? <span className="text-amber-700">Not set — vehicle cannot be planned</span>}</Card>
      </div>
      <Card title="Compliance documents" actions={<Link href={`/documents?vehicleId=${v.id}`} className="text-sm font-medium text-brand-700">Manage →</Link>}>
        <Table head={["Type", "Number", "Expires", "State"]} empty={v.documents.length === 0}>
          {v.documents.map((d) => (
            <tr key={d.id}><Td>{d.type}</Td><Td>{d.documentNumber}</Td><Td>{fmtDate(d.expiresOn)}</Td><Td>{isPast(d.expiresOn) ? <StatusBadge status="EXPIRED" /> : <StatusBadge status="VALID" />}</Td></tr>
          ))}
        </Table>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Recent trips">
          <Table head={["Trip", "Driver", "Start", "Status"]} empty={v.trips.length === 0}>
            {v.trips.map((t) => (
              <tr key={t.id}><Td><Link className="text-brand-700" href={`/trips/${t.id}`}>{t.tripNumber}</Link></Td><Td>{t.driver.name}</Td><Td>{fmtDateTime(t.plannedStart)}</Td><Td><StatusBadge status={t.status} /></Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Fuel log (measured)" actions={<Link href="/greenfleet" className="text-sm font-medium text-brand-700">Log fuel →</Link>}>
          <Table head={["Date", "Qty", "Cost", "Odometer"]} empty={v.fuelRecords.length === 0}>
            {v.fuelRecords.map((r) => (
              <tr key={r.id}><Td>{fmtDate(r.filledAt)}</Td><Td className="tabular">{fmtNum(r.quantity, unit)}</Td><Td className="tabular">{fmtMoney(r.totalCost)}</Td><Td className="tabular">{fmtNum(r.odometerKm, "km")}</Td></tr>
            ))}
          </Table>
        </Card>
      </div>
      <Modal open={editing} title={`Edit ${v.registrationNumber}`} onClose={() => setEditing(false)} wide>
        <VehicleForm vehicle={v} onSaved={() => { setEditing(false); reload(); }} />
      </Modal>
    </div>
  );
}
