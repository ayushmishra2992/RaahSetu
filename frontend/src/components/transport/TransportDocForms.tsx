"use client";

import { History } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDateTime, fmtNum, humanize } from "@/lib/format";
import type { DocHistoryEvent, EwayBill, FreightPaymentTerms, LorryReceipt } from "@/lib/types";
import { uploadWithProgress } from "@/lib/upload";
import { useApi } from "@/lib/useApi";
import { FileCapture, UploadProgress, type PickedFile } from "../FileCapture";
import { FormShell } from "../forms";
import { Badge, Card, Field, Input, Loading, Modal, Select, StatusBadge, Textarea } from "../ds";

/**
 * Forms and panels shared by the trip paperwork panel and the transport-document pages.
 * E-Way Bills are RECORDED from the government portal: RaahSetu never generates or validates them.
 */

function useForm<T extends Record<string, string>>(init: T) {
  const [f, setF] = useState(init);
  const set = (k: keyof T) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return [f, set] as const;
}

/** yyyy-mm-dd in local time, for <input type="date">. */
const dateInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const str = (v: string | number | null | undefined) => (v == null ? "" : String(v));
const startOf = (v: string) => new Date(`${v}T00:00:00`).toISOString();
const endOf = (v: string) => new Date(`${v}T23:59:59`).toISOString();

export const PAYMENT_TERMS: Array<[FreightPaymentTerms, string]> = [
  ["PAID", "Paid"],
  ["TO_PAY", "To pay (consignee pays)"],
  ["TO_BE_BILLED", "To be billed"],
];

// ───────────────────────── E-Way Bill ─────────────────────────

type EwbSeed = { orderId: number; tripId: number | null; recipientName?: string; placeOfDelivery?: string; taxableValue?: number | null };

/**
 * Record a new E-Way Bill (with its portal copy) or edit an existing record.
 * Editing changes the details only; files are added separately.
 */
