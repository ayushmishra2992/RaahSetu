"use client";

import { Download, FilePlus2, FileSignature, FileText, FolderArchive, Paperclip, ReceiptText, ShieldAlert, ShieldCheck, Truck } from "lucide-react";
import { useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { PodStatus, TripDocuments as Docs } from "@/lib/types";
import { openAttachment, PHOTO_MIME, uploadWithProgress } from "@/lib/upload";
import { useApi } from "@/lib/useApi";
import { useAuth } from "./AuthProvider";
import { FileCapture, UploadProgress, type PickedFile } from "./FileCapture";
import { FormShell } from "./forms";
import { SignaturePad } from "./SignaturePad";
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, Select, StatusBadge, Textarea, useToast } from "./ds";

type OrderDocs = Docs["orders"][number];

/** Consolidated paperwork for one trip. Everything shown is filtered by the API to what the user may see. */
export function TripDocuments({ tripId, tripStatus, onChanged }: { tripId: number; tripStatus: string; onChanged: () => void }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<Docs>(can("shipments:read") ? `/trips/${tripId}/documents` : null);
  if (!can("shipments:read")) return null;
  if (loading) return <Loading label="Loading trip documents…" />;
  if (error || !data) return <Alert title="Couldn't load trip documents">{error}</Alert>;
  const refresh = () => {
    reload();
    onChanged();
  };
  const c = data.compliance;

  return (
    <section aria-labelledby="trip-docs" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trip-docs" className="text-base font-semibold text-ink">
          Trip documents
        </h2>
        <a href={`/api/trips/${tripId}/documents/pack`} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas" download>
          <FolderArchive size={15} aria-hidden /> Download document pack (ZIP)
        </a>
      </div>

      <Card title="Compliance for this trip" icon={c.eligible ? ShieldCheck : ShieldAlert} actions={<StatusBadge status={c.eligible ? "COMPLIANT" : "EXPIRED"} label={c.eligible ? "Clear to dispatch" : "Blocked"} />}>
        <div className="space-y-2 text-sm">
          {c.blockers.length > 0 && (
            <Alert title="Must be fixed before dispatch">
              <ul className="list-disc pl-4">{c.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </Alert>
          )}
          {c.warnings.length > 0 && (
            <Alert kind="warning" title="Warnings">
              <ul className="list-disc pl-4">{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Alert>
          )}
          {!c.blockers.length && !c.warnings.length && <p className="text-muted">Vehicle, driver and shipment documents are in order.</p>}
          <p className="text-xs text-muted">
            Vehicle {data.trip.vehicle}: <StatusBadge status={c.vehicle.overall} /> · Driver {data.trip.driver}: <StatusBadge status={c.driver.overall} />
          </p>
        </div>
      </Card>

      {data.orders.map((o) => (
        <OrderPanel key={o.stopId} o={o} tripId={tripId} tripStatus={tripStatus} shipment={c.shipments.find((s) => s.orderId === o.id)?.ewayBill} onChanged={refresh} />
      ))}

      {data.billing && data.billing.length > 0 && (
        <Card title="Invoices & challans" icon={ReceiptText}>
          <ul className="divide-y divide-line text-sm">
            {data.billing.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium text-ink">{b.number}</span> <span className="text-muted">· {humanize(b.kind)}{b.kind === "INVOICE" ? ` · ${fmtMoney(b.total)}` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={b.status} />
                  <a className="text-xs font-medium text-brand-700 hover:underline" href={`/api/billing/${b.id}/pdf`} target="_blank" rel="noopener">
                    PDF
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function OrderPanel({ o, tripId, tripStatus, shipment, onChanged }: { o: OrderDocs; tripId: number; tripStatus: string; shipment?: Docs["compliance"]["shipments"][number]["ewayBill"]; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [dialog, setDialog] = useState<"ewb" | "lr" | "pod" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // A POD is recorded at a drop that is still open (or completed without one). Skipped stops
  // (pickup skipped / trip cancelled) are not offered: the order has gone back to planning.
  const canPod = can("pod:write") && (tripStatus === "IN_TRANSIT" || tripStatus === "COMPLETED") && !o.pod && ["PENDING", "ARRIVED", "COMPLETED"].includes(o.stopStatus);
  const open = (id: number) => openAttachment(id).catch((e) => setErr(errorMessage(e)));

  return (
    <Card
      title={`${o.orderNumber} · ${o.customerName}`}
      icon={Truck}
      description={`Deliver to ${o.dropLocation} · ${fmtNum(o.weightKg, "kg")}${o.declaredValue != null ? ` · declared ${fmtMoney(o.declaredValue)}` : ""}`}
      actions={<StatusBadge status={o.stopStatus} />}
    >
      {err && <Alert className="mb-3">{err}</Alert>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* E-Way Bill */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <FileText size={15} aria-hidden /> E-Way Bill
          </h3>
          {shipment && shipment.state !== "COMPLIANT" && shipment.state !== "NOT_APPLICABLE" && <p className={shipment.blocking ? "text-xs text-danger-700" : "text-xs text-warning-700"}>{shipment.message}</p>}
          {shipment?.state === "NOT_APPLICABLE" && !o.ewayBills.length && <p className="text-xs text-muted">{shipment.message}</p>}
          {o.ewayBills.map((e) => (
            <div key={e.id} className="rounded-md border border-line p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium tabular">{e.ewbNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}</span>
                <StatusBadge status={e.status === "CANCELLED" ? "CANCELLED" : e.expired ? "EXPIRED" : "VALID"} />
              </div>
              <p className="text-xs text-muted">
                Valid until {fmtDateTime(e.validUntil)} · vehicle {e.vehicleNumber ?? "—"}
              </p>
              {e.attachments.map((a) => (
                <Button key={a.id} size="sm" variant="ghost" icon={Paperclip} onClick={() => void open(a.id)}>
                  {a.fileName}
                </Button>
              ))}
            </div>
          ))}
          {can("shipments:write") && (
            <Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => setDialog("ewb")}>
              Record E-Way Bill
            </Button>
          )}
          <p className="text-[11px] text-muted">Recorded from the government portal; RaahSetu does not generate E-Way Bills.</p>
        </div>

        {/* Lorry receipt */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <ReceiptText size={15} aria-hidden /> Lorry receipt (bilty)
          </h3>
          {o.lorryReceipts.length === 0 && <p className="text-xs text-muted">No LR issued yet.</p>}
          {o.lorryReceipts.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border border-line p-2 text-sm">
              <span className="font-medium">{l.lrNumber}</span>
              <span className="flex items-center gap-2">
                <StatusBadge status={l.status} />
                <a className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" href={`/api/lorry-receipts/${l.id}/pdf`} target="_blank" rel="noopener">
                  <Download size={12} aria-hidden /> PDF
                </a>
              </span>
            </div>
          ))}
          {can("shipments:write") && (
            <Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => setDialog("lr")}>
              Issue LR
            </Button>
          )}
        </div>

        {/* POD */}
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <FileSignature size={15} aria-hidden /> Proof of delivery
          </h3>
          {o.pod ? (
            <div className="rounded-md border border-line p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{o.pod.receiverName}</span>
                <StatusBadge status={o.pod.status} />
              </div>
              <p className="text-xs text-muted">
                {fmtDateTime(o.pod.deliveredAt)}
                {o.pod.deliveredQuantity != null && ` · ${fmtNum(o.pod.deliveredQuantity, "kg")} delivered`}
              </p>
              {(o.pod.shortageDetails || o.pod.damageDetails) && <p className="text-xs text-warning-700">{[o.pod.shortageDetails, o.pod.damageDetails].filter(Boolean).join(" · ")}</p>}
              <div className="mt-1 flex flex-wrap gap-1">
                <a className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" href={`/api/pods/${o.pod.id}/pdf`} target="_blank" rel="noopener">
                  <Download size={12} aria-hidden /> POD PDF
                </a>
                <Badge color="gray">{o.pod.attachments.filter((a) => a.role === "PHOTO").length} photo(s)</Badge>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">{tripStatus === "IN_TRANSIT" ? "Record when the goods are handed over." : tripStatus === "COMPLETED" ? "No POD was recorded." : "Available once the trip is in transit."}</p>
          )}
          {canPod && (
            <Button size="sm" icon={FileSignature} onClick={() => setDialog("pod")}>
              Record delivery
            </Button>
          )}
        </div>
      </div>

      <Modal open={dialog === "ewb"} title={`E-Way Bill · ${o.orderNumber}`} onClose={() => setDialog(null)} wide>
        {dialog === "ewb" && <EwayBillForm o={o} tripId={tripId} onSaved={() => { setDialog(null); toast.success("E-Way Bill recorded"); onChanged(); }} />}
      </Modal>
      <Modal open={dialog === "lr"} title={`Lorry receipt · ${o.orderNumber}`} onClose={() => setDialog(null)} wide>
        {dialog === "lr" && <LrForm o={o} tripId={tripId} onSaved={() => { setDialog(null); toast.success("Lorry receipt issued"); onChanged(); }} />}
      </Modal>
      <Modal open={dialog === "pod"} title={`Proof of delivery · ${o.orderNumber}`} onClose={() => setDialog(null)} wide>
        {dialog === "pod" && <PodForm o={o} tripId={tripId} onSaved={(message) => { setDialog(null); toast.success(message ?? "Delivery recorded"); onChanged(); }} />}
      </Modal>
    </Card>
  );
}

function useForm<T extends Record<string, string>>(init: T) {
  const [f, setF] = useState(init);
  const set = (k: keyof T) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return [f, set, setF] as const;
}

function EwayBillForm({ o, tripId, onSaved }: { o: OrderDocs; tripId: number; onSaved: () => void }) {
  const [f, set] = useForm({
    ewbNumber: "",
    documentDate: new Date().toISOString().slice(0, 10),
    validUntil: "",
    supplierName: "",
    supplierGstin: "",
    recipientName: o.customerName,
    recipientGstin: "",
    placeOfDispatch: "",
    placeOfDelivery: o.dropLocation,
    goodsDescription: "",
    hsnCode: "",
    quantity: "",
    quantityUnit: "",
    taxableValue: o.declaredValue != null ? String(o.declaredValue) : "",
    invoiceOrChallanRef: "",
    transporterId: "",
    vehicleNumber: "",
    transportDocNumber: "",
  });
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  return (
    <FormShell
      submitLabel="Save E-Way Bill"
      onSubmit={async () => {
        const digits = f.ewbNumber.replace(/\s+/g, "");
        if (!/^\d{12}$/.test(digits)) throw new Error("The E-Way Bill number has 12 digits.");
        if (f.validUntil && f.validUntil < f.documentDate) throw new Error("Valid-until cannot be before the document date.");
        const form = new FormData();
        form.set("orderId", String(o.id));
        form.set("tripId", String(tripId));
        for (const [k, v] of Object.entries(f)) if (v.trim()) form.set(k, k === "documentDate" ? new Date(`${v}T00:00:00`).toISOString() : k === "validUntil" ? new Date(`${v}T23:59:59`).toISOString() : v.trim());
        for (const p of files) form.append("file", p.file, p.file.name);
        setProgress(0);
        try {
          await uploadWithProgress("/eway-bills", form, setProgress);
        } finally {
          setProgress(null);
        }
        onSaved();
      }}
    >
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
        <Field label="Valid until">
          <Input type="date" value={f.validUntil} onChange={set("validUntil")} />
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
        <Field label="Taxable value (₹)">
          <Input type="number" min={0} step="0.01" value={f.taxableValue} onChange={set("taxableValue")} />
        </Field>
        <Field label="Quantity">
          <Input type="number" min={0} step="any" value={f.quantity} onChange={set("quantity")} />
        </Field>
        <Field label="Unit">
          <Input value={f.quantityUnit} onChange={set("quantityUnit")} placeholder="nos, kg, boxes" />
        </Field>
        <Field label="Invoice / challan no.">
          <Input value={f.invoiceOrChallanRef} onChange={set("invoiceOrChallanRef")} />
        </Field>
        <Field label="Transporter ID">
          <Input value={f.transporterId} onChange={set("transporterId")} autoCapitalize="characters" maxLength={15} />
        </Field>
        <Field label="Transport document / LR no.">
          <Input value={f.transportDocNumber} onChange={set("transportDocNumber")} />
        </Field>
      </div>
      <FileCapture label="E-Way Bill copy" value={files} onChange={setFiles} max={3} hint="The PDF from the portal, or a photo of the printout" />
      <UploadProgress fraction={progress} />
    </FormShell>
  );
}

function LrForm({ o, tripId, onSaved }: { o: OrderDocs; tripId: number; onSaved: () => void }) {
  const [f, set] = useForm({ goodsDescription: "", packages: "", packageType: "", chargedWeightKg: "", freightAmount: "", paymentTerms: "TO_BE_BILLED", consigneeGstin: "", consignorGstin: "", deliveryInstructions: "" });
  return (
    <FormShell
      submitLabel="Issue lorry receipt"
      onSubmit={async () => {
        const num = (v: string) => (v ? Number(v) : null);
        await api("/lorry-receipts", {
          body: {
            orderId: o.id,
            tripId,
            goodsDescription: f.goodsDescription,
            packages: num(f.packages),
            packageType: f.packageType || null,
            chargedWeightKg: num(f.chargedWeightKg),
            freightAmount: num(f.freightAmount),
            paymentTerms: f.paymentTerms,
            consigneeGstin: f.consigneeGstin || null,
            consignorGstin: f.consignorGstin || null,
            deliveryInstructions: f.deliveryInstructions || null,
          },
        });
        onSaved();
      }}
    >
      <p className="text-sm text-muted">Consignor, consignee, route, weight and declared value are filled from the order; vehicle and driver from the trip.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Goods description" required className="sm:col-span-2">
          <Input required value={f.goodsDescription} onChange={set("goodsDescription")} />
        </Field>
        <Field label="Packages">
          <Input type="number" min={1} inputMode="numeric" value={f.packages} onChange={set("packages")} />
        </Field>
        <Field label="Package type">
          <Input value={f.packageType} onChange={set("packageType")} placeholder="cartons, bags, pallets" />
        </Field>
        <Field label="Charged weight (kg)" hint={`Actual: ${fmtNum(o.weightKg, "kg")}`}>
          <Input type="number" min={0} value={f.chargedWeightKg} onChange={set("chargedWeightKg")} />
        </Field>
        <Field label="Freight (₹)">
          <Input type="number" min={0} step="0.01" value={f.freightAmount} onChange={set("freightAmount")} />
        </Field>
        <Field label="Payment terms">
          <Select value={f.paymentTerms} onChange={set("paymentTerms")}>
            <option value="PAID">Paid</option>
            <option value="TO_PAY">To pay (consignee pays)</option>
            <option value="TO_BE_BILLED">To be billed</option>
          </Select>
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

const POD_STATUSES: Array<[PodStatus, string]> = [
  ["DELIVERED", "Delivered in full"],
  ["PARTIALLY_DELIVERED", "Partially delivered"],
  ["DISPUTED", "Delivered, but disputed"],
  ["FAILED", "Delivery failed"],
  ["RETURNED", "Returned"],
];

function PodForm({ o, tripId, onSaved }: { o: OrderDocs; tripId: number; onSaved: (message?: string) => void }) {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [f, set] = useForm({ status: "DELIVERED", receiverName: "", receiverPhone: "", deliveredAt: local, deliveredQuantity: "", shortageDetails: "", damageDetails: "", remarks: "" });
  const [signature, setSignature] = useState<File | null>(null);
  const [photos, setPhotos] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const delivered = ["DELIVERED", "PARTIALLY_DELIVERED", "DISPUTED"].includes(f.status);
  return (
    <FormShell
      submitLabel="Save proof of delivery"
      onSubmit={async () => {
        if (delivered && !signature) throw new Error("Ask the receiver to sign before saving.");
        if (f.status === "PARTIALLY_DELIVERED" && !f.deliveredQuantity) throw new Error("Enter the quantity actually delivered.");
        if (f.status === "PARTIALLY_DELIVERED" && !f.shortageDetails && !f.damageDetails) throw new Error("Describe the shortage or damage.");
        if (!delivered && !f.remarks) throw new Error("Explain why the delivery did not happen.");
        const form = new FormData();
        form.set("tripId", String(tripId));
        form.set("tripStopId", String(o.stopId));
        form.set("status", f.status);
        form.set("receiverName", f.receiverName);
        form.set("deliveredAt", new Date(f.deliveredAt).toISOString());
        for (const k of ["receiverPhone", "deliveredQuantity", "shortageDetails", "damageDetails", "remarks"] as const) if (f[k].trim()) form.set(k, f[k].trim());
        if (delivered && signature) form.set("signature", signature, "signature.png");
        for (const p of photos) form.append("photos", p.file, p.file.name);
        setProgress(0);
        try {
          await uploadWithProgress("/pods", form, setProgress);
        } catch (e) {
          // A retry after a lost response finds the POD it already created: treat as saved.
          const podId = e instanceof ApiError && e.status === 409 ? (e.details as { podId?: number } | undefined)?.podId : undefined;
          if (!podId) throw e;
          onSaved("This delivery was already recorded — showing the saved proof of delivery.");
          return;
        } finally {
          setProgress(null);
        }
        onSaved();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Outcome" className="sm:col-span-2">
          <Select value={f.status} onChange={set("status")}>
            {POD_STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={delivered ? "Received by" : "Person contacted"} required>
          <Input required value={f.receiverName} onChange={set("receiverName")} autoComplete="off" />
        </Field>
        <Field label="Phone">
          <Input type="tel" inputMode="tel" value={f.receiverPhone} onChange={set("receiverPhone")} autoComplete="off" />
        </Field>
        <Field label="Date & time">
          <Input type="datetime-local" value={f.deliveredAt} onChange={set("deliveredAt")} max={local} />
        </Field>
        {delivered && (
          <Field label="Quantity delivered (kg)" hint={`Ordered ${fmtNum(o.weightKg, "kg")}`}>
            <Input type="number" min={0} max={o.weightKg} step="any" inputMode="decimal" value={f.deliveredQuantity} onChange={set("deliveredQuantity")} placeholder={f.status === "DELIVERED" ? String(o.weightKg) : ""} />
          </Field>
        )}
        {delivered && f.status !== "DELIVERED" && (
          <>
            <Field label="Shortage">
              <Textarea rows={2} value={f.shortageDetails} onChange={set("shortageDetails")} />
            </Field>
            <Field label="Damage">
              <Textarea rows={2} value={f.damageDetails} onChange={set("damageDetails")} />
            </Field>
          </>
        )}
        <Field label="Remarks" className="sm:col-span-2" required={!delivered || f.status === "DISPUTED"}>
          <Textarea rows={2} value={f.remarks} onChange={set("remarks")} />
        </Field>
      </div>
      {!delivered && <Alert kind="warning">The stop is marked skipped and order {o.orderNumber} goes back to the planning pool.</Alert>}
      <FileCapture label="Delivery photos" value={photos} onChange={setPhotos} max={5} allowed={PHOTO_MIME} allowPdf={false} hint="Goods, packaging, any damage" />
      {delivered && <SignaturePad onChange={setSignature} />}
      <p className="text-xs text-muted">Recorded {fmtDate(new Date())}. Saving also completes this delivery stop.</p>
      <UploadProgress fraction={progress} />
    </FormShell>
  );
}
