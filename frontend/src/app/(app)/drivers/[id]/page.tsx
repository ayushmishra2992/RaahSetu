"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DriverForm } from "@/components/forms";
import { Alert, Button, Card, ConfirmButton, ErrorState, Loading, Modal, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { ComplianceDoc, Driver, Trip } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type DriverDetail = Driver & { documents: ComplianceDoc[]; trips: Array<Trip & { vehicle: { id: number; registrationNumber: string } }> };

export default function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const { data: d, error, loading, reload } = useApi<DriverDetail>(`/drivers/${id}`);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !d) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={d.name}
        subtitle={`${d.phone} · Licence ${d.licenseNumber} (expires ${fmtDate(d.licenseExpiry)})`}
        actions={can("fleet:write") && (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
            <ConfirmButton confirmLabel="Delete driver" onConfirm={async () => {
              try { await api(`/drivers/${d.id}`, { method: "DELETE" }); router.push("/drivers"); } catch (e) { setActionError(errorMessage(e)); }
            }}>Delete</ConfirmButton>
          </>
        )}
      />
      {actionError && <Alert>{actionError}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Status"><StatusBadge status={d.status} /></Card>
        <Card title="Shift limit">{d.maxShiftHours} hours per route</Card>
        <Card title="App login">{d.user?.email ?? "Not linked"}</Card>
      </div>
      <Card title="Documents" actions={<Link href={`/documents?driverId=${d.id}`} className="text-sm font-medium text-brand-700">Manage →</Link>}>
        <Table head={["Type", "Number", "Expires"]} empty={d.documents.length === 0}>
          {d.documents.map((doc) => (<tr key={doc.id}><Td>{doc.type}</Td><Td>{doc.documentNumber}</Td><Td>{fmtDate(doc.expiresOn)}</Td></tr>))}
        </Table>
      </Card>
      <Card title="Recent trips">
        <Table head={["Trip", "Vehicle", "Start", "Status"]} empty={d.trips.length === 0}>
          {d.trips.map((t) => (<tr key={t.id}><Td><Link className="text-brand-700" href={`/trips/${t.id}`}>{t.tripNumber}</Link></Td><Td>{t.vehicle.registrationNumber}</Td><Td>{fmtDateTime(t.plannedStart)}</Td><Td><StatusBadge status={t.status} /></Td></tr>))}
        </Table>
      </Card>
      <Modal open={editing} title={`Edit ${d.name}`} onClose={() => setEditing(false)} wide>
        <DriverForm driver={d} onSaved={() => { setEditing(false); reload(); }} />
      </Modal>
    </div>
  );
}