export function EwayBillForm({ seed, existing, onSaved }: { seed?: EwbSeed; existing?: EwayBill; onSaved: (e: EwayBill) => void }) {
  const e = existing;
  const [f, set] = useForm({
    ewbNumber: e?.ewbNumber ?? "",
    documentDate: e ? dateInput(e.documentDate) : dateInput(new Date().toISOString()),
    validFrom: dateInput(e?.validFrom),
    validUntil: dateInput(e?.validUntil),
    supplierName: e?.supplierName ?? "",
    supplierGstin: e?.supplierGstin ?? "",
    recipientName: e?.recipientName ?? seed?.recipientName ?? "",
    recipientGstin: e?.recipientGstin ?? "",
    placeOfDispatch: e?.placeOfDispatch ?? "",
    placeOfDelivery: e?.placeOfDelivery ?? seed?.placeOfDelivery ?? "",
    goodsDescription: e?.goodsDescription ?? "",
    hsnCode: e?.hsnCode ?? "",
    quantity: str(e?.quantity),
    quantityUnit: e?.quantityUnit ?? "",
    taxableValue: str(e ? e.taxableValue : seed?.taxableValue),
    invoiceOrChallanRef: e?.invoiceOrChallanRef ?? "",
    transporterId: e?.transporterId ?? "",
    vehicleNumber: e?.vehicleNumber ?? "",
    transportDocNumber: e?.transportDocNumber ?? "",
    notes: e?.notes ?? "",
  });
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const dateValue = (k: string, v: string) => (k === "documentDate" || k === "validFrom" ? startOf(v) : k === "validUntil" ? endOf(v) : v.trim());

  return (
    <FormShell
      submitLabel={e ? "Save changes" : "Save E-Way Bill"}
      onSubmit={async () => {
        const digits = f.ewbNumber.replace(/\s+/g, "");
        if (!/^\d{12}$/.test(digits)) throw new Error("The E-Way Bill number has 12 digits.");
        if (f.validUntil && f.validUntil < f.documentDate) throw new Error("Valid-until cannot be before the document date.");
        if (f.validFrom && f.validFrom < f.documentDate) throw new Error("Valid-from cannot be before the document date.");
        if (f.validFrom && f.validUntil && f.validUntil < f.validFrom) throw new Error("Valid-until cannot be before valid-from.");
        if (e) {
          // Every field is sent, so clearing one removes it (empty values are stored as blank).
          const body: Record<string, string | null> = {};
          for (const [k, v] of Object.entries(f)) body[k] = v.trim() ? dateValue(k, v) : k === "validFrom" || k === "validUntil" ? null : "";
          onSaved(await api<EwayBill>(`/eway-bills/${e.id}`, { method: "PATCH", body }));
          return;
        }
        const form = new FormData();
        form.set("orderId", String(seed!.orderId));
        if (seed!.tripId) form.set("tripId", String(seed!.tripId));
        for (const [k, v] of Object.entries(f)) if (v.trim()) form.set(k, dateValue(k, v));
        for (const p of files) form.append("file", p.file, p.file.name);
        setProgress(0);
        try {
          onSaved(await uploadWithProgress<EwayBill>("/eway-bills", form, setProgress));
        } finally {
          setProgress(null);
        }
      }}
    >
      <p className="text-sm text-muted">Copy the details from the E-Way Bill generated on the government portal. RaahSetu records it; it does not generate or validate E-Way Bills.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="E-Way Bill number (12 digits)" required>
          <Input required inputMode="numeric" value={f.ewbNumber} onChange={set("ewbNumber")} placeholder="3910 1234 5678" />
        </Field>
        <Field label="Vehicle number on the E-Way Bill">
          <Input value={f.vehicleNumber} onChange={set("vehicleNumber")} autoCapitalize="characters" />
        </Field>
        <Field label="Document date" required>
          <Input type="date" required value={f.documentDate} onChange={set("documentDate")} />
        </Field>
        <Field label="Valid from">
          <Input type="date" value={f.validFrom} onChange={set("validFrom")} />
        </Field>
        <Field label="Valid until">
          <Input type="date" value={f.validUntil} onChange={set("validUntil")} />
        </Field>
        <Field label="Taxable value (₹)">
          <Input type="number" min={0} step="0.01" value={f.taxableValue} onChange={set("taxableValue")} />
        </Field>
        <Field label="Supplier" required>
          <Input required value={f.supplierName} onChange={set("supplierName")} />
        </Field>
        <Field label="Supplier GSTIN">
          <Input value={f.supplierGstin} onChange={set("supplierGstin")} autoCapitalize="characters" maxLength={15} />
        </Field>
        <Field label="Recipient" required>
          <Input required value={f.recipientName} onChange={set("recipientName")} />
        </Field>
        <Field label="Recipient GSTIN">
          <Input value={f.recipientGstin} onChange={set("recipientGstin")} autoCapitalize="characters" maxLength={15} />
        </Field>
        <Field label="Place of dispatch" required>
          <Input required value={f.placeOfDispatch} onChange={set("placeOfDispatch")} />
        </Field>
        <Field label="Place of delivery" required>
          <Input required value={f.placeOfDelivery} onChange={set("placeOfDelivery")} />
        </Field>
        <Field label="Goods description" required className="sm:col-span-2">
          <Input required value={f.goodsDescription} onChange={set("goodsDescription")} />
        </Field>
        <Field label="HSN code">
          <Input inputMode="numeric" value={f.hsnCode} onChange={set("hsnCode")} maxLength={8} />
        </Field>
        <Field label="Invoice / challan no.">
          <Input value={f.invoiceOrChallanRef} onChange={set("invoiceOrChallanRef")} />
        </Field>
        <Field label="Quantity">
          <Input type="number" min={0} step="any" value={f.quantity} onChange={set("quantity")} />
        </Field>
        <Field label="Unit">
          <Input value={f.quantityUnit} onChange={set("quantityUnit")} placeholder="nos, kg, boxes" />
        </Field>
        <Field label="Transporter ID">
          <Input value={f.transporterId} onChange={set("transporterId")} autoCapitalize="characters" maxLength={15} />
        </Field>
        <Field label="Transport document / LR no.">
          <Input value={f.transportDocNumber} onChange={set("transportDocNumber")} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={f.notes} onChange={set("notes")} maxLength={1000} />
        </Field>
      </div>
      {!e && (
        <>
          <FileCapture label="E-Way Bill copy" value={files} onChange={setFiles} max={3} hint="The PDF from the portal, or a photo of the printout" />
          <UploadProgress fraction={progress} />
        </>
      )}
    </FormShell>
  );
}

