"use client";

import { AlertTriangle, CheckCircle2, GitCompareArrows, Info, Package, Play, RotateCcw, Route, SlidersHorizontal, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DateTimeInput } from "@/components/forms";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Field,
  Input,
  LinkButton,
  ListCard,
  Loading,
  Meter,
  PageHeader,
  SearchInput,
  Select,
  StatusBadge,
  Switch,
  Tabs,
  TableSkeleton,
  cx,
  type Column,
} from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum, humanize } from "@/lib/format";
import type { Order, RunSummary, Vehicle, Weights } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { preflight, type Check } from "./preflight";

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
  emissions: "per kg CO₂ (estimate)",
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
  const { can } = useAuth();
  const runs = useApi<RunSummary[]>("/optiroute/runs");
  const [tab, setTab] = useState(can("optimize:run") ? "plan" : "history");
  return (
    <div className="space-y-5">
      <PageHeader
        title="OptiRoute"
        subtitle="Plan which vehicle serves which orders, in what sequence, without breaking capacity, precedence, time-window, shift or eligibility constraints."
      />
      <Tabs
        label="OptiRoute sections"
        value={tab}
        onChange={setTab}
        tabs={[...(can("optimize:run") ? [{ id: "plan", label: "New plan" }] : []), { id: "history", label: "Run history", count: runs.data?.length }]}
      />
      {tab === "plan" && can("optimize:run") ? <Planner /> : <History runs={runs} />}
    </div>
  );
}

/* ─── Planner ─────────────────────────────────────────────────────────────── */

