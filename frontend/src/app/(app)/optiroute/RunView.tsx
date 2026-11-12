"use client";

import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Gauge, IndianRupee, Leaf, MapPinned, Package, Truck } from "lucide-react";
import { useState } from "react";
import { MapLegend, RouteMap, routeColor, type MapLine, type MapPoint } from "@/components/RouteMap";
import { Badge, BarList, Card, EmptyState, LineChart, Meter, Stat, Table, Tabs, Td } from "@/components/ds";
import { fmtDateTime, fmtMinutes, fmtMoney, fmtNum, FUEL_UNIT, humanize } from "@/lib/format";
import type { RunResult } from "@/lib/types";

export function RunMap({ result, height }: { result: RunResult; height?: number }) {
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
      <RouteMap points={points} lines={lines} height={height} />
      <MapLegend />
    </>
  );
}

const OBJECTIVE_TERMS = ["time", "distance", "cost", "emissions", "lateness", "risk", "unservedPenalty"] as const;

export function ObjectiveBars({ objective }: { objective: RunResult["objective"] }) {
  return (
    <div>
      <BarList
        label="Objective breakdown by term"
        rows={OBJECTIVE_TERMS.map((k) => ({ key: k, label: k === "unservedPenalty" ? "Unserved penalty" : humanize(k), value: objective[k] }))}
        format={(v) => fmtNum(v)}
      />
      <div className="mt-3 flex justify-between border-t border-line pt-2 text-sm font-semibold text-ink">
        <span>Total J (lower is better)</span>
        <span className="tabular">{fmtNum(objective.total)}</span>
      </div>
    </div>
  );
}

/** Honest framing of what a heuristic result means. */
export function HeuristicNote({ result }: { result: RunResult }) {
  return (
    <p className="text-xs text-muted">
      Best plan found by <span className="font-medium text-ink">{humanize(result.algorithm)}</span> in {fmtNum(result.iterations)} iterations (seed {result.seed}, {result.runtimeMs} ms). This is a heuristic: plans marked feasible satisfy every hard
      constraint, but a lower-cost plan may exist.
    </p>
  );
}

