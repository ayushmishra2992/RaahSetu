"use client";

import { useState } from "react";
import { DateTimeInput, FormShell } from "@/components/forms";
import { Alert, Field, Input, Select, Textarea } from "@/components/ds";
import { api } from "@/lib/api";
import type { Location, Order } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { orderBody, validateOrder, type OrderDraft, type OrderErrors } from "./validate";

function draftFrom(o?: Order): OrderDraft {
  return {
    customerName: o?.customerName ?? "",
    customerPhone: o?.customerPhone ?? "",
    pickupLocationId: o?.pickupLocationId?.toString() ?? "",
    dropLocationId: o?.dropLocationId?.toString() ?? "",
    weightKg: o?.weightKg?.toString() ?? "",
    priority: o?.priority ?? "NORMAL",
    serviceMinutes: o?.serviceMinutes?.toString() ?? "20",
    notes: o?.notes ?? "",
    declaredValue: o?.declaredValue?.toString() ?? "",
    readyAt: o?.readyAt ?? null,
    windowStart: o?.windowStart ?? null,
    windowEnd: o?.windowEnd ?? null,
  };
}

/** Create (POST /orders) or edit a PENDING order (PATCH /orders/:id). */
export function OrderForm({ order, onSaved }: { order?: Order; onSaved: (id: number) => void }) {
  const locations = useApi<Location[]>("/locations");
  const [f, setF] = useState<OrderDraft>(() => draftFrom(order));
  const [errors, setErrors] = useState<OrderErrors>({});
  const set = <K extends keyof OrderDraft>(k: K, v: OrderDraft[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const text = (k: keyof OrderDraft) => (e: { target: { value: string } }) => set(k, e.target.value);
  const locs = locations.data ?? [];

  return (
    <FormShell
      submitLabel={order ? "Save changes" : "Create order"}
      onSubmit={async () => {
        const e = validateOrder(f);
        setErrors(e);
        const n = Object.keys(e).length;
        if (n) throw new Error(`Fix ${n} highlighted field${n === 1 ? "" : "s"} and try again.`);
        const saved = await api<{ id: number }>(order ? `/orders/${order.id}` : "/orders", { method: order ? "PATCH" : "POST", body: orderBody(f) });
        onSaved(saved?.id ?? order?.id ?? 0);
      }}
    >
      {!locations.loading && locs.length < 2 && <Alert kind="warning">Add at least two locations first (Locations &amp; Roads).</Alert>}
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="sr-only">Customer</legend>
        <Field label="Customer" required error={errors.customerName}>
          <Input required value={f.customerName} onChange={text("customerName")} autoComplete="organization" />
        </Field>
        <Field label="Customer phone" error={errors.customerPhone}>
          <Input type="tel" value={f.customerPhone} onChange={text("customerPhone")} placeholder="+91 98xxxxxxxx" />
        </Field>
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium text-ink">Route and load</legend>
        <Field label="Pickup" required error={errors.pickupLocationId}>
          <Select required value={f.pickupLocationId} onChange={text("pickupLocationId")}>
            <option value="">Select…</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Drop" required error={errors.dropLocationId}>
          <Select required value={f.dropLocationId} onChange={text("dropLocationId")}>
            <option value="">Select…</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Weight (kg)" required error={errors.weightKg}>
          <Input type="number" min={1} max={100000} step={1} required value={f.weightKg} onChange={text("weightKg")} />
        </Field>
        <Field label="Priority" hint="Urgent orders carry the highest unserved penalty in OptiRoute">
          <Select value={f.priority} onChange={text("priority")}>
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </Field>
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium text-ink">Schedule</legend>
        <Field label="Goods ready at" hint="Optional">
          <DateTimeInput value={f.readyAt} onChange={(v) => set("readyAt", v)} />
        </Field>
        <Field label="Service time (min)" error={errors.serviceMinutes}>
          <Input type="number" min={0} max={600} value={f.serviceMinutes} onChange={text("serviceMinutes")} />
        </Field>
        <Field label="Delivery window start">
          <DateTimeInput value={f.windowStart} onChange={(v) => set("windowStart", v)} />
        </Field>
        <Field label="Delivery window end" hint="A hard constraint in OptiRoute by default" error={errors.windowEnd}>
          <DateTimeInput value={f.windowEnd} onChange={(v) => set("windowEnd", v)} />
        </Field>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Declared value (₹)" error={errors.declaredValue}>
          <Input type="number" min={0} value={f.declaredValue} onChange={text("declaredValue")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes" error={errors.notes}>
            <Textarea value={f.notes} onChange={text("notes")} maxLength={1000} />
          </Field>
        </div>
      </div>
    </FormShell>
  );
}
