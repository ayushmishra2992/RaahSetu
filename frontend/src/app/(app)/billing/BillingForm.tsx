"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormShell } from "@/components/forms";
import { Button, Field, IconButton, Input, Select, Textarea, cx } from "@/components/ds";
import { api } from "@/lib/api";
import { computeTotals, hasErrors, validateBilling, type BillingErrors, type BillingKind, type DraftItem } from "@/lib/billing";
import { fmtAmount } from "@/lib/format";
import type { BillingDoc, Trip } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** Calendar date from a stored timestamp, in local time. */
function localDate(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function BillingForm({ doc, presetTripId, onSaved }: { doc?: BillingDoc; presetTripId?: string; onSaved: (id: number) => void }) {
  const trips = useApi<Trip[]>("/trips?status=COMPLETED");
  const [kind, setKind] = useState<BillingKind>(doc?.kind ?? "INVOICE");
  const [f, setF] = useState({
    tripId: doc?.tripId?.toString() ?? presetTripId ?? "",
    customerName: doc?.customerName ?? "",
    customerGstin: doc?.customerGstin ?? "",
    customerAddress: doc?.customerAddress ?? "",
    taxRatePercent: doc?.taxRatePercent?.toString() ?? "18",
    dueDate: doc?.dueDate ? localDate(doc.dueDate) : "",
    notes: doc?.notes ?? "",
    reasonForTransport: doc?.reasonForTransport ?? "",
    referenceDocuments: doc?.referenceDocuments ?? "",
  });
  const [items, setItems] = useState<DraftItem[]>(
    doc?.items?.map((i) => ({ description: i.description, hsnCode: i.hsnCode ?? "", quantity: String(i.quantity), unit: i.unit, rate: String(i.rate) })) ?? [{ description: "Freight charges", quantity: "1", unit: "trip", rate: "" }],
  );
  const [errors, setErrors] = useState<BillingErrors>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setItem = (idx: number, patch: Partial<DraftItem>) => setItems((s) => s.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const preview = computeTotals(
    items.map((i) => ({ quantity: Number(i.quantity || 0), rate: Number(i.rate || 0) })),
    Number(f.taxRatePercent || 0),
    kind,
  );
  // A trip that already finished is the usual source of an invoice; keep the current one selectable when editing.
  const tripOptions = [...(trips.data ?? [])];
  if (doc?.trip && !tripOptions.some((t) => t.id === doc.trip!.id)) tripOptions.unshift({ id: doc.trip.id, tripNumber: doc.trip.tripNumber } as Trip);

  return (
    <FormShell
      submitLabel={doc ? "Save draft" : "Create draft"}
      onSubmit={async () => {
        const e = validateBilling({ ...f, kind }, items);
        setErrors(e);
        if (hasErrors(e)) throw new Error("Fix the highlighted fields and try again.");
        const body = {
          ...(doc ? {} : { kind }),
          tripId: f.tripId ? Number(f.tripId) : null,
          customerName: f.customerName.trim(),
          customerGstin: f.customerGstin.trim().toUpperCase() || null,
          customerAddress: f.customerAddress.trim() || null,
          taxRatePercent: kind === "INVOICE" ? Number(f.taxRatePercent || 0) : 0,
          dueDate: f.dueDate ? new Date(`${f.dueDate}T23:59:59`).toISOString() : null,
          notes: f.notes.trim() || null,
          reasonForTransport: kind === "DELIVERY_CHALLAN" ? f.reasonForTransport.trim() || null : null,
          referenceDocuments: f.referenceDocuments.trim() || null,
          items: items.map((i) => ({ description: i.description.trim(), hsnCode: i.hsnCode?.trim() || null, quantity: Number(i.quantity), unit: i.unit.trim() || "nos", rate: Number(i.rate || 0) })),
        };
        const saved = await api<{ id: number }>(doc ? `/billing/${doc.id}` : "/billing", { method: doc ? "PUT" : "POST", body });
        onSaved(saved.id);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!doc && (
          <Field label="Document">
            <Select value={kind} onChange={(e) => setKind(e.target.value as BillingKind)}>
              <option value="INVOICE">Tax invoice</option>
              <option value="DELIVERY_CHALLAN">Delivery challan</option>
            </Select>
          </Field>
        )}
        <Field label="Trip (optional)" hint="Completed trips">
          <Select value={f.tripId} onChange={set("tripId")}>
            <option value="">None</option>
            {tripOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tripNumber}
                {t.vehicle ? ` · ${t.vehicle.registrationNumber}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Customer" required error={errors.customerName}>
          <Input required value={f.customerName} onChange={set("customerName")} maxLength={120} />
        </Field>
        <Field label="Customer GSTIN" hint="Optional; 15 characters" error={errors.customerGstin}>
          <Input maxLength={15} value={f.customerGstin} onChange={(e) => setF((s) => ({ ...s, customerGstin: e.target.value.toUpperCase() }))} className="uppercase" />
        </Field>
        <Field label="Customer address">
          <Input value={f.customerAddress} onChange={set("customerAddress")} maxLength={300} />
        </Field>
        {kind === "INVOICE" && (
          <Field label="GST rate (%)" hint="One rate on the subtotal" error={errors.taxRatePercent}>
            <Input type="number" min={0} max={28} step="0.5" value={f.taxRatePercent} onChange={set("taxRatePercent")} />
          </Field>
        )}
        <Field label="Due date">
          <Input type="date" value={f.dueDate} onChange={set("dueDate")} />
        </Field>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-ink">Line items</legend>
        {errors.items && <p className="mb-2 text-xs font-medium text-danger-600">{errors.items}</p>}
        <div className="hidden grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_7rem_6.5rem_2.25rem] gap-2 px-0.5 pb-1 text-xs text-muted sm:grid">
          <span>Description</span>
          <span>HSN/SAC</span>
          <span>Quantity</span>
          <span>Unit</span>
          <span>Rate (₹)</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        <ol className="space-y-2">
          {items.map((it, idx) => {
            const rowError = errors.itemRows?.[idx];
            return (
              <li key={idx} className={cx("rounded-md sm:rounded-none", "max-sm:border max-sm:border-line max-sm:p-3")}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_7rem_6.5rem_2.25rem] sm:items-center">
                  <Input aria-label={`Line ${idx + 1} description`} aria-invalid={!!rowError || undefined} className="col-span-2 sm:col-span-1" placeholder="Description" value={it.description} maxLength={200} onChange={(e) => setItem(idx, { description: e.target.value })} />
                  <Input aria-label={`Line ${idx + 1} HSN/SAC code`} inputMode="numeric" placeholder="HSN" value={it.hsnCode ?? ""} maxLength={8} onChange={(e) => setItem(idx, { hsnCode: e.target.value })} />
                  <Input aria-label={`Line ${idx + 1} quantity`} type="number" step="any" min={0.01} placeholder="Qty" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} />
                  <Input aria-label={`Line ${idx + 1} unit`} placeholder="Unit" value={it.unit} maxLength={20} onChange={(e) => setItem(idx, { unit: e.target.value })} />
                  <Input aria-label={`Line ${idx + 1} rate`} type="number" step="any" min={0} placeholder="Rate" value={it.rate} onChange={(e) => setItem(idx, { rate: e.target.value })} />
                  <span className="tabular self-center text-right text-sm text-ink">{fmtAmount(preview.amounts[idx])}</span>
                  <IconButton icon={Trash2} label={`Remove line ${idx + 1}`} size="sm" disabled={items.length === 1} onClick={() => setItems((s) => s.filter((_, i) => i !== idx))} className="justify-self-end" />
                </div>
                {rowError && <p className="mt-1 text-xs font-medium text-danger-600">Line {idx + 1}: {rowError}</p>}
              </li>
            );
          })}
        </ol>
        <Button variant="ghost" size="sm" icon={Plus} className="mt-2" disabled={items.length >= 50} onClick={() => setItems((s) => [...s, { description: "", quantity: "1", unit: "nos", rate: "" }])}>
          Add line
        </Button>
        <dl className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="tabular">{fmtAmount(preview.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{kind === "INVOICE" ? `GST @ ${preview.taxRatePercent}%` : "Tax (challan)"}</dt>
            <dd className="tabular">{fmtAmount(preview.taxAmount)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{fmtAmount(preview.total)}</dd>
          </div>
          <p className="text-xs text-muted">Preview. The server recalculates and stores the final amounts.</p>
        </dl>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {kind === "DELIVERY_CHALLAN" && (
          <Field label="Reason for transport" hint="e.g. Supply, job work, supply on approval">
            <Input value={f.reasonForTransport} onChange={set("reasonForTransport")} maxLength={200} />
          </Field>
        )}
        <Field label="Reference documents" hint="PO, E-Way Bill or LR numbers">
          <Input value={f.referenceDocuments} onChange={set("referenceDocuments")} maxLength={300} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={f.notes} onChange={set("notes")} maxLength={1000} />
      </Field>
    </FormShell>
  );
}
