"use client";

import { Download, FileSignature, FileText, ReceiptText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LrBadge } from "@/components/transport/TransportDocForms";
import { DataTable, ErrorState, ListCard, PageHeader, Select, StatusBadge, TableSkeleton, Tabs, type Column } from "@/components/ds";
import { fmtAmount, fmtDate, fmtDateTime, humanize } from "@/lib/format";
import type { EwayBill, LorryReceipt, PodStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Pod = {
  id: number;
  status: PodStatus;
  receiverName: string;
  deliveredAt: string;
  order: { id: number; orderNumber: string; customerName: string } | null;
  trip: { id: number; tripNumber: string };
};

const ewbState = (e: EwayBill) => (e.status === "CANCELLED" ? "CANCELLED" : e.expired ? "EXPIRED" : "VALID");
const lrState = (l: LorryReceipt) => (l.status === "CANCELLED" ? "CANCELLED" : l.finalizedAt ? "FINAL" : "DRAFT");
const tripLink = (t: { id: number; tripNumber: string } | null | undefined) =>
  t ? <Link className="text-brand-700 hover:underline" href={`/trips/${t.id}`}>{t.tripNumber}</Link> : <span className="text-muted">—</span>;

function Register() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  // Cross-links only for roles that may open those registers (same permissions as the sidebar).
  const showBilling = can("billing:read");
  const showCompliance = can("documents:read");
  const tab = params.get("tab") ?? "eway";
  const status = params.get("status") ?? "";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === "tab") next.delete("status");
    router.replace(`/transport-documents?${next.toString()}`, { scroll: false });
  };

  const ewbs = useApi<EwayBill[]>("/eway-bills");
  const lrs = useApi<LorryReceipt[]>("/lorry-receipts");
  const pods = useApi<Pod[]>("/pods");

  const ewbRows = (ewbs.data ?? []).filter((e) => !status || ewbState(e) === status);
  const lrRows = (lrs.data ?? []).filter((l) => !status || lrState(l) === status);
  const podRows = (pods.data ?? []).filter((p) => !status || p.status === status);

  const ewbColumns: Array<Column<EwayBill>> = [
    { key: "number", header: "E-Way Bill no.", sortValue: (e) => e.ewbNumber, cell: (e) => <Link href={`/transport-documents/eway-bills/${e.id}`} className="whitespace-nowrap font-medium tabular text-brand-700 hover:underline">{e.ewbNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}</Link> },
    { key: "order", header: "Order", sortValue: (e) => e.order?.orderNumber ?? "", cell: (e) => <span className="block max-w-[12rem] truncate">{e.order ? `${e.order.orderNumber} · ${e.order.customerName}` : "—"}</span> },
    { key: "trip", header: "Trip", cell: (e) => tripLink(e.trip), hideBelow: "lg" },
    { key: "vehicle", header: "Vehicle", cell: (e) => e.vehicleNumber ?? <span className="text-muted">—</span>, hideBelow: "md" },
    { key: "date", header: "Document date", sortValue: (e) => e.documentDate, cell: (e) => <span className="whitespace-nowrap text-xs">{fmtDate(e.documentDate)}</span>, hideBelow: "lg" },
    { key: "valid", header: "Valid until", sortValue: (e) => e.validUntil, cell: (e) => <span className="whitespace-nowrap text-xs">{e.validUntil ? fmtDateTime(e.validUntil) : "—"}</span> },
    { key: "files", header: "Files", align: "right", cell: (e) => e.attachments.length, hideBelow: "md" },
    { key: "status", header: "Status", sortValue: ewbState, cell: (e) => <StatusBadge status={ewbState(e)} /> },
  ];

  const lrColumns: Array<Column<LorryReceipt>> = [
    { key: "number", header: "LR no.", sortValue: (l) => l.lrNumber, cell: (l) => <Link href={`/transport-documents/lorry-receipts/${l.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline">{l.lrNumber}</Link> },
    { key: "order", header: "Order", sortValue: (l) => l.order.orderNumber, cell: (l) => <span className="block max-w-[12rem] truncate">{`${l.order.orderNumber} · ${l.consigneeName}`}</span> },
    { key: "trip", header: "Trip / vehicle", cell: (l) => (l.trip ? <span>{tripLink(l.trip)} <span className="text-xs text-muted">{l.trip.vehicle.registrationNumber}</span></span> : <span className="text-muted">—</span>), hideBelow: "lg" },
    { key: "route", header: "Route", cell: (l) => <span className="block max-w-[14rem] truncate text-xs">{l.fromPlace} → {l.toPlace}</span>, hideBelow: "md" },
    { key: "date", header: "Booked", sortValue: (l) => l.bookingDate, cell: (l) => <span className="whitespace-nowrap text-xs">{fmtDate(l.bookingDate)}</span>, hideBelow: "lg" },
    { key: "freight", header: "Freight", align: "right", sortValue: (l) => l.freightAmount, cell: (l) => (l.freightAmount != null ? fmtAmount(l.freightAmount) : <span className="text-muted">—</span>) },
    { key: "balance", header: "Balance", align: "right", sortValue: (l) => l.balanceAmount, cell: (l) => (l.balanceAmount != null ? fmtAmount(l.balanceAmount) : <span className="text-muted">—</span>), hideBelow: "md" },
    { key: "status", header: "Status", sortValue: lrState, cell: (l) => <LrBadge l={l} /> },
  ];

  const podColumns: Array<Column<Pod>> = [
    { key: "order", header: "Order", sortValue: (p) => p.order?.orderNumber ?? "", cell: (p) => <span className="block max-w-[14rem] truncate">{p.order ? `${p.order.orderNumber} · ${p.order.customerName}` : "—"}</span> },
    { key: "trip", header: "Trip", cell: (p) => tripLink(p.trip) },
    { key: "receiver", header: "Receiver", sortValue: (p) => p.receiverName, cell: (p) => p.receiverName, hideBelow: "md" },
    { key: "at", header: "Delivered", sortValue: (p) => p.deliveredAt, cell: (p) => <span className="whitespace-nowrap text-xs">{fmtDateTime(p.deliveredAt)}</span>, hideBelow: "lg" },
    { key: "status", header: "Outcome", sortValue: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
    {
      key: "pdf",
      header: "PDF",
      align: "right",
      cell: (p) => (
        <a className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" href={`/api/pods/${p.id}/pdf`} target="_blank" rel="noopener" aria-label={`POD PDF for ${p.order?.orderNumber ?? p.trip.tripNumber}`}>
          <Download size={12} aria-hidden /> PDF
        </a>
      ),
    },
  ];

  const statusOptions: Array<[string, string]> =
    tab === "eway" ? [["VALID", "Valid"], ["EXPIRED", "Expired"], ["CANCELLED", "Cancelled"]] : tab === "lr" ? [["DRAFT", "Draft"], ["FINAL", "Finalized"], ["CANCELLED", "Cancelled"]] : (["DELIVERED", "PARTIALLY_DELIVERED", "DISPUTED", "FAILED", "RETURNED"] as const).map((s) => [s, humanize(s)]);
  const statusFilter = (
    <Select aria-label="Filter by status" value={status} onChange={(e) => setParam("status", e.target.value)} className="sm:w-48">
      <option value="">All statuses</option>
      {statusOptions.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </Select>
  );

  const current = tab === "lr" ? lrs : tab === "pod" ? pods : ewbs;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transport documents"
        subtitle="Every E-Way Bill, lorry receipt and proof of delivery across your trips. New documents are added from a trip's paperwork panel, against the order they belong to."
      />
      {(showBilling || showCompliance) && (
        <nav aria-label="Other document registers" className="flex flex-wrap gap-2 text-sm">
          {showBilling && (
            <Link href="/billing" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 font-medium text-ink hover:bg-canvas">
              <ReceiptText size={15} aria-hidden /> Invoices &amp; delivery challans
            </Link>
          )}
          {showCompliance && (
            <Link href="/documents" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 font-medium text-ink hover:bg-canvas">
              <ShieldCheck size={15} aria-hidden /> Vehicle &amp; driver compliance
            </Link>
          )}
        </nav>
      )}
      <Tabs
        label="Document type"
        value={tab}
        onChange={(v) => setParam("tab", v)}
        tabs={[
          { id: "eway", label: "E-Way Bills", count: ewbs.data?.length },
          { id: "lr", label: "Lorry receipts (bilty)", count: lrs.data?.length },
          { id: "pod", label: "Proofs of delivery", count: pods.data?.length },
        ]}
      />
      {current.loading && !current.data ? (
        <TableSkeleton />
      ) : current.error ? (
        <ErrorState message={current.error} onRetry={current.reload} />
      ) : tab === "lr" ? (
        <DataTable
          rows={lrRows}
          columns={lrColumns}
          rowKey={(l) => l.id}
          searchText={(l) => `${l.lrNumber} ${l.order.orderNumber} ${l.consignorName} ${l.consigneeName} ${l.fromPlace} ${l.toPlace} ${l.trip?.tripNumber ?? ""} ${l.trip?.vehicle.registrationNumber ?? ""}`}
          searchPlaceholder="Search LR, order, consignee, place, vehicle…"
          toolbar={statusFilter}
          caption="Lorry receipts"
          mobileCard={(l) => (
            <ListCard
              title={<Link href={`/transport-documents/lorry-receipts/${l.id}`} className="font-medium text-brand-700 hover:underline">{l.lrNumber}</Link>}
              status={<LrBadge l={l} />}
              subtitle={`${l.order.orderNumber} · ${l.consigneeName}`}
              details={[
                ["Route", `${l.fromPlace} → ${l.toPlace}`],
                ["Freight", l.freightAmount != null ? fmtAmount(l.freightAmount) : "—"],
                ["Balance", l.balanceAmount != null ? fmtAmount(l.balanceAmount) : "—"],
                ["Booked", fmtDate(l.bookingDate)],
              ]}
            />
          )}
          empty={{ title: lrs.data?.length ? "No lorry receipts match" : "No lorry receipts yet", icon: ReceiptText, description: lrs.data?.length ? undefined : "Issue an LR from a trip: open the trip, then use “Issue LR” on the order." }}
        />
      ) : tab === "pod" ? (
        <DataTable
          rows={podRows}
          columns={podColumns}
          rowKey={(p) => p.id}
          searchText={(p) => `${p.order?.orderNumber ?? ""} ${p.order?.customerName ?? ""} ${p.receiverName} ${p.trip.tripNumber}`}
          searchPlaceholder="Search order, customer, receiver, trip…"
          toolbar={statusFilter}
          caption="Proofs of delivery"
          mobileCard={(p) => (
            <ListCard
              title={p.order ? `${p.order.orderNumber} · ${p.order.customerName}` : p.trip.tripNumber}
              status={<StatusBadge status={p.status} />}
              subtitle={`Received by ${p.receiverName}`}
              details={[
                ["Trip", p.trip.tripNumber],
                ["Delivered", fmtDateTime(p.deliveredAt)],
              ]}
            />
          )}
          empty={{ title: pods.data?.length ? "No proofs of delivery match" : "No proofs of delivery yet", icon: FileSignature, description: pods.data?.length ? undefined : "Deliveries are recorded on the trip while it is in transit." }}
        />
      ) : (
        <DataTable
          rows={ewbRows}
          columns={ewbColumns}
          rowKey={(e) => e.id}
          searchText={(e) => `${e.ewbNumber} ${e.order?.orderNumber ?? ""} ${e.supplierName} ${e.recipientName} ${e.vehicleNumber ?? ""} ${e.trip?.tripNumber ?? ""} ${e.goodsDescription}`}
          searchPlaceholder="Search number, order, party, vehicle…"
          toolbar={statusFilter}
          caption="E-Way Bills"
          mobileCard={(e) => (
            <ListCard
              title={<Link href={`/transport-documents/eway-bills/${e.id}`} className="font-medium tabular text-brand-700 hover:underline">{e.ewbNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}</Link>}
              status={<StatusBadge status={ewbState(e)} />}
              subtitle={e.order ? `${e.order.orderNumber} · ${e.order.customerName}` : undefined}
              details={[
                ["Vehicle", e.vehicleNumber ?? "—"],
                ["Valid until", e.validUntil ? fmtDateTime(e.validUntil) : "—"],
                ["Files", String(e.attachments.length)],
              ]}
            />
          )}
          empty={{ title: ewbs.data?.length ? "No E-Way Bills match" : "No E-Way Bills recorded yet", icon: FileText, description: ewbs.data?.length ? undefined : "Record an E-Way Bill from a trip: open the trip, then use “Record E-Way Bill” on the order." }}
        />
      )}
    </div>
  );
}

export default function TransportDocumentsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Register />
    </Suspense>
  );
}