function Planner() {
  const router = useRouter();
  const { me } = useAuth();
  const meta = useApi<Meta>("/optiroute/meta");
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
  const [orderQuery, setOrderQuery] = useState("");
  const [priority, setPriority] = useState("");

  const allOrders = useMemo(() => orders.data ?? [], [orders.data]);
  const allVehicles = useMemo(() => vehicles.data ?? [], [vehicles.data]);
  const chosenOrders = orderSel ?? allOrders.map((o) => o.id);
  const chosenVehicles = vehicleSel ?? allVehicles.map((v) => v.id);
  const visibleOrders = allOrders.filter(
    (o) => (!priority || o.priority === priority) && (!orderQuery || `${o.orderNumber} ${o.customerName} ${o.pickupLocation?.name} ${o.dropLocation?.name}`.toLowerCase().includes(orderQuery.toLowerCase())),
  );

  const checks = preflight({
    orders: allOrders.filter((o) => chosenOrders.includes(o.id)),
    vehicles: allVehicles.filter((v) => chosenVehicles.includes(v.id)),
    hardTimeWindows,
    planStart,
  });
  const load = allOrders.filter((o) => chosenOrders.includes(o.id)).reduce((a, o) => a + o.weightKg, 0);
  const capacity = allVehicles.filter((v) => chosenVehicles.includes(v.id)).reduce((a, v) => a + v.capacityKg, 0);
  const blocking = checks.some((c) => c.level === "error");

  if (meta.loading) return <Loading label="Loading planner…" />;
  if (meta.error || !meta.data) return <ErrorState message={meta.error ?? "Planner unavailable"} onRetry={meta.reload} />;

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

  const setOrders = (ids: number[]) => setOrderSel([...new Set(ids)]);
  const orderColumns: Array<Column<Order>> = [
    {
      key: "sel",
      header: <span className="sr-only">Include</span>,
      cell: (o) => <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Include ${o.orderNumber}`} checked={chosenOrders.includes(o.id)} onChange={(e) => setOrders(e.target.checked ? [...chosenOrders, o.id] : chosenOrders.filter((x) => x !== o.id))} />,
    },
    { key: "order", header: "Order", cell: (o) => <span className="whitespace-nowrap font-medium text-ink">{o.orderNumber}</span>, sortValue: (o) => o.orderNumber },
    { key: "route", header: "Route", cell: (o) => <span className="text-xs">{o.pickupLocation?.name} → {o.dropLocation?.name}<span className="block text-muted">{o.customerName}</span></span>, hideBelow: "sm" },
    { key: "kg", header: "Weight", align: "right", cell: (o) => fmtNum(o.weightKg, "kg"), sortValue: (o) => o.weightKg },
    { key: "priority", header: "Priority", cell: (o) => <StatusBadge status={o.priority} />, sortValue: (o) => ["URGENT", "HIGH", "NORMAL", "LOW"].indexOf(o.priority) },
    { key: "window", header: "Deliver by", cell: (o) => <span className="whitespace-nowrap text-xs">{o.windowEnd ? fmtDateTime(o.windowEnd) : "Any time"}</span>, sortValue: (o) => o.windowEnd, hideBelow: "md" },
  ];
  const vehicleColumns: Array<Column<Vehicle>> = [
    {
      key: "sel",
      header: <span className="sr-only">Include</span>,
      cell: (v) => <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Include ${v.registrationNumber}`} checked={chosenVehicles.includes(v.id)} onChange={(e) => setVehicleSel(e.target.checked ? [...chosenVehicles, v.id] : chosenVehicles.filter((x) => x !== v.id))} />,
    },
    { key: "reg", header: "Vehicle", cell: (v) => <span className="whitespace-nowrap font-medium text-ink">{v.registrationNumber}<span className="block text-xs font-normal text-muted">{humanize(v.type)}</span></span>, sortValue: (v) => v.registrationNumber },
    { key: "cap", header: "Capacity", align: "right", cell: (v) => fmtNum(v.capacityKg, "kg"), sortValue: (v) => v.capacityKg },
    { key: "fuel", header: "Fuel", cell: (v) => humanize(v.fuelType), hideBelow: "sm" },
    { key: "depot", header: "Depot", cell: (v) => (v.depotLocation ? v.depotLocation.name : <Badge color="amber">No depot — excluded</Badge>) },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Step n={1} title="Orders" icon={Package} description={`${chosenOrders.length} of ${allOrders.length} pending orders selected · ${fmtNum(load, "kg")}`}>
          {orders.loading ? (
            <TableSkeleton rows={3} />
          ) : orders.error ? (
            <ErrorState message={orders.error} onRetry={orders.reload} />
          ) : allOrders.length === 0 ? (
            <p className="text-sm text-muted">
              No pending orders. <Link className="font-medium text-brand-700 hover:underline" href="/orders?new=1">Create an order</Link> first.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <SearchInput value={orderQuery} onChange={setOrderQuery} placeholder="Search orders, customers, places…" label="Search pending orders" />
                <Select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="sm:w-40">
                  <option value="">All priorities</option>
                  {["URGENT", "HIGH", "NORMAL", "LOW"].map((p) => (
                    <option key={p} value={p}>{humanize(p)}</option>
                  ))}
                </Select>
                <div className="flex gap-2 sm:ml-auto">
                  <Button size="sm" variant="secondary" onClick={() => setOrders([...chosenOrders, ...visibleOrders.map((o) => o.id)])}>Select shown</Button>
                  <Button size="sm" variant="ghost" onClick={() => setOrders(chosenOrders.filter((id) => !visibleOrders.some((o) => o.id === id)))}>Clear shown</Button>
                </div>
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                <DataTable rows={visibleOrders} columns={orderColumns} rowKey={(o) => o.id} pageSize={200} caption="Pending orders to plan" />
              </div>
            </>
          )}
        </Step>

        <Step n={2} title="Vehicles" icon={Truck} description={`${chosenVehicles.length} of ${allVehicles.length} available vehicles · ${fmtNum(capacity, "kg")} capacity`}>
          {vehicles.loading ? (
            <TableSkeleton rows={3} />
          ) : vehicles.error ? (
            <ErrorState message={vehicles.error} onRetry={vehicles.reload} />
          ) : allVehicles.length === 0 ? (
            <p className="text-sm text-muted">No vehicles are available. Vehicles on a trip, in maintenance or inactive can’t be planned.</p>
          ) : (
            <>
              <DataTable rows={allVehicles} columns={vehicleColumns} rowKey={(v) => v.id} pageSize={200} caption="Available vehicles to plan" />
              <p className="mt-2 text-xs text-muted">Drivers are paired automatically from available drivers whose licence is valid at plan start.</p>
            </>
          )}
        </Step>

        <Step n={3} title="Constraints & objective" icon={SlidersHorizontal}>
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium text-ink">Algorithm</legend>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {meta.data.algorithms.map((a) => (
                <label key={a.id} className={cx("cursor-pointer rounded-lg border p-3 transition-colors", algorithm === a.id ? "border-brand-600 bg-brand-50/60 ring-1 ring-brand-600" : "border-line hover:border-line-strong")}>
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input type="radio" name="algorithm" value={a.id} checked={algorithm === a.id} onChange={() => setAlgorithm(a.id)} className="accent-brand-600" />
                    {a.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted">{a.description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Plan name" hint="Optional">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning wave" />
            </Field>
            <Field label="Plan start" hint="Time windows are measured from here (default: now + 15 min)">
              <div className="flex flex-wrap gap-2">
                <div className="min-w-[12rem] flex-1">
                  <DateTimeInput value={planStart} onChange={setPlanStart} />
                </div>
                <Button variant="secondary" onClick={() => setPlanStart(tomorrowAt8())}>
                  Tomorrow 08:00
                </Button>
              </div>
            </Field>
            <Field label="Seed" hint="Same seed and inputs give the same result">
              <Input type="number" min={0} value={seed} onChange={(e) => setSeed(e.target.value)} />
            </Field>
            <Field label="Iteration budget" hint="Ignored by greedy insertion; 0–5000">
              <Input type="number" min={0} max={5000} value={maxIterations} onChange={(e) => setMaxIterations(e.target.value)} />
            </Field>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Switch checked={hardTimeWindows} onChange={setHard} label="Hard delivery windows" description="Off: lateness is allowed and penalised" />
            <Switch checked={returnToDepot} onChange={setReturn} label="Return to depot" description="Routes end at the start depot" />
            <Switch checked={useRoadNetwork} onChange={setUseRoad} label="Use road network" description="Off: straight-line × 1.3 estimate" />
          </div>

          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium text-ink">Objective weights</h3>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setWeights(me.company.settings.defaultWeights)}>
              Company defaults
            </Button>
          </div>
          <p className="mb-3 break-words font-mono text-xs text-muted">{meta.data.objective}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(WEIGHT_HELP) as Array<keyof Weights>).map((k) => (
              <Field key={k} label={humanize(k)} hint={WEIGHT_HELP[k]}>
                <Input type="number" min={0} step="any" value={weights[k]} onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} />
              </Field>
            ))}
          </div>
        </Step>

        <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur xl:hidden" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
          <p className="min-w-0 flex-1 text-xs text-muted">
            <span className="font-medium text-ink">{chosenOrders.length} orders</span> · {chosenVehicles.length} vehicles
            {checks.some((c) => c.level === "warning") && <span className="block text-warning-700">Review warnings in the summary below</span>}
          </p>
          <Button icon={Play} loading={busy} disabled={blocking} onClick={run}>
            {busy ? "Optimising…" : "Optimise"}
          </Button>
        </div>
      </div>

      <aside aria-label="Plan summary" className="min-w-0 xl:sticky xl:top-20 xl:self-start">
        <Card title="Plan summary" icon={Route}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Orders</dt>
              <dd className="tabular text-lg font-semibold text-ink">{chosenOrders.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Vehicles</dt>
              <dd className="tabular text-lg font-semibold text-ink">{chosenVehicles.length}</dd>
            </div>
          </dl>
          <div className="mt-3">
            <Meter label="Selected load vs combined capacity" value={load} max={capacity} warnAt={0.85} format={(v) => fmtNum(v, "kg")} />
          </div>
          <ul className="mt-4 space-y-2" aria-label="Pre-flight checks">
            {checks.map((c, i) => (
              <CheckRow key={i} check={c} />
            ))}
          </ul>
          {err && (
            <div className="mt-4">
              <Alert title="Optimisation failed">
                {err}
                <div className="mt-2">
                  <Button size="sm" variant="secondary" icon={RotateCcw} onClick={run}>
                    Retry
                  </Button>
                </div>
              </Alert>
            </div>
          )}
          <Button className="mt-4 w-full" size="lg" icon={Play} loading={busy} disabled={blocking} onClick={run}>
            {busy ? "Optimising…" : "Optimise routes"}
          </Button>
          {busy && <p role="status" className="mt-2 text-center text-xs text-muted">Larger plans can take several seconds.</p>}
          <details className="mt-4 text-xs text-muted">
            <summary className="cursor-pointer font-medium text-ink">Hard constraints ({meta.data.hardConstraints.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {meta.data.hardConstraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        </Card>
      </aside>
    </div>
  );
}

function Step({ n, title, icon, description, children }: { n: number; title: string; icon: typeof Route; description?: string; children: ReactNode }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">{n}</span>
          {title}
        </span>
      }
      description={description}
      icon={icon}
    >
      {children}
    </Card>
  );
}

