"use client";

import { FilePlus2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { Card, LinkButton, StatusBadge } from "@/components/ds";
import { daysUntil, docTypeLabel, expiryStateOf, fmtDate, fmtRelDays } from "@/lib/format";
import type { ComplianceDoc } from "@/lib/types";

/** Documents of one vehicle or driver, with expiry state from the company alert window. */
export function ComplianceList({ docs, owner }: { docs: ComplianceDoc[]; owner: { vehicleId?: number; driverId?: number } }) {
  const { can, me } = useAuth();
  const alertDays = me.company.settings.documentExpiryAlertDays;
  const q = owner.vehicleId ? `vehicleId=${owner.vehicleId}` : `driverId=${owner.driverId}`;
  const rows = docs.map((d) => ({ ...d, state: d.expiryState ?? expiryStateOf(d.expiresOn, alertDays) })).sort((a, b) => (a.expiresOn ?? "9").localeCompare(b.expiresOn ?? "9"));
  const attention = rows.filter((d) => d.state === "EXPIRED" || d.state === "EXPIRING_SOON").length;
  return (
    <Card
      title="Compliance documents"
      icon={ShieldCheck}
      description={rows.length ? (attention ? `${attention} need attention (expired or due within ${alertDays} days)` : "All documents in date") : undefined}
      actions={
        <>
          <Link href={`/documents?${q}`} className="text-xs font-medium text-brand-700 hover:underline">Manage</Link>
          {can("documents:write") && (
            <LinkButton href={`/documents?new=1&${q}`} size="sm" variant="secondary" icon={FilePlus2}>
              Add
            </LinkButton>
          )}
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No documents recorded. RC, insurance, PUC, fitness and permit expiries block dispatch once recorded and expired.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-medium text-ink">{docTypeLabel(d.type)}</span> <span className="text-muted">· {d.documentNumber}</span>
                <span className="block text-xs text-muted">{d.expiresOn ? `${fmtDate(d.expiresOn)} · ${fmtRelDays(daysUntil(d.expiresOn))}` : "No expiry date"}</span>
              </span>
              <StatusBadge status={d.state} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
