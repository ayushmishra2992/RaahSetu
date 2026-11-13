"use client";

/* eslint-disable @next/next/no-img-element */
import { ArrowLeft, CheckCircle2, Pencil, Printer, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Badge, Button, ConfirmButton, ErrorState, Loading, Modal, StatusBadge, useConfirm, useToast } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtAmount, fmtDate, fmtNum, isPast } from "@/lib/format";
import type { BillingDoc } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { BillingForm } from "../BillingForm";

export default function BillingDocPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: d, error, loading, reload } = useApi<BillingDoc>(`/billing/${id}`);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    let active = true;
    api<{ url: string; dataUrl: string }>(`/billing/${id}/qr`).then(
      (r) => active && setQr(r),
      () => active && setQrFailed(true),
    );
    return () => {
      active = false;
    };
  }, [id]);

  if (loading && !d) return <Loading variant="page" label="Loading document…" />;
  if (error || !d) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;
  const write = can("billing:write");
  const isInvoice = d.kind === "INVOICE";
  const label = isInvoice ? "Tax invoice" : "Delivery challan";
  const overdue = isInvoice && d.status === "ISSUED" && isPast(d.dueDate);

  const act = async (action: "issue" | "mark-paid" | "cancel", done: string) => {
    setMsg(null);
    try {
      await api(`/billing/${d.id}/${action}`, { method: "POST" });
      toast.success(done);
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
      reload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/billing" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft size={15} aria-hidden /> All documents
        </Link>
        <div className="flex flex-wrap gap-2">
          {write && d.status === "DRAFT" && (
            <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {write && d.status === "DRAFT" && (
            <Button
              icon={Send}
              onClick={async () => {
                const ok = await confirm({ title: `Issue ${d.number}?`, description: "Issuing records today as the issue date and locks the document against edits. Its QR code will then verify as a genuine record.", confirmLabel: "Issue document", tone: "primary" });
                if (ok) await act("issue", `${d.number} issued`);
              }}
            >
              Issue
            </Button>
          )}
          {write && isInvoice && d.status === "ISSUED" && (
            <Button
              icon={CheckCircle2}
              onClick={async () => {
                const ok = await confirm({ title: `Mark ${d.number} as paid?`, description: "The invoice status changes to Paid. Payment amount, date and method are not recorded in RaahSetu.", confirmLabel: "Mark paid", tone: "primary" });
                if (ok) await act("mark-paid", `${d.number} marked paid`);
              }}
            >
              Mark paid
            </Button>
          )}
          {write && (d.status === "DRAFT" || d.status === "ISSUED") && (
            <ConfirmButton confirmLabel="Cancel document" title={`Cancel ${d.number}?`} description={`The ${label.toLowerCase()} is marked cancelled and kept for your records; its QR code will show it as cancelled. This can't be undone.`} onConfirm={() => act("cancel", `${d.number} cancelled`)}>
              Cancel
            </ConfirmButton>
          )}
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>
      {msg && (
        <div className="no-print">
          <Alert title="Action failed">{msg}</Alert>
        </div>
      )}
      {d.status === "DRAFT" && (
        <div className="no-print">
          <Alert kind="info">Draft: numbers and amounts can still change. Issue it to lock it and make its QR code verifiable.</Alert>
        </div>
      )}

      <article aria-label={`${label} ${d.number}`} className="mx-auto max-w-3xl rounded-lg border border-line bg-white p-5 shadow-xs sm:p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{label}</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{d.number}</h1>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StatusBadge status={d.status} />
              {overdue && <Badge color="red">Overdue</Badge>}
            </div>
          </div>
          <div className="text-sm sm:text-right">
            <p className="font-semibold text-ink">{d.seller?.name}</p>
            {d.seller?.gstNumber && <p>GSTIN {d.seller.gstNumber}</p>}
            <p className="text-muted">{[d.seller?.address, d.seller?.city, d.seller?.state].filter(Boolean).join(", ")}</p>
          </div>
        </header>
        <section className="grid grid-cols-1 gap-4 py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">{isInvoice ? "Bill to" : "Deliver to"}</p>
            <p className="font-medium text-ink">{d.customerName}</p>
            {d.customerGstin && <p>GSTIN {d.customerGstin}</p>}
            <p className="text-muted">{d.customerAddress}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 sm:justify-end sm:text-right">
            <dt className="text-muted">{d.issuedAt ? "Issued" : "Created"}</dt>
            <dd>{fmtDate(d.issuedAt ?? d.createdAt)}</dd>
            {d.dueDate && (
              <>
                <dt className="text-muted">Due</dt>
                <dd className={overdue ? "font-medium text-danger-700" : undefined}>{fmtDate(d.dueDate)}</dd>
              </>
            )}
            {d.trip && (
              <>
                <dt className="text-muted">Trip</dt>
                <dd>
                  <Link href={`/trips/${d.trip.id}`} className="text-brand-700 hover:underline print:text-ink print:no-underline">{d.trip.tripNumber}</Link>
                </dd>
              </>
            )}
          </dl>
        </section>
        <ul aria-label="Line items" className="divide-y divide-line border-y border-line text-sm sm:hidden print:hidden">
          {d.items?.map((i) => (
            <li key={i.id} className="py-2">
              <p className="text-ink">{i.description}</p>
              <p className="tabular mt-0.5 flex justify-between text-muted">
                <span>
                  {fmtNum(i.quantity)} {i.unit} × {fmtAmount(i.rate)}
                </span>
                <span className="text-ink">{fmtAmount(i.amount)}</span>
              </p>
            </li>
          ))}
        </ul>
        <div className="max-sm:hidden print:block">
          <table className="w-full text-sm">
            <caption className="sr-only">Line items</caption>
            <thead className="border-y border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="py-2 text-left font-medium">Description</th>
                <th scope="col" className="py-2 text-right font-medium">Qty</th>
                <th scope="col" className="py-2 text-right font-medium">Rate</th>
                <th scope="col" className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.items?.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-3">{i.description}</td>
                  <td className="tabular whitespace-nowrap py-2 text-right">
                    {fmtNum(i.quantity)} {i.unit}
                  </td>
                  <td className="tabular whitespace-nowrap py-2 pl-3 text-right">{fmtAmount(i.rate)}</td>
                  <td className="tabular whitespace-nowrap py-2 pl-3 text-right">{fmtAmount(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular">{fmtAmount(d.subtotal)}</dd>
          </div>
          {isInvoice && (
            <div className="flex justify-between">
              <dt>GST @ {d.taxRatePercent}%</dt>
              <dd className="tabular">{fmtAmount(d.taxAmount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{fmtAmount(d.total)}</dd>
          </div>
        </dl>
        {isInvoice && <p className="mt-2 text-right text-xs text-muted">GST is shown as one rate on the subtotal; no CGST/SGST/IGST split is calculated.</p>}
        {d.notes && <p className="mt-5 whitespace-pre-wrap text-sm text-muted">{d.notes}</p>}
        <footer className="mt-8 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
          <p className="max-w-sm text-xs text-muted">Scan to verify this document against RaahSetu records. This is not a government e-invoice (IRN) or e-way bill.</p>
          {qr ? <img src={qr.dataUrl} alt={`Verification QR code for ${d.number}`} width={120} height={120} /> : qrFailed ? <p className="text-xs text-muted">QR code unavailable.</p> : null}
        </footer>
      </article>
      <Modal open={editing} title={`Edit ${d.number}`} onClose={() => setEditing(false)} wide>
        {editing && (
          <BillingForm
            doc={d}
            onSaved={() => {
              setEditing(false);
              toast.success("Draft saved");
              reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
