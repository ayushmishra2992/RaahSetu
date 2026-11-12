"use client";

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  FilePlus2,
  Fuel,
  Gauge,
  IndianRupee,
  Leaf,
  ListChecks,
  MapPinned,
  PackagePlus,
  RefreshCw,
  Route,
  Timer,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { MapLegend, RouteMap, routeColor, type MapLine, type MapPoint } from "@/components/RouteMap";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LinkButton,
  Loading,
  PageHeader,
  Select,
  SkeletonText,
  StackedBar,
  Stat,
  StatusBadge,
  SyntheticNote,
  Tabs,
  statusSegments,
  type Column,
} from "@/components/ds";
import { describeAction, entityHref, entityLabel } from "@/lib/audit";
import { daysUntil, docTypeLabel, fmtDateTime, fmtMoney, fmtNum, fmtRelDays, humanize, isPast } from "@/lib/format";
import type { ComplianceDoc, Order } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface ControlTower {
  generatedAt: string;
  counts: Record<"vehicles" | "drivers" | "orders" | "trips", Record<string, number>>;
  kpis: { fleetUtilizationPct: number; onTimeDeliveryPct30d: number | null; completedTrips30d: number; estimatedCo2Kg30d: number; estimatedCost30d: number; plannedKm30d: number };
  alerts: Array<{ severity: "critical" | "warning" | "info"; type: string; message: string; link?: string }>;
  liveTrips: Array<{
    id: number;
    tripNumber: string;
    status: string;
    vehicle: string;
    driver: string;
    stopsDone: number;
    stopsTotal: number;
    position: { lat: number; lng: number; progressPct: number; nextStop: string | null; delayMinutes: number } | null;
    route: Array<{ lat: number; lng: number; name: string; type: string; status: string }>;
  }>;
  recentRuns: Array<{ id: number; name: string | null; algorithm: string; feasible: boolean; totalDistanceKm: number | null; totalCo2Kg: number | null; totalCost: number | null; unservedCount: number; createdAt: string; dispatchedAt: string | null }>;
  telemetryNote: string;
}

interface GreenSummary {
  periodDays: number;
  totals: { estCo2Kg: number; loggedCo2Kg: number; estCost: number; loggedFuelCost: number };
}

interface AuditEvent {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  userName: string | null;
  createdAt: string;
}

type Run = ControlTower["recentRuns"][number];

const SEVERITY_ICON = { critical: AlertTriangle, warning: Clock, info: Activity } as const;
const SEVERITY_CLS = { critical: "text-danger-600", warning: "text-warning-600", info: "text-info-600" } as const;

