"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button, ErrorState, Loading, Modal, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { fmtDate, fmtMoney, humanize } from "@/lib/format";
import type { BillingDoc } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { BillingForm } from "./BillingForm";

function BillingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const [kind, setKind] = useState("");
  const [creating, setCreating] = useState(!!params.get("tripId"));
  const { data, error, loading, reload } = useApi<BillingDoc[]>(`/billing${kind ? `?kind=${kind}` : ""}`);
  return (
    <div>
      <PageHeader title="Invoices & challans" subtitle="GST invoices and delivery challans with QR verification." actions={can("billing:write") && <Button onClick={() => setCreating(true)}>New document</Button>} />
      <div className="mb-3"><Select value={kind} onChange={(e) => setKind(e.target.value)} className="max-w-[220px]"><option value="">All documents</option><option value="INVOICE">Invoices</option><option value="DELIVERY_CHALLAN">Delivery challans</option></Select></div>
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <Table head={["Number", "Type", "Customer", "Trip", "Total", "Issued", "Status"]} empty={data?.length === 0}>
          {data?.map((d) => (
            <tr key={d.id} className="hover:bg-canvas">
              <Td><Link href={`/billing/${d.id}`} className="font-medium text-brand-700">{d.number}</Link></Td>
              <Td>{humanize(d.kind)}</Td>
              <Td>{d.customerName}</Td>
              <Td>{d.trip ? <Link className="text-brand-700" href={`/trips/${d.trip.id}`}>{d.trip.tripNumber}</Link> : "—"}</Td>
              <Td className="tabular">{d.kind === "INVOICE" ? fmtMoney(d.total) : "—"}</Td>
              <Td>{fmtDate(d.issuedAt)}</Td>
              <Td><StatusBadge status={d.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={creating} title="New invoice / challan" onClose={() => setCreating(false)} wide>
        <BillingForm presetTripId={params.get("tripId") ?? undefined} onSaved={(id) => router.push(`/billing/${id}`)} />
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
