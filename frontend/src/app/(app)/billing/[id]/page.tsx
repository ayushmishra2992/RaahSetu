"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useConfirm } from "@/components/ds";
import { Alert, Button, ConfirmButton, ErrorState, Loading, Modal, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import type { BillingDoc } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { BillingForm } from "../BillingForm";

export default function BillingDocPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: d, error, loading, reload } = useApi<BillingDoc>(`/billing/${id}`);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    let active = true;
    api<{ url: string; dataUrl: string }>(`/billing/${id}/qr`).then((r) => active && setQr(r), () => undefined);
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <Loading />;
  if (error || !d) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const write = can("billing:write");
  const act = async (action: string) => {
    setMsg(null);
    try {
      await api(`/billing/${d.id}/${action}`, { method: "POST" });
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  const isInvoice = d.kind === "INVOICE";

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/billing" className="text-sm text-brand-700">← All documents</Link>
        <div className="flex flex-wrap gap-2">
          {write && d.status === "DRAFT" && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          {write && d.status === "DRAFT" && <Button onClick={async () => {
            const ok = await confirm({ title: `Issue ${d.number}?`, description: "Issuing records today as the issue date and locks the document against edits. Its QR code will then verify as a genuine record.", confirmLabel: "Issue document", tone: "primary" });
            if (ok) await act("issue");
          }}>Issue</Button>}
          {write && isInvoice && d.status === "ISSUED" && <Button onClick={async () => {
            const ok = await confirm({ title: `Mark ${d.number} as paid?`, description: "The invoice status changes to Paid. Payment details are not recorded in RaahSetu.", confirmLabel: "Mark paid", tone: "primary" });
            if (ok) await act("mark-paid");
          }}>Mark paid</Button>}
          {write && (d.status === "DRAFT" || d.status === "ISSUED") && <ConfirmButton confirmLabel="Cancel document" onConfirm={() => act("cancel")}>Cancel</ConfirmButton>}
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      {msg && <Alert>{msg}</Alert>}
      <article className="mx-auto max-w-3xl rounded-lg border border-line bg-white p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{isInvoice ? "Tax invoice" : "Delivery challan"}</p>
            <h1 className="mt-1 text-2xl font-semibold">{d.number}</h1>
            <div className="mt-1"><StatusBadge status={d.status} /></div>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{d.seller?.name}</p>
            {d.seller?.gstNumber && <p>GSTIN {d.seller.gstNumber}</p>}
            <p className="text-muted">{[d.seller?.address, d.seller?.city, d.seller?.state].filter(Boolean).join(", ")}</p>
          </div>
        </header>
        <section className="grid grid-cols-1 gap-4 py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-muted">Bill to</p>
            <p className="font-medium">{d.customerName}</p>
            {d.customerGstin && <p>GSTIN {d.customerGstin}</p>}
            <p className="text-muted">{d.customerAddress}</p>
          </div>
          <div className="sm:text-right">
            <p>Date: {fmtDate(d.issuedAt ?? d.createdAt)}</p>
            {d.dueDate && <p>Due: {fmtDate(d.dueDate)}</p>}
            {d.trip && <p>Trip: {d.trip.tripNumber}</p>}
          </div>
        </section>
        <table className="w-full text-sm">
          <thead className="border-y border-line text-xs uppercase text-muted"><tr><th className="py-2 text-left">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-line">
            {d.items?.map((i) => (
              <tr key={i.id}><td className="py-2">{i.description}</td><td className="py-2 text-right tabular">{fmtNum(i.quantity)} {i.unit}</td><td className="py-2 text-right tabular">{fmtMoney(i.rate)}</td><td className="py-2 text-right tabular">{fmtMoney(i.amount)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular">{fmtMoney(d.subtotal)}</span></div>
          {isInvoice && <div className="flex justify-between"><span>GST @ {d.taxRatePercent}%</span><span className="tabular">{fmtMoney(d.taxAmount)}</span></div>}
          <div className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span className="tabular">{fmtMoney(d.total)}</span></div>
        </div>
        {d.notes && <p className="mt-5 text-sm text-muted">{d.notes}</p>}
        <footer className="mt-8 flex items-end justify-between gap-4 border-t border-line pt-5">
          <p className="max-w-sm text-xs text-muted">Scan to verify this document against RaahSetu records. This is not a government e-invoice (IRN) or e-way bill.</p>
          {qr && <img src={qr.dataUrl} alt="Verification QR code" width={120} height={120} />}
        </footer>
      </article>
      <Modal open={editing} title={`Edit ${d.number}`} onClose={() => setEditing(false)} wide>
        <BillingForm doc={d} onSaved={() => { setEditing(false); reload(); }} />
      </Modal>
    </div>
  );
}
