"use client";

import { Clock, IdCard, Navigation, Pencil, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ComplianceList, ComplianceSummary } from "@/components/ComplianceList";
import { DriverKycCard } from "@/components/DriverKycCard";
import { DriverForm } from "@/components/forms";
import { Alert, Button, Card, ConfirmButton, ErrorState, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Td, useToast } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { daysUntil, expiryStateOf, fmtDate, fmtDateTime, fmtRelDays } from "@/lib/format";
import type { ComplianceDoc, Driver, EntityCompliance, Trip } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type DriverDetail = Driver & { compliance?: EntityCompliance; documents: ComplianceDoc[]; trips: Array<Trip & { vehicle: { id: number; registrationNumber: string } }> };

export default function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, me } = useAuth();
  const { data: d, error, loading, reload } = useApi<DriverDetail>(`/drivers/${id}`);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();
  if (loading) return <Loading variant="page" label="Loading driver…" />;
  if (error || !d) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const licence = expiryStateOf(d.licenseExpiry, me.company.settings.documentExpiryAlertDays);

  return (
    <div className="space-y-5">
      <PageHeader
        title={d.name}
        subtitle={`${d.phone} · licence ${d.licenseNumber}${d.licenseClass ? ` (${d.licenseClass})` : ""}`}
        meta={
          <>
            <StatusBadge status={d.status} />
            <StatusBadge status={licence} label={`Licence ${licence === "EXPIRED" ? "expired" : licence === "EXPIRING_SOON" ? "due soon" : "valid"}`} />
          </>
        }
        actions={
          can("fleet:write") && (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <ConfirmButton
                confirmLabel="Delete driver"
                title={`Delete ${d.name}?`}
                description="Drivers with trip history can’t be deleted; set them to Inactive instead. Their compliance documents are removed with them; a linked app login is kept."
                onConfirm={async () => {
                  try {
                    await api(`/drivers/${d.id}`, { method: "DELETE" });
                    toast.success(`${d.name} deleted`);
                    router.push("/drivers");
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
      {actionError && <Alert title="Couldn't delete the driver">{actionError}</Alert>}
      {licence === "EXPIRED" && <Alert kind="warning">The driving licence expired {fmtDate(d.licenseExpiry)}. This driver can’t be dispatched or planned until it is renewed.</Alert>}

      <section aria-label="Driver details" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Licence expiry" icon={IdCard} value={fmtDate(d.licenseExpiry)} hint={fmtRelDays(daysUntil(d.licenseExpiry))} />
        <Stat label="Shift limit" icon={Clock} value={`${d.maxShiftHours} h`} hint="Caps route duration in OptiRoute" />
        <Stat label="App login" icon={Smartphone} value={d.user ? "Linked" : "Not linked"} hint={d.user?.email ?? "Link a DRIVER user to let them update trips"} className="col-span-2 lg:col-span-1" />
      </section>

      {d.compliance && <ComplianceSummary compliance={d.compliance} subject={d.name} />}
      <ComplianceList docs={d.documents} owner={{ driverId: d.id, label: d.name }} onChanged={reload} />
      {can("kyc:read") && <DriverKycCard driver={d} onSaved={reload} />}

      <Card title="Recent trips" icon={Navigation}>
        <Table head={["Trip", "Vehicle", "Start", "Status"]} empty={d.trips.length === 0} emptyMessage="No trips yet." caption="Recent trips">
          {d.trips.map((t) => (
            <tr key={t.id}>
              <Td>
                <Link className="whitespace-nowrap font-medium text-brand-700 hover:underline" href={`/trips/${t.id}`}>{t.tripNumber}</Link>
              </Td>
              <Td className="whitespace-nowrap">{t.vehicle.registrationNumber}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtDateTime(t.plannedStart)}</Td>
              <Td>
                <StatusBadge status={t.status} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={editing} title={`Edit ${d.name}`} onClose={() => setEditing(false)} wide>
        {editing && (
          <DriverForm
            driver={d}
            onSaved={() => {
              setEditing(false);
              toast.success("Driver updated");
              reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
