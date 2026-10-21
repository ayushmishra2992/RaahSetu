"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DateTimeInput } from "@/components/forms";
import { Alert, Badge, Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { Order, RunSummary, Vehicle, Weights } from "@/lib/types";
import { useApi } from "@/lib/useApi";

interface Meta {
  algorithms: Array<{ id: string; label: string; description: string }>;
  defaultWeights: Weights;
  objective: string;
  hardConstraints: string[];
}

const WEIGHT_HELP: Record<keyof Weights, string> = {
  time: "per hour of route time",
  distance: "per km",
  cost: "per ₹ of fuel + driver cost",
  emissions: "per kg CO₂ (est.)",
  lateness: "per late minute (soft windows only)",
  risk: "per km × vehicle risk",
};

function tomorrowAt8() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

export default function OptiRoutePage() {
  const router = useRouter();
  const { can, me } = useAuth();
  const meta = useApi<Meta>("/optiroute/meta");
  const runs = useApi<RunSummary[]>("/optiroute/runs");
  const orders = useApi<Order[]>("/orders?status=PENDING");
  const vehicles = useApi<Vehicle[]>("/vehicles?status=AVAILABLE");
  const [algorithm, setAlgorithm] = useState("LOCAL_SEARCH");
  const [seed, setSeed] = useState("42");
  const [maxIterations, setMaxIterations] = useState("400");
  const [planStart, setPlanStart] = useState<string | null>(null);
  const [hardTimeWindows, setHard] = useState(true);
  const [returnToDepot, setReturn] = useState(true);
  const [useRoadNetwork, setUseRoad] = useState(true);
  const [weights, setWeights] = useState<Weights>(me.company.settings.defaultWeights);
  const [orderSel, setOrderSel] = useState<number[] | null>(null);
  const [vehicleSel, setVehicleSel] = useState<number[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [compare, setCompare] = useState<number[]>([]);

  if (meta.loading) return <Loading />;
  if (meta.error || !meta.data) return <ErrorState message={meta.error ?? "Unavailable"} onRetry={meta.reload} />;

  const allOrders = orders.data ?? [];
  const allVehicles = vehicles.data ?? [];
  const chosenOrders = orderSel ?? allOrders.map((o) => o.id);
  const chosenVehicles = vehicleSel ?? allVehicles.map((v) => v.id);
  const toggle = (list: number[], id: number, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: number }>("/optiroute/runs", {
        body: {
          name: name || undefined,
          algorithm,
          seed: Number(seed),
          maxIterations: Number(maxIterations),
          planStart: planStart ?? undefined,
          hardTimeWindows,
          returnToDepot,
          useRoadNetwork,
          weights,
          orderIds: chosenOrders,
          vehicleIds: chosenVehicles,
        },
      });
      router.push(`/optiroute/runs/${r.id}`);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="OptiRoute" subtitle="Constrained multi-vehicle pickup & delivery planning. Which vehicle serves which orders, in what order — without breaking hard constraints." />
      {can("optimize:run") && (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card title="Plan settings">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Algorithm" hint={meta.data.algorithms.find((a) => a.id === algorithm)?.description}>
                <Select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>{meta.data.algorithms.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select>
              </Field>
              <Field label="Plan name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning wave" /></Field>
              <Field label="Plan start" hint="Time windows are measured from here (default: now + 15 min)">
                <div className="flex gap-2"><DateTimeInput value={planStart} onChange={setPlanStart} /><Button variant="secondary" type="button" onClick={() => setPlanStart(tomorrowAt8())}>Tomorrow 08:00</Button></div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Seed" hint="Same seed → same result"><Input type="number" min={0} value={seed} onChange={(e) => setSeed(e.target.value)} /></Field>
                <Field label="Iteration budget"><Input type="number" min={0} max={5000} value={maxIterations} onChange={(e) => setMaxIterations(e.target.value)} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hardTimeWindows} onChange={(e) => setHard(e.target.checked)} /> Hard delivery time windows</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={returnToDepot} onChange={(e) => setReturn(e.target.checked)} /> Return to depot</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useRoadNetwork} onChange={(e) => setUseRoad(e.target.checked)} /> Use road network (else straight-line estimate)</label>
            </div>
            <h3 className="mt-5 text-sm font-semibold">Objective weights</h3>
            <p className="mb-2 font-mono text-xs text-muted">{meta.data.objective}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(WEIGHT_HELP) as Array<keyof Weights>).map((k) => (
                <Field key={k} label={humanize(k)} hint={WEIGHT_HELP[k]}>
                  <Input type="number" min={0} step="any" value={weights[k]} onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} />
                </Field>
              ))}
            </div>
          </Card>
          <div className="space-y-5">
            <Card title={`Orders (${chosenOrders.length}/${allOrders.length} pending)`}>
              {allOrders.length === 0 ? <p className="text-sm text-muted">No pending orders. <Link className="text-brand-700" href="/orders">Create orders</Link> first.</p> : (
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {allOrders.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={chosenOrders.includes(o.id)} onChange={(e) => setOrderSel(toggle(chosenOrders, o.id, e.target.checked))} />
                      <span className="font-medium">{o.orderNumber}</span><span className="truncate text-xs text-muted">{o.dropLocation?.name} · {o.weightKg} kg · {o.priority}</span>
                    </label>
                  ))}
                </div>
              )}
            </Card>
            <Card title={`Vehicles (${chosenVehicles.length}/${allVehicles.length} available)`}>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {allVehicles.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosenVehicles.includes(v.id)} onChange={(e) => setVehicleSel(toggle(chosenVehicles, v.id, e.target.checked))} />
                    <span className="font-medium">{v.registrationNumber}</span><span className="text-xs text-muted">{fmtNum(v.capacityKg, "kg")} · {v.fuelType}</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Drivers are paired automatically from available drivers with valid licences.</p>
            </Card>
            <Card title="Hard constraints">
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted">{meta.data.hardConstraints.map((c) => <li key={c}>{c}</li>)}</ul>
            </Card>
            {err && <Alert>{err}</Alert>}
            <Button className="w-full" loading={busy} disabled={chosenOrders.length === 0 || chosenVehicles.length === 0} onClick={run}>Optimise routes</Button>
          </div>
        </div>
      )}

      <Card title="Run history" actions={compare.length === 2 && <Link className="text-sm font-medium text-brand-700" href={`/optiroute/compare?a=${compare[0]}&b=${compare[1]}`}>Compare selected →</Link>}>
        {runs.loading ? <Loading /> : (
          <Table head={["", "Run", "Algorithm", "Seed", "Feasible", "Unserved", "Distance", "Est. cost", "Est. CO₂", "Objective", "Runtime", "Created", "Dispatched"]} empty={runs.data?.length === 0}>
            {runs.data?.map((r) => (
              <tr key={r.id}>
                <Td><input type="checkbox" aria-label="Select for comparison" checked={compare.includes(r.id)} onChange={(e) => setCompare((c) => (e.target.checked ? [...c, r.id].slice(-2) : c.filter((x) => x !== r.id)))} /></Td>
                <Td><Link href={`/optiroute/runs/${r.id}`} className="font-medium text-brand-700">#{r.id} {r.name}</Link></Td>
                <Td className="text-xs">{humanize(r.algorithm)}</Td>
                <Td>{r.seed}</Td>
                <Td>{r.feasible ? <Badge color="green">Yes</Badge> : <Badge color="red">No</Badge>}</Td>
                <Td>{r.unservedCount}</Td>
                <Td className="tabular">{fmtNum(r.totalDistanceKm, "km")}</Td>
                <Td className="tabular">{fmtMoney(r.totalCost)}</Td>
                <Td className="tabular">{fmtNum(r.totalCo2Kg, "kg")}</Td>
                <Td className="tabular">{fmtNum(r.objective)}</Td>
                <Td className="tabular">{r.runtimeMs} ms</Td>
                <Td className="text-xs">{fmtDateTime(r.createdAt)}</Td>
                <Td>{r.dispatchedAt ? <Badge color="blue">Yes</Badge> : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
