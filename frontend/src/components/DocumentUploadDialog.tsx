"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "@/lib/api";
import { docTypeLabel, DRIVER_DOC_TYPES, VEHICLE_DOC_TYPES } from "@/lib/format";
import type { Driver, Vehicle } from "@/lib/types";
import { uploadWithProgress } from "@/lib/upload";
import { useApi } from "@/lib/useApi";
import { useAuth } from "./AuthProvider";
import { FileCapture, UploadProgress, type PickedFile } from "./FileCapture";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "./ds";

/** Licences, RCs and ID cards are two-sided; everything else is one or more pages. */
export const TWO_SIDED = new Set(["DRIVING_LICENSE", "RC", "KYC_ID"]);
const NO_EXPIRY = new Set(["RC", "DRIVER_PHOTO", "KYC_ID", "FASTAG", "OTHER"]);

export const DATES_ERROR = "Expiry date can’t be before the issue date.";

type Owner = { vehicleId?: number; driverId?: number };

/**
 * The document upload experience: camera capture, gallery/PDF upload, preview,
 * rotate, compression, front/back for two-sided cards, validation, upload
 * progress and retry. With `chooseOwner` it also asks which vehicle or driver
 * the document belongs to (used on the Documents page).
 */
export function DocumentUploadForm({
  owner,
  chooseOwner = false,
  initialType,
  onSaved,
  onCancel,
}: {
  owner?: Owner;
  chooseOwner?: boolean;
  initialType?: string;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const { can } = useAuth();
  const vehicles = useApi<Vehicle[]>(chooseOwner ? "/vehicles" : null);
  const drivers = useApi<Driver[]>(chooseOwner ? "/drivers" : null);
  const [kind, setKind] = useState<"vehicle" | "driver">(owner?.driverId ? "driver" : "vehicle");
  const [vehicleId, setVehicleId] = useState(owner?.vehicleId ? String(owner.vehicleId) : "");
  const [driverId, setDriverId] = useState(owner?.driverId ? String(owner.driverId) : "");
  const types = (kind === "vehicle" ? VEHICLE_DOC_TYPES : DRIVER_DOC_TYPES).filter((t) => t !== "KYC_ID" || can("kyc:write"));
  const [type, setType] = useState<string>(initialType && (types as readonly string[]).includes(initialType) ? initialType : kind === "driver" ? "DRIVING_LICENSE" : "INSURANCE");
  const [f, setF] = useState({ documentNumber: "", issuedOn: "", expiresOn: "", notes: "" });
  const [front, setFront] = useState<PickedFile[]>([]);
  const [back, setBack] = useState<PickedFile[]>([]);
  const [pages, setPages] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datesError, setDatesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const twoSided = TWO_SIDED.has(type);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  function switchKind(next: "vehicle" | "driver") {
    setKind(next);
    // Keep the type valid for the new owner kind.
    setType(next === "driver" ? "DRIVING_LICENSE" : "INSURANCE");
  }

  async function submit() {
    setError(null);
    const dErr = f.issuedOn && f.expiresOn && f.expiresOn < f.issuedOn ? DATES_ERROR : null;
    setDatesError(dErr);
    const owned = kind === "vehicle" ? vehicleId : driverId;
    const problem =
      (!owned && `Choose the ${kind} this document belongs to.`) ||
      (!f.documentNumber.trim() && "Enter the document number.") ||
      (type === "KYC_ID" && /\d{12}/.test(f.documentNumber.replace(/[\s-]/g, "")) && "Never enter a full Aadhaar/ID number. Use a masked number such as XXXX-XXXX-1234.") ||
      dErr ||
      (!NO_EXPIRY.has(type) && !f.expiresOn && `${docTypeLabel(type)} normally has an expiry date — enter it so RaahSetu can warn you before it lapses.`) ||
      null;
    if (problem) return setError(problem);
    const form = new FormData();
    form.set("type", type);
    form.set("documentNumber", f.documentNumber.trim());
    if (f.issuedOn) form.set("issuedOn", new Date(`${f.issuedOn}T00:00:00`).toISOString());
    if (f.expiresOn) form.set("expiresOn", new Date(`${f.expiresOn}T23:59:59`).toISOString());
    if (f.notes.trim()) form.set("notes", f.notes.trim());
    form.set(kind === "vehicle" ? "vehicleId" : "driverId", owned);
    for (const p of twoSided ? front : []) form.append("front", p.file, p.file.name);
    for (const p of twoSided ? back : []) form.append("back", p.file, p.file.name);
    for (const p of twoSided ? [] : pages) form.append("pages", p.file, p.file.name);
    setBusy(true);
    setProgress(0);
    try {
      await uploadWithProgress("/documents", form, setProgress);
      onSaved();
    } catch (e) {
      // Files and fields stay in place, so "Retry upload" resends the same document.
      setProgress(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {chooseOwner && (
          <>
            <Field label="Belongs to">
              <Select value={kind} onChange={(e) => switchKind(e.target.value as "vehicle" | "driver")}>
                <option value="vehicle">Vehicle</option>
                <option value="driver">Driver</option>
              </Select>
            </Field>
            {kind === "vehicle" ? (
              <Field label="Vehicle" required>
                <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Select…</option>
                  {vehicles.data?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationNumber}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Driver" required>
                <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">Select…</option>
                  {drivers.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}
        <Field label="Document">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {docTypeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Document number" required hint={type === "KYC_ID" ? "Masked only, e.g. XXXX-XXXX-1234" : undefined}>
          <Input value={f.documentNumber} maxLength={60} onChange={set("documentNumber")} autoComplete="off" autoCapitalize="characters" />
        </Field>
        <Field label="Issued on">
          <Input type="date" value={f.issuedOn} onChange={set("issuedOn")} />
        </Field>
        <Field label="Expires on" error={datesError} hint={NO_EXPIRY.has(type) ? "Leave blank if it does not expire" : "Dispatch is blocked after this date"}>
          <Input type="date" value={f.expiresOn} onChange={set("expiresOn")} />
        </Field>
      </div>
      {type === "KYC_ID" && <Alert kind="info">Upload a masked Aadhaar (first 8 digits hidden) or another ID. Only admins and managers can see KYC documents, and they are never included in trip packs.</Alert>}
      {twoSided ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FileCapture label="Front side" value={front} onChange={setFront} hint="Place the card flat in good light" />
          <FileCapture label="Back side" value={back} onChange={setBack} />
        </div>
      ) : (
        <FileCapture label="Pages" value={pages} onChange={setPages} max={5} hint="A PDF, or photos of each page. Stored privately; downloads require sign-in." />
      )}
      <Field label="Notes">
        <Textarea rows={2} maxLength={1000} value={f.notes} onChange={set("notes")} />
      </Field>
      <UploadProgress fraction={progress} />
      {error && <Alert title="Couldn't save the document">{error}</Alert>}
      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy} icon={error && progress === null && !datesError ? RefreshCw : undefined}>
          {error && !datesError && /upload|connection|server|timed out/i.test(error) ? "Retry upload" : "Save document"}
        </Button>
      </div>
    </form>
  );
}

/** The upload form in a dialog, for a fixed vehicle or driver (vehicle/driver pages). */
export function DocumentUploadDialog({
  open,
  onClose,
  owner,
  onSaved,
  initialType,
}: {
  open: boolean;
  onClose: () => void;
  owner: Owner & { label: string };
  onSaved: () => void;
  initialType?: string;
}) {
  return (
    <Modal open={open} title={`Add document · ${owner.label}`} onClose={onClose} wide>
      {open && (
        <DocumentUploadForm
          owner={owner}
          initialType={initialType}
          onCancel={onClose}
          onSaved={() => {
            onSaved();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
