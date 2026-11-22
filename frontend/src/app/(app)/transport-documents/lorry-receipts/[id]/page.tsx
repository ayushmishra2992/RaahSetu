"use client";

import { ArrowLeft, Ban, Download, Lock, Pencil, Printer, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, ErrorState, Loading, Modal, PageHeader, useConfirm, useToast } from "@/components/ds";
import { CancelDocumentDialog, DocumentHistory, LrBadge, LrForm, PAYMENT_TERMS } from "@/components/transport/TransportDocForms";
import { api, errorMessage } from "@/lib/api";
import { fmtAmount, fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import type { LorryReceipt } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function Detail({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-muted">{k}</dt>
          <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{v === null || v === undefined || v === "" ? <span className="text-muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

const linkButton = "inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas";

export default function LorryReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: l, error, loading, reload } = useApi<LorryReceipt>(`/lorry-receipts/${id}`);
  const [dialog, setDialog] = useState<"edit" | "cancel" | null>(null);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !l) return <Loading variant="page" label="Loading lorry receipt…" />;
  if (error || !l) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;

  const write = can("shipments:write");
  const changed = (message: string) => {
    setDialog(null);
    setMsg(null);
    toast.success(message);
    setVersion((v) => v + 1);
    reload();
  };
  const finalize = async () => {
    const ok = await confirm({
      title: `Finalize ${l.lrNumber}?`,
      description: "The LR is locked: its details can no longer be edited, and your company's current LR terms are printed on it. If something is wrong later, cancel it and issue a new LR.",
      confirmLabel: "Finalize LR",
      tone: "primary",
    });
    if (!ok) return;
    try {
      await api(`/lorry-receipts/${l.id}/finalize`, { method: "POST" });
      changed(`${l.lrNumber} finalized`);
    } catch (e) {
      setMsg(errorMessage(e));
      reload();
    }
  };
  const terms = PAYMENT_TERMS.find(([v]) => v === l.paymentTerms)?.[1] ?? l.paymentTerms;
  const pdf = `/api/lorry-receipts/${l.id}/pdf`;

  return (
    <div className="space-y-4">
      <Link href="/transport-documents?tab=lr" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft size={15} aria-hidden /> Transport documents
      </Link>
      <PageHeader
        title={`Lorry receipt ${l.lrNumber}`}
        subtitle={`Order ${l.order.orderNumber} · ${l.order.customerName}${l.trip ? ` · Trip ${l.trip.tripNumber}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <a className={linkButton} href={`${pdf}?inline=1`} target="_blank" rel="noopener">
              <Printer size={15} aria-hidden /> View / print PDF
            </a>
            <a className={linkButton} href={pdf} download>
              <Download size={15} aria-hidden /> Download PDF
            </a>
            {write && l.editable && (
              <>
                <Button variant="secondary" icon={Pencil} onClick={() => setDialog("edit")}>
                  Edit
                </Button>
                <Button icon={Lock} onClick={() => void finalize()}>
                  Finalize
                </Button>
              </>
            )}
            {write && l.status === "ACTIVE" && (
              <Button variant="danger" icon={Ban} onClick={() => setDialog("cancel")}>
                Cancel LR
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <LrBadge l={l} />
        {l.finalizedAt ? <span>Finalized {fmtDateTime(l.finalizedAt)}</span> : l.status === "ACTIVE" ? <span>Draft: can be edited until it is finalized. Draft PDFs are marked as such.</span> : null}
      </div>
      {msg && <Alert>{msg}</Alert>}
      {l.status === "CANCELLED" && (
        <Alert title="This lorry receipt is cancelled">
          Cancelled {fmtDateTime(l.cancelledAt)}
          {l.cancelReason ? ` · Reason: ${l.cancelReason}` : ""}. It is kept for your records and cannot be changed.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Consignment" icon={ReceiptText}>
            <Detail
              items={[
                ["Booking date", fmtDate(l.bookingDate)],
                ["Payment terms", terms],
                ["Consignor", [l.consignorName, l.consignorAddress, l.consignorGstin ? `GSTIN ${l.consignorGstin}` : null].filter(Boolean).join("\n")],
                ["Consignee", [l.consigneeName, l.consigneeAddress, l.consigneeGstin ? `GSTIN ${l.consigneeGstin}` : null].filter(Boolean).join("\n")],
                ["From", l.fromPlace],
                ["To", l.toPlace],
              ]}
            />
          </Card>
          <Card title="Goods">
            <Detail
              items={[
                ["Description", l.goodsDescription],
                ["Packages", l.packages != null ? `${l.packages}${l.packageType ? ` ${l.packageType}` : ""}` : null],
                ["Actual weight", l.actualWeightKg != null ? fmtNum(l.actualWeightKg, "kg") : null],
                ["Charged weight", l.chargedWeightKg != null ? fmtNum(l.chargedWeightKg, "kg") : null],
                ["Declared value", l.declaredValue != null ? fmtAmount(l.declaredValue) : null],
                ["Delivery instructions", l.deliveryInstructions],
              ]}
            />
          </Card>
          <Card title="Terms printed on this LR" description={l.finalizedAt ? "Copied from Settings when the LR was finalized." : "Drafts show your company's current LR terms from Settings; they are copied onto the LR when it is finalized."}>
            {l.finalizedAt ? (
              l.termsSnapshot ? <p className="whitespace-pre-line text-sm text-ink">{l.termsSnapshot}</p> : <p className="text-sm text-muted">No terms were set when this LR was finalized.</p>
            ) : (
              <p className="text-sm text-muted">
                {can("company:manage") ? (
                  <>
                    Set the wording under <Link className="text-brand-700 hover:underline" href="/settings">Settings → Transport documents</Link>.
                  </>
                ) : (
                  "An admin sets the wording in Settings."
                )}
              </p>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Freight">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Freight</dt>
                <dd className="font-medium tabular">{fmtAmount(l.freightAmount)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Advance received</dt>
                <dd className="tabular">{fmtAmount(l.advanceAmount ?? (l.freightAmount != null ? 0 : null))}</dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-line pt-2">
                <dt className="font-medium text-ink">Balance</dt>
                <dd className="font-semibold tabular">{fmtAmount(l.balanceAmount)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">Amounts as recorded on the LR. Payments against them are not tracked here.</p>
          </Card>
          <Card title="Trip">
            {l.trip ? (
              <Detail
                items={[
                  ["Trip", <Link key="t" className="text-brand-700 hover:underline" href={`/trips/${l.trip.id}`}>{l.trip.tripNumber}</Link>],
                  ["Vehicle", l.trip.vehicle.registrationNumber],
                  ["Driver", l.trip.driver.name],
                ]}
              />
            ) : (
              <p className="text-sm text-muted">Not linked to a trip.</p>
            )}
          </Card>
          <DocumentHistory path={`/lorry-receipts/${l.id}/history`} version={version} />
        </div>
      </div>

      <Modal open={dialog === "edit"} title={`Edit lorry receipt · ${l.lrNumber}`} onClose={() => setDialog(null)} wide>
        {dialog === "edit" && <LrForm existing={l} onSaved={() => changed("Lorry receipt updated")} />}
      </Modal>
      <CancelDocumentDialog
        open={dialog === "cancel"}
        title={`Cancel lorry receipt ${l.lrNumber}?`}
        description="The LR is kept with its number, marked cancelled with your reason, and can no longer be changed or finalized."
        path={`/lorry-receipts/${l.id}/cancel`}
        onClose={() => setDialog(null)}
        onDone={() => changed(`${l.lrNumber} cancelled`)}
      />
    </div>
  );
}
