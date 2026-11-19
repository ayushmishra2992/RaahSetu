"use client";

import { Fingerprint, Pencil } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { Driver } from "@/lib/types";
import { FormShell } from "./forms";
import { Badge, Button, Card, Checkbox, Field, Input, Modal, Select, Textarea, useToast } from "./ds";

/**
 * Privacy-first KYC (admins/managers only — the API strips these fields for other roles).
 * Stores only the ID type and its last 4 characters, never a full Aadhaar/ID number.
 */
export function DriverKycCard({ driver, onSaved }: { driver: Driver; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const recorded = !!driver.kycConsentAt;

  return (
    <Card
      title="Personal details & KYC"
      icon={Fingerprint}
      description="Visible to admins and managers only"
      actions={
        <>
          {driver.kycVerification && <Badge color={driver.kycVerification === "VERIFIED" ? "green" : driver.kycVerification === "REJECTED" ? "red" : "amber"}>{humanize(driver.kycVerification)}</Badge>}
          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
            {recorded ? "Edit" : "Record"}
          </Button>
        </>
      }
    >
      {recorded ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">ID</dt>
            <dd className="text-ink">{driver.kycIdType ? `${humanize(driver.kycIdType)} ending ${driver.kycIdLast4 ?? "—"}` : "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Consent recorded</dt>
            <dd className="text-ink">{fmtDateTime(driver.kycConsentAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Address</dt>
            <dd className="text-ink">{driver.address ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Emergency contact</dt>
            <dd className="text-ink">{driver.emergencyContactName ? `${driver.emergencyContactName}${driver.emergencyContactPhone ? ` · ${driver.emergencyContactPhone}` : ""}` : "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted">No KYC recorded. Record it only with the driver&apos;s consent; RaahSetu stores just the last 4 characters of the ID.</p>
      )}
      {recorded && driver.kycVerification !== "VERIFIED" && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await api(`/drivers/${driver.id}/kyc/verify`, { body: { status: "VERIFIED" } });
              toast.success("KYC marked verified");
              onSaved();
            }}
          >
            Mark verified
          </Button>
        </div>
      )}
      <Modal open={editing} title={`KYC · ${driver.name}`} onClose={() => setEditing(false)}>
        {editing && <KycForm driver={driver} onSaved={() => { setEditing(false); toast.success("KYC saved"); onSaved(); }} />}
      </Modal>
    </Card>
  );
}

function KycForm({ driver, onSaved }: { driver: Driver; onSaved: () => void }) {
  const [f, setF] = useState({
    idType: driver.kycIdType ?? "AADHAAR",
    idLast4: driver.kycIdLast4 ?? "",
    address: driver.address ?? "",
    emergencyContactName: driver.emergencyContactName ?? "",
    emergencyContactPhone: driver.emergencyContactPhone ?? "",
    consent: false,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormShell
      submitLabel="Save KYC"
      onSubmit={async () => {
        if (!f.consent) throw new Error("Confirm that the driver has consented before saving.");
        if (f.idLast4 && !/^[A-Za-z0-9]{4}$/.test(f.idLast4)) throw new Error("Enter only the last 4 characters of the ID.");
        await api(`/drivers/${driver.id}/kyc`, {
          method: "PUT",
          body: {
            consent: true,
            idType: f.idLast4 ? f.idType : null,
            idLast4: f.idLast4 || null,
            address: f.address || null,
            emergencyContactName: f.emergencyContactName || null,
            emergencyContactPhone: f.emergencyContactPhone || null,
          },
        });
        onSaved();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="ID type">
          <Select value={f.idType} onChange={set("idType")}>
            {["AADHAAR", "PAN", "VOTER_ID", "PASSPORT", "OTHER"].map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Last 4 characters" hint="Never the full number">
          <Input value={f.idLast4} onChange={set("idLast4")} maxLength={4} inputMode="text" autoComplete="off" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea rows={2} value={f.address} onChange={set("address")} autoComplete="off" />
        </Field>
        <Field label="Emergency contact name">
          <Input value={f.emergencyContactName} onChange={set("emergencyContactName")} autoComplete="off" />
        </Field>
        <Field label="Emergency contact phone">
          <Input type="tel" inputMode="tel" value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} autoComplete="off" />
        </Field>
      </div>
      <Checkbox
        checked={f.consent}
        onChange={(e) => setF((s) => ({ ...s, consent: e.target.checked }))}
        label="The driver has agreed to these details being recorded"
        description="For employment and safety purposes. The time and the user recording consent are saved."
      />
    </FormShell>
  );
}
