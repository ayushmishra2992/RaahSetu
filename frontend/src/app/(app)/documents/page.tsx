"use client";

import { Download, FilePlus2, Pencil, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { DocumentUploadForm } from "@/components/DocumentUploadDialog";
import { ComplianceOverviewCard } from "@/components/ComplianceOverviewCard";
import {
  Alert,
  Badge,
  Button,
  ConfirmButton,
  DataTable,
  ErrorState,
  Field,
  Input,
  ListCard,
  Loading,
  Modal,
  PageHeader,
  Select,
  Stat,
  StatusBadge,
  TableSkeleton,
  Tabs,
  Textarea,
  type Column,
} from "@/components/ds";
import { api } from "@/lib/api";
import { daysUntil, docTypeLabel, fmtDate, fmtRelDays, humanize } from "@/lib/format";
import type { ComplianceDoc } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const TYPES = ["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT", "STATE_PERMIT", "FASTAG", "DRIVING_LICENSE", "DRIVER_PHOTO", "KYC_ID", "OTHER"] as const;
const STATES = ["EXPIRED", "EXPIRING_SOON", "VALID", "NO_EXPIRY"] as const;

/** Dates are entered as calendar days; stored as start/end of that local day like before. */
const isoStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const isoEnd = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);

function datesError(issuedOn: string, expiresOn: string) {
  return issuedOn && expiresOn && expiresOn < issuedOn ? "Expiry date can’t be before the issue date." : null;
}