export default function ControlTowerPage() {
  const { can, me } = useAuth();
  const alertDays = me.company.settings.documentExpiryAlertDays;
  const [greenDays, setGreenDays] = useState("30");
  const [severity, setSeverity] = useState("all");
  const [tripFilter, setTripFilter] = useState("all");

  const ct = useApi<ControlTower>("/control-tower");
  const docs = useApi<ComplianceDoc[]>(can("documents:read") ? `/documents?expiringWithinDays=${alertDays}` : null);
  const pending = useApi<Order[]>(can("orders:read") ? "/orders?status=PENDING" : null);
  const activity = useApi<AuditEvent[]>(can("audit:read") ? "/audit?limit=8" : null);
  const green = useApi<GreenSummary>(can("greenfleet:read") ? `/greenfleet/summary?days=${greenDays}` : null);

  const refreshAll = () => {
    ct.reload();
    if (can("documents:read")) docs.reload();
    if (can("orders:read")) pending.reload();
    if (can("audit:read")) activity.reload();
    if (can("greenfleet:read")) green.reload();
  };

  const quickActions = [
    can("orders:write") && { href: "/orders?new=1", label: "New order", icon: PackagePlus },
    can("optimize:run") && { href: "/optiroute", label: "Plan routes", icon: Route },
    can("trips:write") && { href: "/trips/new", label: "Create trip", icon: Truck },
    can("documents:write") && { href: "/documents?new=1", label: "Add document", icon: FilePlus2 },
    can("fuel:write") && { href: "/greenfleet#log-fuel", label: "Log fuel", icon: Fuel },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof Route }>;

  if (ct.loading && !ct.data) return <Loading variant="page" label="Loading Control Tower…" />;
  if (ct.error || !ct.data) return <ErrorState message={ct.error ?? "No data"} onRetry={ct.reload} />;
  const data = ct.data;

  const critical = data.alerts.filter((a) => a.severity === "critical").length;
  const alerts = severity === "all" ? data.alerts : data.alerts.filter((a) => a.severity === severity);
  const live = tripFilter === "all" ? data.liveTrips : data.liveTrips.filter((t) => t.status === tripFilter);
  const liveCount = (s: string) => data.liveTrips.filter((t) => t.status === s).length;

  const points: MapPoint[] = [];
  const lines: MapLine[] = live.map((t) => {
    const colour = routeColor(data.liveTrips.indexOf(t));
    t.route.forEach((s) => points.push({ lat: s.lat, lng: s.lng, kind: s.type.startsWith("DEPOT") ? "depot" : s.type === "PICKUP" ? "pickup" : "drop" }));
    if (t.position) points.push({ lat: t.position.lat, lng: t.position.lng, kind: "vehicle", label: t.vehicle });
    return { points: t.route, color: colour, label: t.tripNumber };
  });

  const overdueOrders = (pending.data ?? []).filter((o) => isPast(o.windowEnd));
  const urgentPending = (pending.data ?? []).filter((o) => o.priority === "URGENT").length;
  const sortedDocs = [...(docs.data ?? [])].sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));

  const runColumns: Array<Column<Run>> = [
    { key: "run", header: "Run", cell: (r) => <Link href={`/optiroute/runs/${r.id}`} className="font-medium text-brand-700 hover:underline">#{r.id} {r.name}</Link> },
    { key: "algo", header: "Algorithm", cell: (r) => humanize(r.algorithm), hideBelow: "md" },
    { key: "feasible", header: "Result", cell: (r) => (r.feasible ? <Badge color="green" dot>Feasible</Badge> : <Badge color="red" dot>Infeasible</Badge>) },
    { key: "unserved", header: "Unserved", align: "right", cell: (r) => r.unservedCount },
    { key: "km", header: "Distance", align: "right", cell: (r) => fmtNum(r.totalDistanceKm, "km"), hideBelow: "sm" },
    { key: "cost", header: "Est. cost", align: "right", cell: (r) => fmtMoney(r.totalCost), hideBelow: "lg" },
    { key: "state", header: "Trips", cell: (r) => (r.dispatchedAt ? <Badge color="blue">Created</Badge> : <span className="text-muted">Not yet</span>), hideBelow: "sm" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Control Tower"
        subtitle={<>Operational snapshot generated {fmtDateTime(data.generatedAt)}. Trailing figures cover the last 30 days.</>}
        actions={
          <Button variant="secondary" icon={RefreshCw} loading={ct.loading} onClick={refreshAll}>
            Refresh
          </Button>
        }
      />

      {quickActions.length > 0 && (
        <nav aria-label="Quick actions" className="-mt-2 flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <LinkButton key={a.href} href={a.href} variant="secondary" size="sm" icon={a.icon}>
              {a.label}
            </LinkButton>
          ))}
        </nav>
      )}

      {critical > 0 && (
        <a href="#alerts" onClick={() => setSeverity("critical")} className="flex items-center gap-2 rounded-lg border border-danger-600/25 bg-danger-50 px-4 py-2.5 text-sm font-medium text-danger-700 hover:bg-danger-50/70">
          <AlertTriangle size={16} aria-hidden />
          {critical} critical alert{critical === 1 ? " needs" : "s need"} attention
          <span className="ml-auto text-xs font-normal underline">Review</span>
        </a>
      )}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Fleet utilisation" icon={Gauge} value={`${fmtNum(data.kpis.fleetUtilizationPct)}%`} hint="Vehicles on trip now" />
        <Stat label="On-time delivery" icon={CheckCircle2} value={data.kpis.onTimeDeliveryPct30d == null ? "—" : `${fmtNum(data.kpis.onTimeDeliveryPct30d)}%`} hint={data.kpis.onTimeDeliveryPct30d == null ? "No completed drops yet" : "Drops within window · 30d"} />
        <Stat label="Trips completed" icon={ListChecks} value={fmtNum(data.kpis.completedTrips30d)} hint="Last 30 days" />
        <Stat label="Planned distance" icon={MapPinned} value={fmtNum(data.kpis.plannedKm30d, "km")} hint="Completed trips, 30d" />
        <Stat label="Operating cost" icon={IndianRupee} value={fmtMoney(data.kpis.estimatedCost30d)} hint="Estimate · fuel + driver" />
        <Stat label="CO₂ emissions" icon={Leaf} value={fmtNum(data.kpis.estimatedCo2Kg30d, "kg")} hint="Estimate, not measured" />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card
          title="Live operations"
          description="Dispatched and in-transit trips"
          icon={Truck}
          actions={<Badge color="amber">Simulated positions</Badge>}
        >
          {data.liveTrips.length === 0 ? (
            <EmptyState title="No trips on the road" icon={Truck} compact action={can("optimize:run") ? <LinkButton href="/optiroute" size="sm">Plan routes</LinkButton> : undefined}>
              Dispatched and in-transit trips appear here with their route.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              <Tabs
                label="Filter live trips"
                value={tripFilter}
                onChange={setTripFilter}
                tabs={[
                  { id: "all", label: "All", count: data.liveTrips.length },
                  { id: "IN_TRANSIT", label: "In transit", count: liveCount("IN_TRANSIT") },
                  { id: "DISPATCHED", label: "Dispatched", count: liveCount("DISPATCHED") },
                ]}
              />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <RouteMap points={points} lines={lines} height={340} />
                  <MapLegend kinds={["depot", "pickup", "drop", "vehicle"]} />
                </div>
                <div className="min-w-0 space-y-2">
                  {live.length === 0 && <p className="text-sm text-muted">No trips with this status.</p>}
                  <ul className="max-h-[380px] space-y-2 overflow-y-auto pr-0.5">
                    {live.map((t) => (
                      <li key={t.id}>
                        <Link href={`/trips/${t.id}`} className="block rounded-md border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface-muted">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: routeColor(data.liveTrips.indexOf(t)) }} />
                              <span className="truncate">{t.tripNumber}</span>
                            </span>
                            <StatusBadge status={t.status} />
                          </div>
                          <p className="mt-1 truncate text-xs text-muted">
                            {t.vehicle} · {t.driver}
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                            <span className="h-1.5 flex-1 rounded-full bg-navy-50" aria-hidden>
                              <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${t.stopsTotal ? (t.stopsDone / t.stopsTotal) * 100 : 0}%` }} />
                            </span>
                            <span className="tabular">
                              {t.stopsDone}/{t.stopsTotal} stops
                            </span>
                          </div>
                          {t.position && (
                            <p className="mt-1.5 text-xs text-muted">
                              Next: <span className="text-ink">{t.position.nextStop ?? "—"}</span>
                              {t.position.delayMinutes > 0 && <span className="ml-1 text-warning-700">· {t.position.delayMinutes} min behind plan</span>}
                            </p>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <SyntheticNote>{data.telemetryNote}</SyntheticNote>
                </div>
              </div>
            </div>
          )}
        </Card>

        <div id="alerts" className="scroll-mt-20">
          <Card title="Alerts" icon={AlertTriangle} description="Expiries, late deliveries and items awaiting action">
            {data.alerts.length === 0 ? (
              <EmptyState title="All clear" icon={CheckCircle2} compact>
                No expiring documents, late deliveries or pending approvals.
              </EmptyState>
            ) : (
              <div className="space-y-3">
                <Tabs
                  label="Filter alerts by severity"
                  value={severity}
                  onChange={setSeverity}
                  tabs={[
                    { id: "all", label: "All", count: data.alerts.length },
                    { id: "critical", label: "Critical", count: data.alerts.filter((a) => a.severity === "critical").length },
                    { id: "warning", label: "Warning", count: data.alerts.filter((a) => a.severity === "warning").length },
                    { id: "info", label: "Info", count: data.alerts.filter((a) => a.severity === "info").length },
                  ]}
                />
                {alerts.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted">No {severity} alerts.</p>
                ) : (
                  <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                    {alerts.map((a, i) => {
                      const Icon = SEVERITY_ICON[a.severity];
                      const body = (
                        <>
                          <Icon size={16} aria-hidden className={`mt-0.5 shrink-0 ${SEVERITY_CLS[a.severity]}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-ink">{a.message}</span>
                            <span className="mt-0.5 block text-xs text-muted">
                              <span className="font-medium">{humanize(a.severity)}</span> · {humanize(a.type)}
                            </span>
                          </span>
                        </>
                      );
                      return (
                        <li key={i}>
                          {a.link ? (
                            <Link href={a.link} className="-mx-2 flex gap-2.5 rounded-md px-2 py-2.5 hover:bg-surface-muted">
                              {body}
                            </Link>
                          ) : (
                            <div className="flex gap-2.5 py-2.5">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      <section aria-label="Fleet and pipeline" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Vehicles" description={`${sum(data.counts.vehicles)} in fleet`}>
          <StackedBar label="Vehicles by status" segments={statusSegments(data.counts.vehicles, ["AVAILABLE", "ON_TRIP", "MAINTENANCE", "INACTIVE"])} emptyText="No vehicles yet" />
        </Card>
        <Card title="Drivers" description={`${sum(data.counts.drivers)} on roster`}>
          <StackedBar label="Drivers by status" segments={statusSegments(data.counts.drivers, ["AVAILABLE", "ON_TRIP", "OFF_DUTY", "INACTIVE"])} emptyText="No drivers yet" />
        </Card>
        <Card title="Orders" description={`${sum(data.counts.orders)} all time`} actions={<Link href="/orders" className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}>
          <StackedBar label="Orders by status" segments={statusSegments(data.counts.orders, ["PENDING", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"])} emptyText="No orders yet" />
        </Card>
        <Card title="Trips" description={`${sum(data.counts.trips)} all time`} actions={<Link href="/trips" className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}>
          <StackedBar label="Trips by status" segments={statusSegments(data.counts.trips, ["PLANNED", "DISPATCHED", "IN_TRANSIT", "COMPLETED", "CANCELLED"])} emptyText="No trips yet" />
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {can("orders:read") && (
          <Card title="Orders awaiting planning" icon={Timer} description={pending.data ? `${pending.data.length} pending · ${urgentPending} urgent` : undefined}>
            {pending.loading ? (
              <SkeletonText lines={4} />
            ) : pending.error ? (
              <ErrorState message={pending.error} onRetry={pending.reload} />
            ) : overdueOrders.length === 0 ? (
              <p className="text-sm text-muted">{pending.data?.length ? "No pending order has passed its delivery window." : "No pending orders."}</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-medium text-danger-700">{overdueOrders.length} pending order{overdueOrders.length === 1 ? " has" : "s have"} passed the delivery window</p>
                <ul className="divide-y divide-line">
                  {overdueOrders.slice(0, 6).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0">
                        <Link href={`/orders?open=${o.id}`} className="font-medium text-brand-700 hover:underline">{o.orderNumber}</Link>
                        <span className="block truncate text-xs text-muted">{o.customerName} · window ended {fmtDateTime(o.windowEnd)}</span>
                      </span>
                      <StatusBadge status={o.priority} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}

        {can("documents:read") && (
          <Card title="Compliance expiries" icon={CalendarClock} description={`Expired or due within ${alertDays} days`} actions={<Link href="/documents" className="text-xs font-medium text-brand-700 hover:underline">All documents</Link>}>
            {docs.loading ? (
              <SkeletonText lines={4} />
            ) : docs.error ? (
              <ErrorState message={docs.error} onRetry={docs.reload} />
            ) : sortedDocs.length === 0 ? (
              <p className="text-sm text-muted">Nothing expired or due in the next {alertDays} days.</p>
            ) : (
              <ul className="divide-y divide-line">
                {sortedDocs.slice(0, 6).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{docTypeLabel(d.type)}</span>
                      <span className="text-muted"> · {d.vehicle?.registrationNumber ?? d.driver?.name ?? "—"}</span>
                      <span className="block text-xs text-muted">{d.expiresOn ? fmtRelDays(daysUntil(d.expiresOn)) : "No expiry"}</span>
                    </span>
                    {d.expiryState && <StatusBadge status={d.expiryState} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {can("audit:read") ? (
          <Card title="Recent activity" icon={Activity} actions={<Link href="/audit" className="text-xs font-medium text-brand-700 hover:underline">Audit log</Link>}>
            {activity.loading ? (
              <SkeletonText lines={4} />
            ) : activity.error ? (
              <ErrorState message={activity.error} onRetry={activity.reload} />
            ) : !activity.data?.length ? (
              <p className="text-sm text-muted">No recorded activity yet.</p>
            ) : (
              <ol className="space-y-3">
                {activity.data.map((e) => {
                  const href = entityHref(e.entityType, e.entityId);
                  return (
                    <li key={e.id} className="flex gap-2.5 text-sm">
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      <span className="min-w-0">
                        <span className="text-ink">{describeAction(e.action)}</span>
                        {e.entityId != null && (
                          <span className="text-muted">
                            {" "}
                            · {href ? <Link href={href} className="text-brand-700 hover:underline">{entityLabel(e.entityType)} #{e.entityId}</Link> : `${entityLabel(e.entityType)} #${e.entityId}`}
                          </span>
                        )}
                        <span className="block text-xs text-muted">
                          {e.userName ?? "System"} · {fmtDateTime(e.createdAt)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {can("greenfleet:read") && (
          <Card
            title="Fuel & emissions"
            icon={Leaf}
            actions={
              <Select aria-label="GreenFleet period" value={greenDays} onChange={(e) => setGreenDays(e.target.value)} className="h-8 w-36 text-[13px]">
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </Select>
            }
          >
            {green.loading ? (
              <SkeletonText lines={4} />
            ) : green.error || !green.data ? (
              <ErrorState message={green.error ?? "Unavailable"} onRetry={green.reload} />
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Figure term="CO₂, estimated" value={fmtNum(green.data.totals.estCo2Kg, "kg")} note="From planned trip distance" />
                  <Figure term="CO₂ from logged fuel" value={fmtNum(green.data.totals.loggedCo2Kg, "kg")} note="Logged quantity × factor" />
                  <Figure term="Operating cost, estimated" value={fmtMoney(green.data.totals.estCost)} note="Fuel + driver time" />
                  <Figure term="Fuel spend, logged" value={fmtMoney(green.data.totals.loggedFuelCost)} note="Sum of fuel records" />
                </dl>
                <Link href="/greenfleet" className="mt-4 inline-block text-xs font-medium text-brand-700 hover:underline">Per-vehicle breakdown in GreenFleet</Link>
              </>
            )}
          </Card>
        )}

        <Card title="Recent OptiRoute runs" icon={Route} actions={<Link href="/optiroute" className="text-xs font-medium text-brand-700 hover:underline">Open OptiRoute</Link>}>
          <DataTable
            rows={data.recentRuns}
            columns={runColumns}
            rowKey={(r) => r.id}
            caption="Recent optimisation runs"
            empty={{ title: "No optimisation runs yet", icon: Route, description: "Runs appear here after you plan routes in OptiRoute." }}
          />
        </Card>
      </div>
    </div>
  );
}

function sum(m: Record<string, number> | undefined) {
  return Object.values(m ?? {}).reduce((a, b) => a + b, 0);
}

function Figure({ term, value, note }: { term: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted">{term}</dt>
      <dd className="tabular mt-0.5 text-lg font-semibold text-ink">{value}</dd>
      <dd className="truncate text-xs text-subtle">{note}</dd>
    </div>
  );
}
