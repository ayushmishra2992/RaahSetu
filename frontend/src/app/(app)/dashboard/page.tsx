"use client";

import Link from "next/link";
import { MapLegend, RouteMap, routeColor, type MapPoint } from "@/components/RouteMap";
import { Badge, Card, ErrorState, Loading, PageHeader, Stat, StatusBadge, SyntheticNote, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtNum, humanize } from "@/lib/format";
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
  recentRuns: Array<{ id: number; name: string; algorithm: string; feasible: boolean; totalDistanceKm: number; totalCo2Kg: number; totalCost: number; unservedCount: number; createdAt: string; dispatchedAt: string | null }>;
  telemetryNote: string;
}

function Counts({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  return (
    <Card title={title}>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">None yet</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between">
              <StatusBadge status={k} />
              <span className="tabular font-medium">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ControlTowerPage() {
  const { data, error, loading, reload } = useApi<ControlTower>("/control-tower");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? "No data"} onRetry={reload} />;

  const points: MapPoint[] = [];
  const lines = data.liveTrips.map((t, i) => {
    t.route.forEach((s) => points.push({ lat: s.lat, lng: s.lng, kind: s.type.startsWith("DEPOT") ? "depot" : s.type === "PICKUP" ? "pickup" : "drop" }));
    if (t.position) points.push({ lat: t.position.lat, lng: t.position.lng, kind: "vehicle", label: t.vehicle });
    return { points: t.route, color: routeColor(i), label: t.tripNumber };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Control Tower"
        subtitle={`Snapshot at ${fmtDateTime(data.generatedAt)}`}
        actions={
          <button onClick={reload} className="rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-canvas">
            Refresh
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Fleet utilisation" value={`${data.kpis.fleetUtilizationPct}%`} hint="Vehicles on trip / active fleet" />
        <Stat label="On-time (30d)" value={data.kpis.onTimeDeliveryPct30d == null ? "—" : `${data.kpis.onTimeDeliveryPct30d}%`} hint="Completed drops within window" />
        <Stat label="Trips done (30d)" value={data.kpis.completedTrips30d} />
        <Stat label="Planned km (30d)" value={fmtNum(data.kpis.plannedKm30d)} />
        <Stat label="Est. cost (30d)" value={fmtMoney(data.kpis.estimatedCost30d)} hint="Estimate" />
        <Stat label="Est. CO₂ (30d)" value={`${fmtNum(data.kpis.estimatedCo2Kg30d)} kg`} hint="Estimate, not measured" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title={`Alerts (${data.alerts.length})`}>
          {data.alerts.length === 0 ? (
            <p className="text-sm text-muted">All clear — no expiring documents, late deliveries or pending approvals.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {data.alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <StatusBadge status={a.severity} />
                  {a.link ? (
                    <Link href={a.link} className="hover:underline">
                      {a.message}
                    </Link>
                  ) : (
                    <span>{a.message}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Counts title="Vehicles" data={data.counts.vehicles} />
          <Counts title="Drivers" data={data.counts.drivers} />
          <Counts title="Orders" data={data.counts.orders} />
          <Counts title="Trips" data={data.counts.trips} />
        </div>
      </div>

      <Card title="Active trips" actions={<Badge color="amber">Simulated positions</Badge>}>
        {data.liveTrips.length === 0 ? (
          <p className="text-sm text-muted">No dispatched or in-transit trips. Plan with OptiRoute and dispatch a trip to see it here.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <RouteMap points={points} lines={lines} />
              <MapLegend kinds={["depot", "pickup", "drop", "vehicle"]} />
            </div>
            <div className="space-y-2">
              <SyntheticNote>{data.telemetryNote}</SyntheticNote>
              {data.liveTrips.map((t, i) => (
                <Link key={t.id} href={`/trips/${t.id}`} className="block rounded-md border border-line p-3 hover:bg-canvas">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: routeColor(i) }} />
                      {t.tripNumber}
                    </span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {t.vehicle} · {t.driver} · stops {t.stopsDone}/{t.stopsTotal}
                    {t.position && ` · ${t.position.progressPct}% · next: ${t.position.nextStop ?? "—"}`}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Recent optimisation runs" actions={<Link href="/optiroute" className="text-sm font-medium text-brand-700">Open OptiRoute →</Link>}>
        {data.recentRuns.length === 0 ? (
          <p className="text-sm text-muted">No runs yet.</p>
        ) : (
          <Table head={["Run", "Algorithm", "Feasible", "Distance", "Est. cost", "Est. CO₂", "Unserved", "Created"]}>
            {data.recentRuns.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={`/optiroute/runs/${r.id}`} className="font-medium text-brand-700">
                    #{r.id} {r.name}
                  </Link>
                </Td>
                <Td>{humanize(r.algorithm)}</Td>
                <Td>{r.feasible ? <Badge color="green">Yes</Badge> : <Badge color="red">No</Badge>}</Td>
                <Td className="tabular">{fmtNum(r.totalDistanceKm, "km")}</Td>
                <Td className="tabular">{fmtMoney(r.totalCost)}</Td>
                <Td className="tabular">{fmtNum(r.totalCo2Kg, "kg")}</Td>
                <Td>{r.unservedCount}</Td>
                <Td>{fmtDateTime(r.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