function EditForm({ doc, onSaved }: { doc: ComplianceDoc; onSaved: () => void }) {
  const [f, setF] = useState({ type: doc.type, documentNumber: doc.documentNumber, issuedOn: doc.issuedOn ? toLocalDate(doc.issuedOn) : "", expiresOn: doc.expiresOn ? toLocalDate(doc.expiresOn) : "", notes: doc.notes ?? "" });
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormShell
      submitLabel="Save changes"
      onSubmit={async () => {
        const err = datesError(f.issuedOn, f.expiresOn);
        setExpiryError(err);
        if (err) throw new Error(err);
        await api(`/documents/${doc.id}`, { method: "PATCH", body: { type: f.type, documentNumber: f.documentNumber.trim(), issuedOn: isoStart(f.issuedOn), expiresOn: isoEnd(f.expiresOn), notes: f.notes.trim() || null } });
        onSaved();
      }}
    >
      <p className="text-sm text-muted">
        For a renewal, enter the new number and dates. To attach a new scan, add the renewed document as a new record; the existing file can’t be replaced here.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Document type">
          <Select value={f.type} onChange={set("type")}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{docTypeLabel(t)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Document number" required>
          <Input required maxLength={60} value={f.documentNumber} onChange={set("documentNumber")} />
        </Field>
        <Field label="Issued on">
          <Input type="date" value={f.issuedOn} onChange={set("issuedOn")} />
        </Field>
        <Field label="Expires on" error={expiryError}>
          <Input type="date" value={f.expiresOn} onChange={set("expiresOn")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Textarea maxLength={1000} value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
      </div>
    </FormShell>
  );
}

/** Local calendar date of a stored timestamp (expiry is stored as 23:59:59 local). */
function toLocalDate(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function DocumentsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { can, me } = useAuth();
  const write = can("documents:write");
  const alertDays = me.company.settings.documentExpiryAlertDays;
  const [type, setType] = useState("");
  const [state, setState] = useState("all");
  const [editing, setEditing] = useState<ComplianceDoc | null>(null);
  const vehicleId = params.get("vehicleId") ?? undefined;
  const driverId = params.get("driverId") ?? undefined;
  const creating = write && params.get("new") === "1";
  const setParams = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  const qs = new URLSearchParams({ ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) }).toString();
  const { data, error, loading, reload } = useApi<ComplianceDoc[]>(`/documents${qs ? `?${qs}` : ""}`);
  const all = data ?? [];
  const count = (s: string) => all.filter((d) => d.expiryState === s).length;
  const rows = all.filter((d) => (state === "all" || d.expiryState === state) && (!type || d.type === type));
  const ownerLabel = vehicleId ? all.find((d) => d.vehicleId === Number(vehicleId))?.vehicle?.registrationNumber ?? `vehicle #${vehicleId}` : driverId ? all.find((d) => d.driverId === Number(driverId))?.driver?.name ?? `driver #${driverId}` : null;

  const columns: Array<Column<ComplianceDoc>> = [
    { key: "type", header: "Type", sortValue: (d) => d.type, cell: (d) => <span className="whitespace-nowrap font-medium text-ink">{docTypeLabel(d.type)}</span> },
    { key: "number", header: "Number", sortValue: (d) => d.documentNumber, cell: (d) => <span className="whitespace-nowrap text-xs">{d.documentNumber}</span>, hideBelow: "md" },
    {
      key: "owner",
      header: "Belongs to",
      sortValue: (d) => d.vehicle?.registrationNumber ?? d.driver?.name,
      cell: (d) =>
        d.vehicle ? (
          <Link className="whitespace-nowrap text-brand-700 hover:underline" href={`/vehicles/${d.vehicle.id}`}>{d.vehicle.registrationNumber}</Link>
        ) : d.driver ? (
          <Link className="whitespace-nowrap text-brand-700 hover:underline" href={`/drivers/${d.driver.id}`}>{d.driver.name}</Link>
        ) : (
          "—"
        ),
    },
    {
      key: "expires",
      header: "Expires",
      sortValue: (d) => d.expiresOn,
      cell: (d) => (
        <span className="whitespace-nowrap text-xs">
          {fmtDate(d.expiresOn)}
          {d.expiresOn && d.expiryState !== "VALID" && <span className="block text-muted">{fmtRelDays(daysUntil(d.expiresOn))}</span>}
        </span>
      ),
      hideBelow: "sm",
    },
    { key: "state", header: "State", sortValue: (d) => STATES.indexOf(d.expiryState ?? "NO_EXPIRY"), cell: (d) => d.expiryState && <StatusBadge status={d.expiryState} /> },
    {
      key: "file",
      header: "Scan",
      hideBelow: "md",
      cell: (d) =>
        d.hasFile ? (
          <a href={`/api/documents/${d.id}/file`} className="inline-flex items-center gap-1 text-brand-700 hover:underline" aria-label={`Download scan of ${docTypeLabel(d.type)} ${d.documentNumber}`}>
            <Download size={14} aria-hidden /> Download
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (d) =>
        write && (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(d)} aria-label={`Edit ${docTypeLabel(d.type)} ${d.documentNumber}`}>
              Edit
            </Button>
            <ConfirmButton size="sm" confirmLabel="Delete" description={`${docTypeLabel(d.type)} ${d.documentNumber}${d.hasFile ? " and its stored scan" : ""} will be removed. Expiry alerts for it stop.`} onConfirm={async () => {
              await api(`/documents/${d.id}`, { method: "DELETE" });
              reload();
            }}>
              Delete
            </ConfirmButton>
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compliance documents"
        subtitle={`RC, insurance, PUC, fitness, permits and driving licences. “Expiring soon” means within ${alertDays} days (Settings).`}
        actions={
          write && (
            <Button icon={FilePlus2} onClick={() => setParams({ new: "1" })}>
              Add document
            </Button>
          )
        }
      />
      <Alert kind="info">
        States are calculated from the dates entered in RaahSetu. Documents are not checked against VAHAN, Sarathi, insurers or any government system.
      </Alert>
      {!ownerLabel && <ComplianceOverviewCard />}

      {ownerLabel && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Showing documents for</span>
          <Badge color="teal">{ownerLabel}</Badge>
          <Button size="sm" variant="ghost" icon={X} onClick={() => setParams({ vehicleId: null, driverId: null })}>
            Show all
          </Button>
        </div>
      )}

      {data && (
        <section aria-label="Documents by state" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Expired" value={count("EXPIRED")} hint="Block dispatch if vehicle-critical" className={count("EXPIRED") ? "border-danger-600/30" : undefined} />
          <Stat label="Expiring soon" value={count("EXPIRING_SOON")} hint={`Within ${alertDays} days`} />
          <Stat label="Valid" value={count("VALID")} />
          <Stat label="No expiry date" value={count("NO_EXPIRY")} hint="e.g. RC without a date" />
        </section>
      )}

      <Tabs
        label="Filter documents by state"
        value={state}
        onChange={setState}
        tabs={[{ id: "all", label: "All", count: all.length }, ...STATES.map((s) => ({ id: s, label: humanize(s), count: count(s) }))]}
      />
      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(d) => d.id}
          searchText={(d) => `${d.type} ${docTypeLabel(d.type)} ${d.documentNumber} ${d.vehicle?.registrationNumber ?? ""} ${d.driver?.name ?? ""}`}
          searchPlaceholder="Search number, vehicle or driver…"
          toolbar={
            <Select aria-label="Filter by document type" value={type} onChange={(e) => setType(e.target.value)} className="sm:w-48">
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>{docTypeLabel(t)}</option>
              ))}
            </Select>
          }
          initialSort={{ key: "expires", dir: "asc" }}
          caption="Compliance documents"
          mobileCard={(d) => (
            <ListCard
              title={`${docTypeLabel(d.type)} · ${d.documentNumber}`}
              status={d.expiryState && <StatusBadge status={d.expiryState} />}
              subtitle={d.vehicle?.registrationNumber ?? d.driver?.name ?? "—"}
              details={[
                ["Expires", d.expiresOn ? `${fmtDate(d.expiresOn)}${d.expiryState !== "VALID" ? ` · ${fmtRelDays(daysUntil(d.expiresOn))}` : ""}` : "No expiry date"],
                ["Scan", d.hasFile ? <a key="f" href={`/api/documents/${d.id}/file`} className="text-brand-700 underline">Download</a> : "None"],
              ]}
              actions={columns.find((c) => c.key === "actions")?.cell(d)}
            />
          )}
          empty={{
            title: all.length ? "No documents match these filters" : "No documents recorded",
            icon: ShieldCheck,
            description: all.length ? undefined : "Record RC, insurance, PUC, fitness, permits and licences to get expiry alerts and dispatch checks.",
            action: !all.length && write ? <Button icon={FilePlus2} onClick={() => setParams({ new: "1" })}>Add document</Button> : undefined,
          }}
        />
      )}

      <Modal open={creating} title="Add compliance document" onClose={() => setParams({ new: null })} wide>
        {creating && (
          <DocumentUploadForm
            chooseOwner
            owner={{ vehicleId: vehicleId ? Number(vehicleId) : undefined, driverId: driverId ? Number(driverId) : undefined }}
            onCancel={() => setParams({ new: null })}
            onSaved={() => {
              setParams({ new: null });
              reload();
            }}
          />
        )}
      </Modal>
      <Modal open={!!editing} title={editing ? `Edit ${docTypeLabel(editing.type)} ${editing.documentNumber}` : "Edit document"} onClose={() => setEditing(null)} wide>
        {editing && (
          <EditForm
            key={editing.id}
            doc={editing}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        )}
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
