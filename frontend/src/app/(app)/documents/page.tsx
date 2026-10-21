"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { Button, ConfirmButton, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { ComplianceDoc, Driver, Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const TYPES = ["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "DRIVING_LICENSE", "OTHER"];

function UploadForm({ onSaved, presetVehicle, presetDriver }: { onSaved: () => void; presetVehicle?: string; presetDriver?: string }) {
  const vehicles = useApi<Vehicle[]>("/vehicles");
  const drivers = useApi<Driver[]>("/drivers");
  const [owner, setOwner] = useState<"vehicle" | "driver">(presetDriver ? "driver" : "vehicle");
  const [f, setF] = useState({ type: "INSURANCE", documentNumber: "", issuedOn: "", expiresOn: "", notes: "", vehicleId: presetVehicle ?? "", driverId: presetDriver ?? "" });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormShell
      submitLabel="Save document"
      onSubmit={async () => {
        const fd = new FormData();
        fd.set("type", f.type);
        fd.set("documentNumber", f.documentNumber);
        if (f.issuedOn) fd.set("issuedOn", new Date(`${f.issuedOn}T00:00:00`).toISOString());
        if (f.expiresOn) fd.set("expiresOn", new Date(`${f.expiresOn}T23:59:59`).toISOString());
        if (f.notes) fd.set("notes", f.notes);
        if (owner === "vehicle") fd.set("vehicleId", f.vehicleId);
        else fd.set("driverId", f.driverId);
        if (file) fd.set("file", file);
        await api("/documents", { body: fd });
        onSaved();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Belongs to">
          <Select value={owner} onChange={(e) => setOwner(e.target.value as "vehicle" | "driver")}>
            <option value="vehicle">Vehicle</option>
            <option value="driver">Driver</option>
          </Select>
        </Field>
        {owner === "vehicle" ? (
          <Field label="Vehicle">
            <Select required value={f.vehicleId} onChange={set("vehicleId")}>
              <option value="">Select…</option>
              {vehicles.data?.map((v) => (<option key={v.id} value={v.id}>{v.registrationNumber}</option>))}
            </Select>
          </Field>
        ) : (
          <Field label="Driver">
            <Select required value={f.driverId} onChange={set("driverId")}>
              <option value="">Select…</option>
              {drivers.data?.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
            </Select>
          </Field>
        )}
        <Field label="Document type">
          <Select value={f.type} onChange={set("type")}>{TYPES.map((t) => (<option key={t}>{t}</option>))}</Select>
        </Field>
        <Field label="Document number"><Input required value={f.documentNumber} onChange={set("documentNumber")} /></Field>
        <Field label="Issued on"><Input type="date" value={f.issuedOn} onChange={set("issuedOn")} /></Field>
        <Field label="Expires on" hint="RC/insurance/PUC/fitness/permit past expiry block dispatch"><Input type="date" value={f.expiresOn} onChange={set("expiresOn")} /></Field>
        <div className="sm:col-span-2">
          <Field label="Scan (optional)" hint="PDF, PNG, JPEG or WEBP up to 5 MB. Stored privately, never public.">
            <Input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea value={f.notes} onChange={set("notes")} /></Field></div>
      </div>
    </FormShell>
  );
}

function DocumentsInner() {
  const params = useSearchParams();
  const { can } = useAuth();
  const [type, setType] = useState("");
  const [within, setWithin] = useState("");
  const [creating, setCreating] = useState(false);
  const vehicleId = params.get("vehicleId") ?? undefined;
  const driverId = params.get("driverId") ?? undefined;
  const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(within ? { expiringWithinDays: within } : {}), ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) }).toString();
  const { data, error, loading, reload } = useApi<ComplianceDoc[]>(`/documents${qs ? `?${qs}` : ""}`);

  return (
    <div>
      <PageHeader title="Compliance documents" subtitle="RC, insurance, PUC, fitness, permits and licences with expiry tracking." actions={can("documents:write") && <Button onClick={() => setCreating(true)}>Add document</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-[200px]">
          <option value="">All types</option>
          {TYPES.map((t) => (<option key={t}>{t}</option>))}
        </Select>
        <Select value={within} onChange={(e) => setWithin(e.target.value)} className="max-w-[220px]">
          <option value="">Any expiry</option>
          <option value="0">Expired</option>
          <option value="30">Expired or due in 30 days</option>
          <option value="90">Expired or due in 90 days</option>
        </Select>
        {(vehicleId || driverId) && <Link href="/documents" className="self-center text-sm text-brand-700">Clear owner filter</Link>}
      </div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <Table head={["Type", "Number", "Owner", "Expires", "State", "File", ""]} empty={data?.length === 0}>
          {data?.map((d) => (
            <tr key={d.id}>
              <Td className="font-medium">{d.type}</Td>
              <Td>{d.documentNumber}</Td>
              <Td>{d.vehicle?.registrationNumber ?? d.driver?.name ?? "—"}</Td>
              <Td>{fmtDate(d.expiresOn)}</Td>
              <Td>{d.expiryState && <StatusBadge status={d.expiryState} />}</Td>
              <Td>{d.hasFile ? <a href={`/api/documents/${d.id}/file`} className="text-brand-700 underline">Download</a> : "—"}</Td>
              <Td>{can("documents:write") && <ConfirmButton confirmLabel="Delete" onConfirm={async () => { await api(`/documents/${d.id}`, { method: "DELETE" }); reload(); }}>Delete</ConfirmButton>}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={creating} title="Add compliance document" onClose={() => setCreating(false)} wide>
        <UploadForm presetVehicle={vehicleId} presetDriver={driverId} onSaved={() => { setCreating(false); reload(); }} />
      </Modal>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentsInner />
    </Suspense>
  );
}
