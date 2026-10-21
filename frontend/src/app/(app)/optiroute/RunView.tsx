"use client";

import { MapLegend, RouteMap, routeColor, type MapLine, type MapPoint } from "@/components/RouteMap";
import { Badge, Card, Stat, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtMinutes, fmtMoney, fmtNum, FUEL_UNIT, humanize } from "@/lib/format";
import type { RunResult } from "@/lib/types";

export function RunMap({ result }: { result: RunResult }) {
  const points: MapPoint[] = [];
  const lines: MapLine[] = result.routes.map((r, i) => {
    const pts = r.stops.map((s) => {
      const l = result.locations[s.locationId];
      points.push({ lat: l.lat, lng: l.lng, kind: s.type.startsWith("DEPOT") ? "depot" : s.type === "PICKUP" ? "pickup" : "drop", label: s.type === "DEPOT_START" ? l.name : undefined });
      return l;
    });
    return { points: pts, color: routeColor(i), label: r.vehicleLabel };
  });
  return (
    <>
      <RouteMap points={points} lines={lines} />
      <MapLegend />
    </>
  );
}

export function ObjectiveBars({ objective }: { objective: RunResult["objective"] }) {
  const parts = (["time", "distance", "cost", "emissions", "lateness", "risk", "unservedPenalty"] as const).map((k) => ({ k, v: objective[k] }));
  const total = Math.max(1, parts.reduce((a, p) => a + p.v, 0));
  return (
    <div className="space-y-1.5">
      {parts.map((p) => (
        <div key={p.k} className="grid grid-cols-[110px_1fr_80px] items-center gap-2 text-xs">
          <span className="text-muted">{p.k === "unservedPenalty" ? "Unserved penalty" : humanize(p.k)}</span>
          <div className="h-2 rounded bg-canvas"><div className="h-2 rounded bg-brand-500" style={{ width: `${(p.v / total) * 100}%` }} /></div>
          <span className="tabular text-right">{fmtNum(p.v)}</span>
        </div>
      ))}
      <div className="grid grid-cols-[110px_1fr_80px] gap-2 border-t border-line pt-1.5 text-xs font-semibold"><span>Total J</span><span /><span className="tabular text-right">{fmtNum(objective.total)}</span></div>
    </div>
  );
}

export function RunDetails({ result }: { result: RunResult }) {
  const at = (min: number) => fmtDateTime(new Date(new Date(result.planStart).getTime() + min * 60000));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Served" value={`${result.totals.servedOrders}/${result.totals.servedOrders + result.unserved.length}`} />
        <Stat label="Vehicles used" value={result.totals.vehiclesUsed} />
        <Stat label="Distance" value={fmtNum(result.totals.distanceKm, "km")} hint={humanize(result.distanceSource)} />
        <Stat label="Route time" value={fmtMinutes(result.totals.durationMin)} />
        <Stat label="Est. cost" value={fmtMoney(result.totals.operatingCost)} />
        <Stat label="Est. CO₂" value={fmtNum(result.totals.co2Kg, "kg")} hint="Estimate" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Routes map"><RunMap result={result} /></Card>
        <div className="space-y-5">
          <Card title="Objective breakdown"><ObjectiveBars objective={result.objective} /></Card>
          <Card title="Feasibility">
            {result.feasible ? <Badge color="green">All hard constraints satisfied (independently validated)</Badge> : (
              <ul className="space-y-1 text-sm text-red-700">{result.violations.map((v, i) => <li key={i}>{v.code}: {v.message}</li>)}</ul>
            )}
            <p className="mt-2 text-xs text-muted">{humanize(result.algorithm)} · seed {result.seed} · {result.iterations} iterations · {result.runtimeMs} ms</p>
          </Card>
        </div>
      </div>

      {result.routes.map((r, i) => (
        <Card key={r.vehicleId} title={<span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: routeColor(i) }} />{r.vehicleLabel} · {r.driverName ?? `driver #${r.driverId}`}</span>}
          actions={<span className="text-xs text-muted">{fmtNum(r.metrics.distanceKm, "km")} · {fmtMinutes(r.metrics.durationMin)} · peak load {fmtNum(r.metrics.utilizationPct)}% · {fmtMoney(r.metrics.operatingCost)} · {fmtNum(r.metrics.co2Kg, "kg CO₂")}</span>}>
          <Table head={["#", "Stop", "Order", "Arrive", "Service", "Wait", "Load after", "Leg km"]}>
            {r.stops.map((s) => (
              <tr key={s.sequence}>
                <Td>{s.sequence}</Td>
                <Td><span className="font-medium">{humanize(s.type)}</span><div className="text-xs text-muted">{result.locations[s.locationId]?.name}</div></Td>
                <Td className="text-xs">{s.orderId != null ? <>{result.orders[s.orderId]?.label}{result.orders[s.orderId]?.virtual && <Badge color="violet">simulated</Badge>}</> : "—"}</Td>
                <Td className="text-xs">{at(s.arrivalMin)}</Td>
                <Td className="text-xs">{at(s.serviceStartMin)}</Td>
                <Td className="tabular text-xs">{s.waitMin > 0.5 ? fmtMinutes(s.waitMin) : "—"}</Td>
                <Td className="tabular text-xs">{fmtNum(s.loadAfterKg, "kg")}</Td>
                <Td className="tabular text-xs">{fmtNum(s.legDistanceKm)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Unserved orders (${result.unserved.length})`}>
          {result.unserved.length === 0 ? <p className="text-sm text-muted">Every order was served.</p> : (
            <ul className="space-y-2 text-sm">{result.unserved.map((u) => <li key={u.orderId}><span className="font-medium">{u.label}</span> — {u.reason}</li>)}</ul>
          )}
        </Card>
        <Card title={`Excluded vehicles & drivers (${result.exclusions.length})`}>
          {result.exclusions.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="space-y-2 text-sm">{result.exclusions.map((e, i) => <li key={i}><Badge>{e.kind}</Badge> <span className="font-medium">{e.label}</span> — {e.reason}</li>)}</ul>
          )}
        </Card>
      </div>
      <Card title="Assumptions">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">Fuel unit per vehicle: {Object.entries(FUEL_UNIT).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ")}.</p>
      </Card>
    </div>
  );
}