/** Attach more files (up to 5 in total) to an E-Way Bill that is not cancelled. */
export function EwayBillFilesForm({ ewb, onSaved }: { ewb: EwayBill; onSaved: () => void }) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const room = Math.max(0, 5 - ewb.attachments.length);
  return (
    <FormShell
      submitLabel="Upload files"
      onSubmit={async () => {
        if (!files.length) throw new Error("Choose at least one file.");
        const form = new FormData();
        for (const p of files) form.append("file", p.file, p.file.name);
        setProgress(0);
        try {
          await uploadWithProgress(`/eway-bills/${ewb.id}/files`, form, setProgress);
        } finally {
          setProgress(null);
        }
        onSaved();
      }}
    >
      <FileCapture label="Additional files" value={files} onChange={setFiles} max={Math.min(3, room)} hint={`Supporting pages or a revised printout. ${ewb.attachments.length} of 5 files attached.`} />
      <UploadProgress fraction={progress} />
    </FormShell>
  );
}

// ───────────────────────── Lorry receipt ─────────────────────────

type LrSeed = { orderId: number; tripId: number | null; weightKg?: number };

/** Issue a new LR (missing parts are filled from the order and trip) or edit a draft LR. */
export function LrForm({ seed, existing, onSaved }: { seed?: LrSeed; existing?: LorryReceipt; onSaved: (lr: LorryReceipt) => void }) {
  const l = existing;
  const [f, set] = useForm({
    bookingDate: dateInput(l?.bookingDate),
    consignorName: l?.consignorName ?? "",
    consignorAddress: l?.consignorAddress ?? "",
    consignorGstin: l?.consignorGstin ?? "",
    consigneeName: l?.consigneeName ?? "",
    consigneeAddress: l?.consigneeAddress ?? "",
    consigneeGstin: l?.consigneeGstin ?? "",
    fromPlace: l?.fromPlace ?? "",
    toPlace: l?.toPlace ?? "",
    goodsDescription: l?.goodsDescription ?? "",
    packages: str(l?.packages),
    packageType: l?.packageType ?? "",
    actualWeightKg: str(l?.actualWeightKg),
    chargedWeightKg: str(l?.chargedWeightKg),
    freightAmount: str(l?.freightAmount),
    advanceAmount: str(l?.advanceAmount),
    paymentTerms: (l?.paymentTerms ?? "TO_BE_BILLED") as string,
    declaredValue: str(l?.declaredValue),
    deliveryInstructions: l?.deliveryInstructions ?? "",
  });
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const freight = num(f.freightAmount);
  const advance = num(f.advanceAmount);
  const balance = freight != null ? freight - (advance ?? 0) : null;

  return (
    <FormShell
      submitLabel={l ? "Save changes" : "Issue lorry receipt"}
      onSubmit={async () => {
        if (advance != null && advance > 0 && freight == null) throw new Error("Enter the freight before the advance.");
        if (advance != null && freight != null && advance > freight) throw new Error("The advance cannot be more than the freight.");
        const numbers = { packages: num(f.packages), actualWeightKg: num(f.actualWeightKg), chargedWeightKg: num(f.chargedWeightKg), freightAmount: freight, advanceAmount: advance, declaredValue: num(f.declaredValue) };
        const text = (v: string) => v.trim() || null;
        if (l) {
          const body = {
            ...numbers,
            ...(f.bookingDate ? { bookingDate: startOf(f.bookingDate) } : {}),
            consignorName: f.consignorName.trim(),
            consignorAddress: text(f.consignorAddress),
            consignorGstin: text(f.consignorGstin),
            consigneeName: f.consigneeName.trim(),
            consigneeAddress: text(f.consigneeAddress),
            consigneeGstin: text(f.consigneeGstin),
            fromPlace: f.fromPlace.trim(),
            toPlace: f.toPlace.trim(),
            goodsDescription: f.goodsDescription.trim(),
            packageType: text(f.packageType),
            paymentTerms: f.paymentTerms,
            deliveryInstructions: text(f.deliveryInstructions),
          };
          onSaved(await api<LorryReceipt>(`/lorry-receipts/${l.id}`, { method: "PATCH", body }));
          return;
        }
        onSaved(
          await api<LorryReceipt>("/lorry-receipts", {
            body: {
              orderId: seed!.orderId,
              tripId: seed!.tripId,
              goodsDescription: f.goodsDescription.trim(),
              packages: numbers.packages,
              packageType: text(f.packageType),
              chargedWeightKg: numbers.chargedWeightKg,
              freightAmount: numbers.freightAmount,
              advanceAmount: numbers.advanceAmount,
              paymentTerms: f.paymentTerms,
              consigneeGstin: text(f.consigneeGstin),
              consignorGstin: text(f.consignorGstin),
              deliveryInstructions: text(f.deliveryInstructions),
            },
          }),
        );
      }}
    >
      {!l && <p className="text-sm text-muted">Consignor, consignee, route, weight and declared value are filled from the order; vehicle and driver from the trip. You can correct them on the LR until it is finalized.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {l && (
          <>
            <Field label="Booking date" required>
              <Input type="date" required value={f.bookingDate} onChange={set("bookingDate")} />
            </Field>
            <Field label="Payment terms">
              <Select value={f.paymentTerms} onChange={set("paymentTerms")}>
                {PAYMENT_TERMS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Consignor" required>
              <Input required minLength={2} value={f.consignorName} onChange={set("consignorName")} />
            </Field>
            <Field label="Consignee" required>
              <Input required minLength={2} value={f.consigneeName} onChange={set("consigneeName")} />
            </Field>
            <Field label="Consignor address">
              <Textarea rows={2} value={f.consignorAddress} onChange={set("consignorAddress")} />
            </Field>
            <Field label="Consignee address">
              <Textarea rows={2} value={f.consigneeAddress} onChange={set("consigneeAddress")} />
            </Field>
            <Field label="From" required>
              <Input required minLength={2} value={f.fromPlace} onChange={set("fromPlace")} />
            </Field>
            <Field label="To" required>
              <Input required minLength={2} value={f.toPlace} onChange={set("toPlace")} />
            </Field>
          </>
        )}
        <Field label="Goods description" required className="sm:col-span-2">
          <Input required value={f.goodsDescription} onChange={set("goodsDescription")} />
        </Field>
        <Field label="Packages">
          <Input type="number" min={1} inputMode="numeric" value={f.packages} onChange={set("packages")} />
        </Field>
        <Field label="Package type">
          <Input value={f.packageType} onChange={set("packageType")} placeholder="cartons, bags, pallets" />
        </Field>
        {l && (
          <Field label="Actual weight (kg)">
            <Input type="number" min={0} value={f.actualWeightKg} onChange={set("actualWeightKg")} />
          </Field>
        )}
        <Field label="Charged weight (kg)" hint={seed?.weightKg != null ? `Actual: ${fmtNum(seed.weightKg, "kg")}` : undefined}>
          <Input type="number" min={0} value={f.chargedWeightKg} onChange={set("chargedWeightKg")} />
        </Field>
        <Field label="Freight (₹)">
          <Input type="number" min={0} step="0.01" value={f.freightAmount} onChange={set("freightAmount")} />
        </Field>
        <Field label="Advance received (₹)" hint={balance != null ? `Balance: ₹${balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "Optional"}>
          <Input type="number" min={0} step="0.01" value={f.advanceAmount} onChange={set("advanceAmount")} />
        </Field>
        {!l && (
          <Field label="Payment terms">
            <Select value={f.paymentTerms} onChange={set("paymentTerms")}>
              {PAYMENT_TERMS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </Select>
          </Field>
        )}
        {l && (
          <Field label="Declared value (₹)">
            <Input type="number" min={0} step="0.01" value={f.declaredValue} onChange={set("declaredValue")} />
          </Field>
        )}
        <Field label="Consignor GSTIN">
          <Input value={f.consignorGstin} onChange={set("consignorGstin")} autoCapitalize="characters" maxLength={15} />
        </Field>
        <Field label="Consignee GSTIN">
          <Input value={f.consigneeGstin} onChange={set("consigneeGstin")} autoCapitalize="characters" maxLength={15} />
        </Field>
        <Field label="Delivery instructions" className="sm:col-span-2">
          <Textarea rows={2} value={f.deliveryInstructions} onChange={set("deliveryInstructions")} />
        </Field>
      </div>
    </FormShell>
  );
}

/** Draft / Final / Cancelled badge for a lorry receipt. */
export function LrBadge({ l }: { l: Pick<LorryReceipt, "status" | "finalizedAt"> }) {
  if (l.status === "CANCELLED") return <StatusBadge status="CANCELLED" />;
  return l.finalizedAt ? <Badge color="green">Final</Badge> : <Badge color="gray">Draft</Badge>;
}

// ───────────────────────── Shared: cancel and history ─────────────────────────

/** Cancel a transport document with a required reason. The record is kept, marked cancelled. */
export function CancelDocumentDialog({ open, title, description, path, onClose, onDone }: { open: boolean; title: string; description: string; path: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} title={title} onClose={onClose}>
      {open && (
        <FormShell
          submitLabel="Cancel document"
          onSubmit={async () => {
            if (reason.trim().length < 3) throw new Error("Give a reason of at least 3 characters.");
            await api(path, { method: "POST", body: { reason: reason.trim() } });
            setReason("");
            onDone();
          }}
        >
          <p className="text-sm text-muted">{description}</p>
          <Field label="Reason for cancelling" required>
            <Textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </FormShell>
      )}
    </Modal>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "ewaybill.recorded": "Recorded",
  "ewaybill.updated": "Details edited",
  "ewaybill.cancelled": "Cancelled",
  "file.uploaded": "Files added",
  "lr.created": "Issued (draft)",
  "lr.updated": "Details edited",
  "lr.finalized": "Finalized",
  "lr.cancelled": "Cancelled",
  "lr.pdf_downloaded": "PDF downloaded",
};

/** Audit trail of one transport document, newest first. `version` forces a reload after an action. */
export function DocumentHistory({ path, version }: { path: string; version: number }) {
  const { data, error, loading } = useApi<DocHistoryEvent[]>(`${path}?v=${version}`);
  return (
    <Card title="History" icon={History}>
      {loading && !data ? (
        <Loading label="Loading history…" />
      ) : error ? (
        <p className="text-sm text-danger-700">{error}</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted">No history recorded.</p>
      ) : (
        <ol className="space-y-2 text-sm" aria-label="Document history">
          {data.map((e) => {
            const fields = Array.isArray(e.metadata?.fields) ? (e.metadata!.fields as string[]) : null;
            const reason = typeof e.metadata?.reason === "string" ? e.metadata.reason : null;
            return (
              <li key={e.id} className="border-l-2 border-line pl-3">
                <span className="font-medium text-ink">{ACTION_LABEL[e.action] ?? humanize(e.action)}</span>
                <span className="block text-xs text-muted">
                  {fmtDateTime(e.createdAt)} · {e.userName ?? "Unknown user"}
                  {fields?.length ? ` · ${fields.map(humanize).join(", ")}` : ""}
                </span>
                {reason && <span className="block text-xs text-ink">Reason: {reason}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
