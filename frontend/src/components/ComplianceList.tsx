"use client";

import { BadgeCheck, CircleSlash, FilePlus2, Paperclip, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, StatusBadge, useToast } from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { daysUntil, docTypeLabel, expiryStateOf, fmtDate, fmtRelDays, humanize } from "@/lib/format";
import type { ComplianceDoc, EntityCompliance } from "@/lib/types";
import { openAttachment } from "@/lib/upload";
import { DocumentUploadDialog } from "./DocumentUploadDialog";

const OVERALL_LABEL: Record<EntityCompliance["overall"], string> = {
  COMPLIANT: "Compliant",
  EXPIRING_SOON: "Expiring soon",
  PENDING_VERIFICATION: "Pending verification",
  MISSING: "Documents missing",
  EXPIRED: "Expired document",
};

/** Requirement-by-requirement status from the backend compliance engine. */
export function ComplianceSummary({ compliance, subject }: { compliance: EntityCompliance; subject: string }) {
  return (
    <Card
      title="Compliance status"
      icon={compliance.eligible ? ShieldCheck : ShieldAlert}
      description={compliance.eligible ? `${subject} can be dispatched under your company's rules` : `${subject} cannot be dispatched until the items below are fixed`}
      actions={<StatusBadge status={compliance.overall} label={OVERALL_LABEL[compliance.overall]} />}
    >
      <div className="space-y-3">
        {compliance.blockers.length > 0 && (
          <Alert title="Blocking dispatch">
            <ul className="list-disc pl-4">
              {compliance.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        )}
        {compliance.warnings.length > 0 && (
          <Alert kind="warning" title="Needs attention">
            <ul className="list-disc pl-4">
              {compliance.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        )}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {compliance.items.map((i) => (
            <li key={i.type} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-ink">{docTypeLabel(i.type)}</span>
                {!i.required && i.state !== "NOT_APPLICABLE" && <span className="text-xs text-muted"> · optional</span>}
                <span className="block truncate text-xs text-muted">{i.expiresOn ? `${fmtDate(i.expiresOn)} · ${fmtRelDays(daysUntil(i.expiresOn))}` : i.documentNumber ?? i.message}</span>
              </span>
              <StatusBadge status={i.state} />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** Documents of one vehicle or driver: files, verification and expiry. */
export function ComplianceList({ docs, owner, onChanged }: { docs: ComplianceDoc[]; owner: { vehicleId?: number; driverId?: number; label?: string }; onChanged?: () => void }) {
  const { can, me } = useAuth();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alertDays = me.company.settings.documentExpiryAlertDays;
  const q = owner.vehicleId ? `vehicleId=${owner.vehicleId}` : `driverId=${owner.driverId}`;
  const rows = docs.map((d) => ({ ...d, state: d.expiryState ?? expiryStateOf(d.expiresOn, alertDays) })).sort((a, b) => (a.expiresOn ?? "9").localeCompare(b.expiresOn ?? "9"));
  const attention = rows.filter((d) => d.state === "EXPIRED" || d.state === "EXPIRING_SOON").length;

  async function verify(d: ComplianceDoc, status: "VERIFIED" | "REJECTED") {
    let reason: string | null = null;
    if (status === "REJECTED") {
      reason = window.prompt(`Why is ${docTypeLabel(d.type)} ${d.documentNumber} rejected?`);
      if (!reason) return;
    }
    try {
      await api(`/documents/${d.id}/verify`, { body: { status, reason } });
      toast.success(`${docTypeLabel(d.type)} ${status === "VERIFIED" ? "verified" : "rejected"}`);
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function open(d: ComplianceDoc) {
    try {
      const first = d.attachments?.[0];
      if (first) await openAttachment(first.id);
      else window.open(`/api/documents/${d.id}/file`, "_blank", "noopener");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Card
      title="Documents"
      icon={ShieldCheck}
      description={rows.length ? (attention ? `${attention} need attention (expired or due within ${alertDays} days)` : "All documents in date") : undefined}
      actions={
        <>
          <Link href={`/documents?${q}`} className="text-xs font-medium text-brand-700 hover:underline">
            All documents
          </Link>
          {can("documents:write") && (
            <Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => setAdding(true)}>
              Add
            </Button>
          )}
        </>
      }
    >
      {error && (
        <Alert className="mb-3" title="Something went wrong">
          {error}
        </Alert>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No documents yet. Add the RC, insurance, PUC, fitness certificate and permit — take a photo with your phone or upload a PDF.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="font-medium text-ink">{docTypeLabel(d.type)}</span> <span className="text-muted">· {d.documentNumber}</span>
                <span className="block text-xs text-muted">
                  {d.expiresOn ? `${fmtDate(d.expiresOn)} · ${fmtRelDays(daysUntil(d.expiresOn))}` : "No expiry date"}
                  {d.verificationStatus === "REJECTED" && d.rejectionReason ? ` · Rejected: ${d.rejectionReason}` : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={d.state} />
                {d.verificationStatus && <Badge color={d.verificationStatus === "VERIFIED" ? "green" : d.verificationStatus === "REJECTED" ? "red" : "amber"}>{humanize(d.verificationStatus)}</Badge>}
                {d.hasFile ? (
                  <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => void open(d)} aria-label={`Open ${docTypeLabel(d.type)} file`}>
                    {d.attachments && d.attachments.length > 1 ? `${d.attachments.length} files` : "File"}
                  </Button>
                ) : (
                  <Badge color="gray">No file</Badge>
                )}
                {can("documents:verify") && d.verificationStatus !== "VERIFIED" && d.hasFile && (
                  <Button size="sm" variant="ghost" icon={BadgeCheck} onClick={() => void verify(d, "VERIFIED")}>
                    Verify
                  </Button>
                )}
                {can("documents:verify") && d.verificationStatus !== "REJECTED" && (
                  <Button size="sm" variant="ghost" icon={CircleSlash} onClick={() => void verify(d, "REJECTED")}>
                    Reject
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding && <DocumentUploadDialog open={adding} onClose={() => setAdding(false)} owner={{ ...owner, label: owner.label ?? "document" }} onSaved={() => { toast.success("Document saved"); onChanged?.(); }} />}
    </Card>
  );
}
