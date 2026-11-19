"use client";

import { ArrowLeft, Ban, FilePlus2, FileText, Paperclip, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Button, Card, ErrorState, Loading, Modal, PageHeader, StatusBadge, useToast } from "@/components/ds";
import { CancelDocumentDialog, DocumentHistory, EwayBillFilesForm, EwayBillForm } from "@/components/transport/TransportDocForms";
import { errorMessage } from "@/lib/api";
import { fmtAmount, fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import type { EwayBill } from "@/lib/types";
import { openAttachment } from "@/lib/upload";
import { useApi } from "@/lib/useApi";

const spaced = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Detail({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-ink">{v === null || v === undefined || v === "" ? <span className="text-muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function EwayBillPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const { data: e, error, loading, reload } = useApi<EwayBill>(`/eway-bills/${id}`);
  const [dialog, setDialog] = useState<"edit" | "files" | "cancel" | null>(null);
  const [version, setVersion] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);

  if (loading && !e) return <Loading variant="page" label="Loading E-Way Bill…" />;
  if (error || !e) return <ErrorState message={error ?? "Not found"} onRetry={reload} />;

  const write = can("shipments:write");
  const active = e.status === "ACTIVE";
  const state = e.status === "CANCELLED" ? "CANCELLED" : e.expired ? "EXPIRED" : "VALID";
  const changed = (message: string) => {
    setDialog(null);
    toast.success(message);
    setVersion((v) => v + 1);
    reload();
  };

  return (
    <div className="space-y-4">
      <Link href="/transport-documents?tab=eway" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft size={15} aria-hidden /> Transport documents
      </Link>
      <PageHeader
        title={`E-Way Bill ${spaced(e.ewbNumber)}`}
        subtitle={e.order ? `Order ${e.order.orderNumber} · ${e.order.customerName}${e.trip ? ` · Trip ${e.trip.tripNumber}` : ""}` : undefined}
        actions={
          write &&
          active && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={Pencil} onClick={() => setDialog("edit")}>
                Edit details
              </Button>
              <Button variant="secondary" icon={FilePlus2} onClick={() => setDialog("files")} disabled={e.attachments.length >= 5}>
                Add files
              </Button>
              <Button variant="danger" icon={Ban} onClick={() => setDialog("cancel")}>
                Cancel record
              </Button>
            </div>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={state} />
        {e.validUntil && <span className="text-sm text-muted">{state === "EXPIRED" ? "Expired" : "Valid until"} {fmtDateTime(e.validUntil)}</span>}
      </div>
      {e.status === "CANCELLED" && (
        <Alert title="This E-Way Bill record is cancelled">
          Cancelled {fmtDateTime(e.cancelledAt)}
          {e.cancelReason ? ` · Reason: ${e.cancelReason}` : ""}. RaahSetu only marks its own record; cancel the E-Way Bill on the government portal separately.
        </Alert>
      )}
      {active && e.expired && <Alert title="Validity has ended">If the goods are still moving, extend the E-Way Bill on the government portal and then update the dates here.</Alert>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Validity" icon={FileText}>
            <Detail
              items={[
                ["Document date", fmtDate(e.documentDate)],
                ["Valid from", e.validFrom ? fmtDate(e.validFrom) : null],
                ["Valid until", e.validUntil ? fmtDateTime(e.validUntil) : null],
                ["Vehicle number", e.vehicleNumber],
                ["Transporter ID", e.transporterId],
                ["Transport document / LR no.", e.transportDocNumber],
              ]}
            />
          </Card>
          <Card title="Parties and movement">
            <Detail
              items={[
                ["Supplier (consignor)", e.supplierName],
                ["Supplier GSTIN", e.supplierGstin],
                ["Recipient (consignee)", e.recipientName],
                ["Recipient GSTIN", e.recipientGstin],
                ["Place of dispatch", e.placeOfDispatch],
                ["Place of delivery", e.placeOfDelivery],
              ]}
            />
          </Card>
          <Card title="Goods">
            <Detail
              items={[
                ["Description", e.goodsDescription],
                ["HSN code", e.hsnCode],
                ["Quantity", e.quantity != null ? `${fmtNum(e.quantity)}${e.quantityUnit ? ` ${e.quantityUnit}` : ""}` : null],
                ["Taxable value", e.taxableValue != null ? fmtAmount(e.taxableValue) : null],
                ["Invoice / challan no.", e.invoiceOrChallanRef],
                ["Notes", e.notes],
              ]}
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Files" icon={Paperclip} description="Portal copy and supporting pages. Links are private and expire after a few minutes.">
            {fileError && <Alert className="mb-2">{fileError}</Alert>}
            {e.attachments.length === 0 ? (
              <p className="text-sm text-muted">No files attached.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {e.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{a.fileName}</span>
                      <span className="text-xs text-muted">
                        {kb(a.fileSizeBytes)} · {fmtDateTime(a.createdAt)}
                      </span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => openAttachment(a.id).catch((err) => setFileError(errorMessage(err)))} aria-label={`Open ${a.fileName}`}>
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <DocumentHistory path={`/eway-bills/${e.id}/history`} version={version} />
        </div>
      </div>
      <p className="text-xs text-muted">Recorded from the government E-Way Bill portal. RaahSetu does not generate, extend, cancel or validate E-Way Bills on the portal.</p>

      <Modal open={dialog === "edit"} title={`Edit E-Way Bill · ${spaced(e.ewbNumber)}`} onClose={() => setDialog(null)} wide>
        {dialog === "edit" && <EwayBillForm existing={e} onSaved={() => changed("E-Way Bill updated")} />}
      </Modal>
      <Modal open={dialog === "files"} title={`Add files · ${spaced(e.ewbNumber)}`} onClose={() => setDialog(null)}>
        {dialog === "files" && <EwayBillFilesForm ewb={e} onSaved={() => changed("Files added")} />}
      </Modal>
      <CancelDocumentDialog
        open={dialog === "cancel"}
        title={`Cancel E-Way Bill record ${spaced(e.ewbNumber)}?`}
        description="The record is kept and marked cancelled, with your reason, and no further changes are allowed. This does not cancel the E-Way Bill on the government portal."
        path={`/eway-bills/${e.id}/cancel`}
        onClose={() => setDialog(null)}
        onDone={() => changed("E-Way Bill record cancelled")}
      />
    </div>
  );
}
