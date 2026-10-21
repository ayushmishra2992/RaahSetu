"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DateTimeInput, FormShell } from "@/components/forms";
import { Alert, Button, ConfirmButton, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtNum, humanize } from "@/lib/format";
import type { Location, Order } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function OrderForm({ onSaved }: { onSaved: () => void }) {
  const locations = useApi<Location[]>("/locations");
  const [f, setF] = useState({ customerName: "", customerPhone: "", pickupLocationId: "", dropLocationId: "", weightKg: "", priority: "NORMAL", serviceMinutes: "20", notes: "", declaredValue: "" });
  const [win, setWin] = useState<{ readyAt: string | null; windowStart: string | null; windowEnd: string | null }>({ readyAt: null, windowStart: null, windowEnd: null });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const locs = locations.data ?? [];
  return (
    <FormShell submitLabel="Create order" onSubmit={async () => {
      await api("/orders", { body: { ...f, customerPhone: f.customerPhone || null, notes: f.notes || null, pickupLocationId: Number(f.pickupLocationId), dropLocationId: Number(f.dropLocationId), weightKg: Number(f.weightKg), serviceMinutes: Number(f.serviceMinutes), declaredValue: f.declaredValue ? Number(f.declaredValue) : null, ...win } });
      onSaved();
    }}>
      {locs.length < 2 && <Alert kind="warning">Add at least two locations first (Locations & Roads).</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer"><Input required value={f.customerName} onChange={set("customerName")} /></Field>
        <Field label="Customer phone"><Input value={f.customerPhone} onChange={set("customerPhone")} /></Field>
        <Field label="Pickup"><Select required value={f.pickupLocationId} onChange={set("pickupLocationId")}><option value="">Select…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Drop"><Select required value={f.dropLocationId} onChange={set("dropLocationId")}><option value="">Select…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Weight (kg)"><Input type="number" min={1} required value={f.weightKg} onChange={set("weightKg")} /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={set("priority")}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Goods ready at (optional)"><DateTimeInput value={win.readyAt} onChange={(v) => setWin((w) => ({ ...w, readyAt: v }))} /></Field>
        <Field label="Service time (min)"><Input type="number" min={0} value={f.serviceMinutes} onChange={set("serviceMinutes")} /></Field>
        <Field label="Delivery window start"><DateTimeInput value={win.windowStart} onChange={(v) => setWin((w) => ({ ...w, windowStart: v }))} /></Field>
        <Field label="Delivery window end" hint="Hard constraint by default in OptiRoute"><DateTimeInput value={win.windowEnd} onChange={(v) => setWin((w) => ({ ...w, windowEnd: v }))} /></Field>
        <Field label="Declared value (₹)"><Input type="number" min={0} value={f.declaredValue} onChange={set("declaredValue")} /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea value={f.notes} onChange={set("notes")} /></Field></div>
      </div>
    </FormShell>
  );
}

export default function OrdersPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Order[]>(`/orders${status ? `?status=${status}` : ""}`);
  const write = can("orders:write");

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Pickup → delivery jobs. Pending orders are planned by OptiRoute or assigned manually to a trip."
        actions={<>
          {can("optimize:run") && <Link href="/optiroute" className="rounded-md border border-line bg-white px-3.5 py-2 text-sm font-medium hover:bg-canvas">Plan with OptiRoute</Link>}
          {write && <Button onClick={() => setCreating(true)}>New order</Button>}
        </>}
      />
      {msg && <div className="mb-3"><Alert>{msg}</Alert></div>}
      <div className="mb-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[200px]">
          <option value="">All statuses</option>
          {["PENDING", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
      </div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <Table head={["Order", "Customer", "Route", "Weight", "Priority", "Delivery window", "Status", ""]} empty={data?.length === 0}>
          {data?.map((o) => (
            <tr key={o.id}>
              <Td className="font-medium">{o.orderNumber}</Td>
              <Td>{o.customerName}</Td>
              <Td className="text-xs">{o.pickupLocation?.name} → {o.dropLocation?.name}</Td>
              <Td className="tabular">{fmtNum(o.weightKg, "kg")}</Td>
              <Td><StatusBadge status={o.priority} /></Td>
              <Td className="text-xs">{o.windowStart || o.windowEnd ? `${fmtDateTime(o.windowStart)} – ${fmtDateTime(o.windowEnd)}` : "Any time"}</Td>
              <Td><StatusBadge status={o.status} /></Td>
              <Td>{write && o.status === "PENDING" && (
                <ConfirmButton confirmLabel="Cancel order" onConfirm={async () => { try { await api(`/orders/${o.id}/cancel`, { method: "POST" }); reload(); } catch (e) { setMsg(errorMessage(e)); } }}>Cancel</ConfirmButton>
              )}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={creating} title="New order" onClose={() => setCreating(false)} wide>
        <OrderForm onSaved={() => { setCreating(false); reload(); }} />
      </Modal>
    </div>
  );
}
