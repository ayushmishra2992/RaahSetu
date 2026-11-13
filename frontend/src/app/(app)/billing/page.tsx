"use client";

import { FilePlus2, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Badge, Button, DataTable, ErrorState, ListCard, Loading, Modal, PageHeader, Select, Stat, StatusBadge, TableSkeleton, Tabs, type Column } from "@/components/ds";
import { fmtAmount, fmtDate, humanize, isPast } from "@/lib/format";
import type { BillingDoc } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { BillingForm } from "./BillingForm";

const STATUSES = ["DRAFT", "ISSUED", "PAID", "CANCELLED"] as const;
const overdue = (d: BillingDoc) => d.kind === "INVOICE" && d.status === "ISSUED" && isPast(d.dueDate);

function BillingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const write = can("billing:write");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(!!params.get("tripId") && write);
  const { data, error, loading, reload } = useApi<BillingDoc[]>("/billing");
  const all = data ?? [];
  const ofKind = all.filter((d) => !kind || d.kind === kind);
  const rows = ofKind.filter((d) => status === "all" || (status === "OVERDUE" ? overdue(d) : d.status === status));
  const invoices = all.filter((d) => d.kind === "INVOICE");
  const sum = (xs: BillingDoc[]) => xs.reduce((a, d) => a + d.total, 0);
  const outstanding = invoices.filter((d) => d.status === "ISSUED");
  const overdueList = invoices.filter(overdue);
  const paid = invoices.filter((d) => d.status === "PAID");
  const drafts = all.filter((d) => d.status === "DRAFT");

  const columns: Array<Column<BillingDoc>> = [
    { key: "number", header: "Number", sortValue: (d) => d.number, cell: (d) => <Link href={`/billing/${d.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline">{d.number}</Link> },
    { key: "kind", header: "Type", sortValue: (d) => d.kind, cell: (d) => (d.kind === "INVOICE" ? "Tax invoice" : "Delivery challan"), hideBelow: "md" },
    { key: "customer", header: "Customer", sortValue: (d) => d.customerName, cell: (d) => <span className="block max-w-[14rem] truncate">{d.customerName}</span> },
    { key: "trip", header: "Trip", cell: (d) => (d.trip ? <Link className="text-brand-700 hover:underline" href={`/trips/${d.trip.id}`}>{d.trip.tripNumber}</Link> : <span className="text-muted">—</span>), hideBelow: "lg" },
    { key: "total", header: "Total", align: "right", sortValue: (d) => d.total, cell: (d) => (d.kind === "INVOICE" ? fmtAmount(d.total) : <span className="text-muted">No value</span>) },
    { key: "issued", header: "Issued", sortValue: (d) => d.issuedAt, cell: (d) => <span className="whitespace-nowrap text-xs">{fmtDate(d.issuedAt)}</span>, hideBelow: "lg" },
    {
      key: "due",
      header: "Due",
      sortValue: (d) => d.dueDate,
      hideBelow: "md",
      cell: (d) => (
        <span className="whitespace-nowrap text-xs">
          {fmtDate(d.dueDate)}
          {overdue(d) && <span className="block font-medium text-danger-700">Overdue</span>}
        </span>
      ),
    },
    { key: "status", header: "Status", sortValue: (d) => STATUSES.indexOf(d.status), cell: (d) => <StatusBadge status={d.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices & challans"
        subtitle="Tax invoices and delivery challans with QR verification against RaahSetu records. GST is a single rate on the subtotal; this is not a government e-invoice (IRN) or e-way bill."
        actions={
          write && (
            <Button icon={FilePlus2} onClick={() => setCreating(true)}>
              New document
            </Button>
          )
        }
      />
      {data && (
        <section aria-label="Invoice summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Outstanding" value={fmtAmount(sum(outstanding))} hint={`${outstanding.length} issued, unpaid`} />
          <Stat label="Overdue" value={fmtAmount(sum(overdueList))} hint={`${overdueList.length} past due date`} className={overdueList.length ? "border-danger-600/30" : undefined} />
          <Stat label="Marked paid" value={fmtAmount(sum(paid))} hint={`${paid.length} invoice(s)`} />
          <Stat label="Drafts" value={drafts.length} hint="Not yet issued" />
        </section>
      )}
      <p className="-mt-2 text-xs text-muted">Sums of the invoice totals listed below. Payments are recorded as a status only; amounts received are not tracked.</p>

      <Tabs
        label="Filter by status"
        value={status}
        onChange={setStatus}
        tabs={[
          { id: "all", label: "All", count: ofKind.length },
          ...STATUSES.map((s) => ({ id: s, label: humanize(s), count: ofKind.filter((d) => d.status === s).length })),
          { id: "OVERDUE", label: "Overdue", count: ofKind.filter(overdue).length },
        ]}
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
          searchText={(d) => `${d.number} ${d.customerName} ${d.customerGstin ?? ""} ${d.trip?.tripNumber ?? ""}`}
          searchPlaceholder="Search number, customer, GSTIN, trip…"
          toolbar={
            <Select aria-label="Filter by document type" value={kind} onChange={(e) => setKind(e.target.value)} className="sm:w-52">
              <option value="">Invoices and challans</option>
              <option value="INVOICE">Tax invoices</option>
              <option value="DELIVERY_CHALLAN">Delivery challans</option>
            </Select>
          }
          caption="Billing documents"
          mobileCard={(d) => (
            <ListCard
              title={<Link href={`/billing/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.number}</Link>}
              status={
                <>
                  <StatusBadge status={d.status} />
                  {overdue(d) && <Badge color="red">Overdue</Badge>}
                </>
              }
              subtitle={d.customerName}
              details={[
                ["Type", d.kind === "INVOICE" ? "Tax invoice" : "Delivery challan"],
                ["Total", d.kind === "INVOICE" ? fmtAmount(d.total) : "No value"],
                ["Issued", fmtDate(d.issuedAt)],
                ["Due", fmtDate(d.dueDate)],
              ]}
            />
          )}
          empty={{
            title: all.length ? "No documents match these filters" : "No invoices or challans yet",
            icon: ReceiptText,
            description: all.length ? undefined : "Create an invoice from a completed trip, or a standalone document.",
            action: !all.length && write ? <Button icon={FilePlus2} onClick={() => setCreating(true)}>New document</Button> : undefined,
          }}
        />
      )}
      <Modal open={creating} title="New invoice or challan" onClose={() => setCreating(false)} wide>
        {creating && <BillingForm presetTripId={params.get("tripId") ?? undefined} onSaved={(id) => router.push(`/billing/${id}`)} />}
      </Modal>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <BillingInner />
    </Suspense>
  );
}