export function RunDetails({ result }: { result: RunResult }) {
  const [tab, setTab] = useState("overview");
  const issues = result.unserved.length + result.exclusions.length + result.violations.length;
  const total = result.totals.servedOrders + result.unserved.length;
  return (
    <div className="space-y-5">
      <section aria-label="Plan totals" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Orders served" icon={Package} value={`${result.totals.servedOrders}/${total}`} hint={result.unserved.length ? `${result.unserved.length} unserved` : "All served"} />
        <Stat label="Vehicles used" icon={Truck} value={result.totals.vehiclesUsed} />
        <Stat label="Distance" icon={MapPinned} value={fmtNum(result.totals.distanceKm, "km")} hint={humanize(result.distanceSource)} />
        <Stat label="Route time" icon={Clock} value={fmtMinutes(result.totals.durationMin)} hint={result.totals.waitingMin > 0.5 ? `incl. ${fmtMinutes(result.totals.waitingMin)} waiting` : "Driving + service"} />
        <Stat label="Operating cost" icon={IndianRupee} value={fmtMoney(result.totals.operatingCost)} hint="Estimate" />
        <Stat label="CO₂" icon={Leaf} value={fmtNum(result.totals.co2Kg, "kg")} hint="Estimate, not measured" />
      </section>

      <Tabs
        label="Run sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "routes", label: "Routes", count: result.routes.length },
          { id: "issues", label: "Unserved & exclusions", count: issues },
          { id: "assumptions", label: "Assumptions" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card title="Routes map" icon={MapPinned}>
            {result.routes.length ? <RunMap result={result} height={380} /> : <EmptyState compact icon={CircleSlash} title="No routes in this plan" />}
          </Card>
          <div className="space-y-5">
            <Card title="Feasibility" icon={result.feasible ? CheckCircle2 : AlertTriangle}>
              {result.feasible ? (
                <Badge color="green" dot>All hard constraints satisfied · independently validated</Badge>
              ) : (
                <ul className="space-y-1.5 text-sm text-danger-700">
                  {result.violations.map((v, i) => (
                    <li key={i}>
                      <span className="font-medium">{humanize(v.code)}:</span> {v.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <HeuristicNote result={result} />
              </div>
            </Card>
            <Card title="Vehicle utilisation" icon={Gauge} description="Peak load as a share of capacity">
              {result.routes.length === 0 ? (
                <p className="text-sm text-muted">No vehicle was used.</p>
              ) : (
                <div className="space-y-3">
                  {result.routes.map((r, i) => (
                    <div key={r.vehicleId} className="flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: routeColor(i) }} />
                      <div className="min-w-0 flex-1">
                        <Meter label={`${r.vehicleLabel} · ${fmtNum(r.metrics.distanceKm, "km")}`} value={r.metrics.utilizationPct} max={100} warnAt={0.95} percentOnly />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <Card title="Objective breakdown" description="Weighted terms of the objective J">
            <ObjectiveBars objective={result.objective} />
          </Card>
          <Card title="Search progress" description="Best objective found by iteration">
            <LineChart label="Best objective J" xLabel="Iteration" points={result.convergence.map((c) => ({ x: c.iteration, y: c.best }))} format={(v) => fmtNum(v)} />
          </Card>
        </div>
      )}

      {tab === "routes" && (result.routes.length === 0 ? <EmptyState icon={Truck} title="No routes in this plan" /> : <RouteTables result={result} />)}

      {tab === "issues" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title={`Unserved orders (${result.unserved.length})`} icon={Package}>
            {result.unserved.length === 0 ? (
              <p className="text-sm text-muted">Every selected order was placed on a route.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {result.unserved.map((u) => (
                  <li key={u.orderId} className="py-2">
                    <span className="font-medium text-ink">{u.label}</span>
                    <span className="block text-muted">{u.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Excluded vehicles & drivers (${result.exclusions.length})`} icon={Truck} description="Not eligible at plan start">
            {result.exclusions.length === 0 ? (
              <p className="text-sm text-muted">Every selected vehicle and paired driver was eligible.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {result.exclusions.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 py-2">
                    <Badge>{humanize(e.kind)}</Badge>
                    <span>
                      <span className="font-medium text-ink">{e.label}</span>
                      <span className="block text-muted">{e.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {result.violations.length > 0 && (
            <Card title={`Constraint violations (${result.violations.length})`} icon={AlertTriangle} className="lg:col-span-2">
              <ul className="space-y-1 text-sm text-danger-700">
                {result.violations.map((v, i) => (
                  <li key={i}>
                    <span className="font-medium">{humanize(v.code)}:</span> {v.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === "assumptions" && (
        <Card title="Assumptions behind this plan">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Plan start {fmtDateTime(result.planStart)} · distances: {humanize(result.distanceSource)} · fuel units: {Object.entries(FUEL_UNIT).map(([k, v]) => `${humanize(k).toLowerCase()} ${v}`).join(", ")}.
          </p>
        </Card>
      )}
    </div>
  );
}

function RouteTables({ result }: { result: RunResult }) {
  const at = (min: number) => fmtDateTime(new Date(new Date(result.planStart).getTime() + min * 60000));
  return (
    <div className="space-y-5">
      {result.routes.map((r, i) => (
        <Card
          key={r.vehicleId}
          title={
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: routeColor(i) }} />
              {r.vehicleLabel} · {r.driverName ?? `driver #${r.driverId}`}
            </span>
          }
          description={`${fmtNum(r.metrics.distanceKm, "km")} · ${fmtMinutes(r.metrics.durationMin)} · peak load ${fmtNum(r.metrics.utilizationPct)}% · ${fmtMoney(r.metrics.operatingCost)} · ${fmtNum(r.metrics.co2Kg, "kg CO₂")} (estimates)`}
        >
          <Table head={["#", "Stop", "Order", "Arrive", "Wait", "Load after", "Leg"]} caption={`Stops for ${r.vehicleLabel}`}>
            {r.stops.map((s) => {
              const o = s.orderId != null ? result.orders[s.orderId] : null;
              return (
                <tr key={s.sequence}>
                  <Td className="tabular text-muted">{s.sequence}</Td>
                  <Td>
                    <span className="font-medium text-ink">{humanize(s.type)}</span>
                    <div className="text-xs text-muted">{result.locations[s.locationId]?.name}</div>
                  </Td>
                  <Td className="text-xs">
                    {o ? (
                      <>
                        <span className="whitespace-nowrap">{o.label}</span> {o.virtual && <Badge color="violet">Simulated</Badge>}
                        <div className="text-muted">{fmtNum(o.weightKg, "kg")}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {at(s.arrivalMin)}
                    {s.latenessMin > 0.5 && <div className="text-danger-700">{fmtMinutes(s.latenessMin)} late</div>}
                  </Td>
                  <Td className="tabular whitespace-nowrap text-xs">{s.waitMin > 0.5 ? fmtMinutes(s.waitMin) : "—"}</Td>
                  <Td className="tabular whitespace-nowrap text-xs">{fmtNum(s.loadAfterKg, "kg")}</Td>
                  <Td className="tabular whitespace-nowrap text-xs">{fmtNum(s.legDistanceKm, "km")}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      ))}
    </div>
  );
}
