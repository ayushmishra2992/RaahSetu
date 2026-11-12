"use client";

import { useState } from "react";
import { FormShell } from "@/components/forms";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import type { BillingDoc, Trip } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface Item {
  description: string;
  quantity: string;
  unit: string;
  rate: string;
}

export function BillingForm({ doc, presetTripId, onSaved }: { doc?: BillingDoc; presetTripId?: string; onSaved: (id: number) => void }) {
  const trips = useApi<Trip[]>("/trips");
  const [kind, setKind] = useState<"INVOICE" | "DELIVERY_CHALLAN">(doc?.kind ?? "INVOICE");
  const [f, setF] = useState({
    tripId: doc?.tripId?.toString() ?? presetTripId ?? "",
    customerName: doc?.customerName ?? "",
    customerGstin: doc?.customerGstin ?? "",
    customerAddress: doc?.customerAddress ?? "",
    taxRatePercent: doc?.taxRatePercent?.toString() ?? "18",
    dueDate: doc?.dueDate?.slice(0, 10) ?? "",
    notes: doc?.notes ?? "",
  });
  const [items, setItems] = useState<Item[]>(doc?.items?.map((i) => ({ description: i.description, quantity: String(i.quantity), unit: i.unit, rate: String(i.rate) })) ?? [{ description: "Freight charges", quantity: "1", unit: "trip", rate: "" }]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const subtotal = items.reduce((a, i) => a + Number(i.quantity || 0) * Number(i.rate || 0), 0);
  const tax = kind === "INVOICE" ? (subtotal * Number(f.taxRatePercent || 0)) / 100 : 0;

  return (
    <FormShell submitLabel={doc ? "Save draft" : "Create draft"} onSubmit={async () => {
      const body = {
        ...(doc ? {} : { kind }),
        tripId: f.tripId ? Number(f.tripId) : null,
        customerName: f.customerName,
        customerGstin: f.customerGstin || null,
        customerAddress: f.customerAddress || null,
        taxRatePercent: Number(f.taxRatePercent || 0),
        dueDate: f.dueDate ? new Date(`${f.dueDate}T23:59:59`).toISOString() : null,
        notes: f.notes || null,
        items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit: i.unit || "nos", rate: Number(i.rate || 0) })),
      };
      const saved = await api<{ id: number }>(doc ? `/billing/${doc.id}` : "/billing", { method: doc ? "PUT" : "POST", body });
      onSaved(saved.id);
    }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {!doc && <Field label="Document"><Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="INVOICE">Tax invoice</option><option value="DELIVERY_CHALLAN">Delivery challan</option></Select></Field>}
        <Field label="Trip (optional)"><Select value={f.tripId} onChange={set("tripId")}><option value="">— none —</option>{trips.data?.map((t) => <option key={t.id} value={t.id}>{t.tripNumber} · {t.vehicle.registrationNumber}</option>)}</Select></Field>
        <Field label="Customer"><Input required value={f.customerName} onChange={set("customerName")} /></Field>
        <Field label="Customer GSTIN"><Input maxLength={15} value={f.customerGstin} onChange={set("customerGstin")} /></Field>
        <Field label="Customer address"><Input value={f.customerAddress} onChange={set("customerAddress")} /></Field>
        {kind === "INVOICE" && <Field label="GST rate (%)" hint="Single rate on subtotal"><Input type="number" min={0} max={28} step="0.5" value={f.taxRatePercent} onChange={set("taxRatePercent")} /></Field>}
        <Field label="Due date"><Input type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Line items</p>
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_80px_110px_auto] gap-2">
              <Input required placeholder="Description" value={it.description} onChange={(e) => setItems((s) => s.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
              <Input required type="number" step="any" min={0.01} placeholder="Qty" value={it.quantity} onChange={(e) => setItems((s) => s.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))} />
              <Input placeholder="Unit" value={it.unit} onChange={(e) => setItems((s) => s.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))} />
              <Input type="number" step="any" min={0} placeholder="Rate ₹" value={it.rate} onChange={(e) => setItems((s) => s.map((x, i) => (i === idx ? { ...x, rate: e.target.value } : x)))} />
              <Button type="button" variant="ghost" disabled={items.length === 1} onClick={() => setItems((s) => s.filter((_, i) => i !== idx))}>Remove</Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="ghost" className="mt-2" onClick={() => setItems((s) => [...s, { description: "", quantity: "1", unit: "nos", rate: "" }])}>+ Add line</Button>
        <p className="mt-2 text-right text-sm">Subtotal {fmtMoney(subtotal)} · Tax {fmtMoney(tax)} · <span className="font-semibold">Total {fmtMoney(subtotal + tax)}</span></p>
      </div>
      <Field label="Notes"><Textarea value={f.notes} onChange={set("notes")} /></Field>
    </FormShell>
  );
}