const CHECK_ICON = { error: XCircle, warning: AlertTriangle, info: Info, ok: CheckCircle2 } as const;
const CHECK_CLS = { error: "text-danger-600", warning: "text-warning-600", info: "text-info-600", ok: "text-success-600" } as const;

function CheckRow({ check }: { check: Check }) {
  const Icon = CHECK_ICON[check.level];
  return (
    <li className="flex gap-2 text-xs">
      <Icon size={14} aria-hidden className={cx("mt-px shrink-0", CHECK_CLS[check.level])} />
      <span className="text-ink">
        <span className="sr-only">{check.level}: </span>
        {check.message}
      </span>
    </li>
  );
}

/* ─── History ─────────────────────────────────────────────────────────────── */

function History({ runs }: { runs: ReturnType<typeof useApi<RunSummary[]>> }) {
  const [compare, setCompare] = useState<number[]>([]);
  if (runs.loading) return <TableSkeleton />;
  if (runs.error) return <ErrorState message={runs.error} onRetry={runs.reload} />;
  const columns: Array<Column<RunSummary>> = [
    {
      key: "cmp",
      header: <span className="sr-only">Compare</span>,
      cell: (r) => (
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand-600"
          aria-label={`Select run #${r.id} for comparison`}
          checked={compare.includes(r.id)}
          onChange={(e) => setCompare((c) => (e.target.checked ? [...c, r.id].slice(-2) : c.filter((x) => x !== r.id)))}
        />
      ),
    },
    { key: "run", header: "Run", cell: (r) => <Link href={`/optiroute/runs/${r.id}`} className="font-medium text-brand-700 hover:underline">#{r.id} {r.name}</Link>, sortValue: (r) => r.id },
    { key: "algo", header: "Algorithm", cell: (r) => <span className="whitespace-nowrap">{humanize(r.algorithm)}</span>, sortValue: (r) => r.algorithm, hideBelow: "md" },
    { key: "feasible", header: "Result", cell: (r) => (r.feasible ? <Badge color="green" dot>Feasible</Badge> : <Badge color="red" dot>Infeasible</Badge>), sortValue: (r) => (r.feasible ? 0 : 1) },
    { key: "unserved", header: "Unserved", align: "right", cell: (r) => r.unservedCount, sortValue: (r) => r.unservedCount },
    { key: "km", header: "Distance", align: "right", cell: (r) => fmtNum(r.totalDistanceKm, "km"), sortValue: (r) => r.totalDistanceKm, hideBelow: "sm" },
    { key: "cost", header: "Est. cost", align: "right", cell: (r) => fmtMoney(r.totalCost), sortValue: (r) => r.totalCost, hideBelow: "lg" },
    { key: "co2", header: "Est. CO₂", align: "right", cell: (r) => fmtNum(r.totalCo2Kg, "kg"), sortValue: (r) => r.totalCo2Kg, hideBelow: "lg" },
    { key: "obj", header: "Objective", align: "right", cell: (r) => fmtNum(r.objective), sortValue: (r) => r.objective, hideBelow: "md" },
    { key: "created", header: "Created", cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span>, sortValue: (r) => r.createdAt, hideBelow: "md" },
    { key: "trips", header: "Trips", cell: (r) => (r.dispatchedAt ? <Badge color="blue">Created</Badge> : <span className="text-muted">—</span>), hideBelow: "sm" },
  ];
  return (
    <div className="space-y-3">
      <DataTable
        rows={runs.data ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        searchText={(r) => `#${r.id} ${r.name ?? ""} ${r.algorithm}`}
        searchPlaceholder="Search runs…"
        initialSort={{ key: "run", dir: "desc" }}
        caption="OptiRoute run history"
        mobileCard={(r) => (
          <ListCard
            title={<Link href={`/optiroute/runs/${r.id}`} className="font-medium text-brand-700 hover:underline">#{r.id} {r.name ?? humanize(r.algorithm)}</Link>}
            status={r.feasible ? <Badge color="green" dot>Feasible</Badge> : <Badge color="red" dot>Infeasible</Badge>}
            subtitle={`${humanize(r.algorithm)} · ${fmtDateTime(r.createdAt)}`}
            details={[
              ["Unserved", r.unservedCount],
              ["Distance", fmtNum(r.totalDistanceKm, "km")],
              ["Est. cost", fmtMoney(r.totalCost)],
              ["Trips", r.dispatchedAt ? "Created" : "Not yet"],
            ]}
            actions={columns[0].cell(r)}
          />
        )}
        toolbar={
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-xs text-muted">{compare.length}/2 selected</span>
            {compare.length === 2 ? (
              <LinkButton href={`/optiroute/compare?a=${compare[0]}&b=${compare[1]}`} variant="secondary" size="sm" icon={GitCompareArrows}>
                Compare selected
              </LinkButton>
            ) : (
              <Button variant="secondary" size="sm" icon={GitCompareArrows} disabled title="Select two runs to compare">
                Compare selected
              </Button>
            )}
          </div>
        }
        empty={{ title: "No runs yet", icon: Route, description: "Optimise a plan to see it here." }}
      />
    </div>
  );
}
