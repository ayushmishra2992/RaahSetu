"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ComplianceOverview } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { Card, Loading, Stat, StatusBadge } from "./ds";

const STATES = ["COMPLIANT", "EXPIRING_SOON", "PENDING_VERIFICATION", "MISSING", "EXPIRED"] as const;

/** Fleet-wide compliance from the backend engine (real records only). */
export function ComplianceOverviewCard({ limit = 8 }: { limit?: number }) {
  const { data, error, loading } = useApi<ComplianceOverview>("/compliance/overview");
  if (loading) return <Loading label="Checking compliance…" />;
  if (error || !data) return null;
  const blocked = data.vehicles.blocked + data.drivers.blocked;
  return (
    <Card title="Compliance overview" icon={blocked ? ShieldAlert : ShieldCheck} description={`Evaluated against your company rules · alert window ${data.alertDays} days`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vehicles" value={data.vehicles.total} hint={`${data.vehicles.byState.COMPLIANT} compliant`} />
        <Stat label="Vehicles blocked" value={data.vehicles.blocked} hint="Cannot be dispatched" />
        <Stat label="Drivers" value={data.drivers.total} hint={`${data.drivers.byState.COMPLIANT} compliant`} />
        <Stat label="Drivers blocked" value={data.drivers.blocked} hint="Cannot be assigned" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
        {STATES.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <StatusBadge status={s} /> {data.vehicles.byState[s]} veh · {data.drivers.byState[s]} drv
          </span>
        ))}
      </div>
      {data.attention.length > 0 && (
        <ul className="mt-3 divide-y divide-line text-sm">
          {data.attention.slice(0, limit).map((a) => (
            <li key={`${a.kind}${a.id}`} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="min-w-0">
                <Link className="font-medium text-brand-700 hover:underline" href={`/${a.kind === "VEHICLE" ? "vehicles" : "drivers"}/${a.id}`}>
                  {a.label}
                </Link>
                <span className="block text-xs text-muted">{a.issues.slice(0, 2).join(" · ")}</span>
              </span>
              <span className="flex gap-1.5">
                {!a.eligible && <StatusBadge status="EXPIRED" label="Blocked" />}
                <StatusBadge status={a.overall} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.attention.length > limit && <p className="mt-2 text-xs text-muted">and {data.attention.length - limit} more</p>}
    </Card>
  );
}
