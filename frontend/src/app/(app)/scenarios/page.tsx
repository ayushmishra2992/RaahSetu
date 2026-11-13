"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DateTimeInput, FormShell } from "@/components/forms";
import { Alert, Card, Checkbox, DataTable, ErrorState, Field, Input, ListCard, Loading, PageHeader, Select, StatusBadge, TableSkeleton, Tabs, type Column } from "@/components/ds";
import { api } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { Driver, Location, RoadEdge, RoadNode, RunSummary, Scenario, Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const TYPES = [
  ["VEHICLE_BREAKDOWN", "Vehicle breakdown", "A vehicle in the plan becomes unavailable"],
  ["DRIVER_UNAVAILABLE", "Driver unavailable", "A driver can't work this plan"],
  ["ROAD_CLOSURE", "Road closure", "One or more road segments close"],
  ["URGENT_ORDER", "Urgent order arrives", "A new urgent order must fit in"],
] as const;
type ScenarioType = (typeof TYPES)[number][0];

function NewScenario() {
  const router = useRouter();
  const params = useSearchParams();
  const runs = useApi<RunSummary[]>("/optiroute/runs");
  const vehicles = useApi<Vehicle[]>("/vehicles");
  const drivers = useApi<Driver[]>("/drivers");
  const locations = useApi<Location[]>("/locations");
  const network = useApi<{ nodes: RoadNode[]; edges: RoadEdge[] }>("/road-network");
  const [type, setType] = useState<ScenarioType>("VEHICLE_BREAKDOWN");
  const [name, setName] = useState("");
  const [baseRunId, setBaseRunId] = useState(params.get("baseRunId") ?? "");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [edgeIds, setEdgeIds] = useState<number[]>([]);
  const [urgent, setUrgent] = useState({ customerName: "", pickupLocationId: "", dropLocationId: "", weightKg: "", serviceMinutes: "20" });
  const [win, setWin] = useState<{ windowStart: string | null; windowEnd: string | null }>({ windowStart: null, windowEnd: null });
  const nodeName = new Map((network.data?.nodes ?? []).map((n) => [n.id, n.name]));
  const openEdges = (network.data?.edges ?? []).filter((e) => !e.isClosed);

  return (
    <Card title="Simulate a disruption" icon={FlaskConical} description="Re-plans a past OptiRoute run with the disruption applied. Nothing changes in your data until a manager approves.">
      <FormShell
        submitLabel="Evaluate scenario"
        onSubmit={async () => {
          if (!baseRunId) throw new Error("Choose the base plan to re-plan.");
          if (type === "ROAD_CLOSURE" && edgeIds.length === 0) throw new Error("Select at least one road segment to close.");
          if (type === "URGENT_ORDER") {
            if (urgent.pickupLocationId && urgent.pickupLocationId === urgent.dropLocationId) throw new Error("Pickup and drop must be different locations.");
            if (win.windowStart && win.windowEnd && new Date(win.windowEnd) <= new Date(win.windowStart)) throw new Error("Window end must be after window start.");
          }
          const p =
            type === "VEHICLE_BREAKDOWN"
              ? { vehicleId: Number(vehicleId) }
              : type === "DRIVER_UNAVAILABLE"
                ? { driverId: Number(driverId) }
                : type === "ROAD_CLOSURE"
                  ? { edgeIds }
                  : { ...urgent, pickupLocationId: Number(urgent.pickupLocationId), dropLocationId: Number(urgent.dropLocationId), weightKg: Number(urgent.weightKg), serviceMinutes: Number(urgent.serviceMinutes), ...win };
          const s = await api<{ id: number }>("/scenarios", { body: { type, name: name.trim() || TYPES.find((t) => t[0] === type)![1], baseRunId: Number(baseRunId), params: p } });
          router.push(`/scenarios/${s.id}`);
        }}
      >
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-medium text-ink">Disruption</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {TYPES.map(([v, label, hint]) => (
              <label key={v} className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors ${type === v ? "border-brand-600 bg-brand-50/60 ring-1 ring-brand-600" : "border-line hover:border-line-strong"}`}>
                <span className="flex items-center gap-2 font-medium text-ink">
                  <input type="radio" name="scenario-type" value={v} checked={type === v} onChange={() => setType(v)} className="accent-brand-600" />
                  {label}
                </span>
                <span className="mt-1 block text-xs text-muted">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Base plan" required hint="Its orders and vehicles are re-optimised with the same algorithm and seed">
            <Select required value={baseRunId} onChange={(e) => setBaseRunId(e.target.value)}>
              <option value="">Select a run…</option>
              {runs.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.id} {r.name ?? humanize(r.algorithm)} ({fmtDateTime(r.createdAt)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Scenario name" hint="Optional">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MH04AB1234 clutch failure" maxLength={120} />
          </Field>
        </div>
        {type === "VEHICLE_BREAKDOWN" && (
          <Field label="Vehicle that broke down" required>
            <Select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Select…</option>
              {vehicles.data?.map((v) => (
                <option key={v.id} value={v.id}>{v.registrationNumber}</option>
              ))}
            </Select>
          </Field>
        )}
        {type === "DRIVER_UNAVAILABLE" && (
          <Field label="Driver who is unavailable" required>
            <Select required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Select…</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
        )}
        {type === "ROAD_CLOSURE" && (
          <fieldset className="min-w-0">
            <legend className="mb-1 text-sm font-medium text-ink">Road segments to close ({edgeIds.length} selected)</legend>
            {openEdges.length === 0 ? (
              <p className="text-sm text-muted">
                No open road segments. Add a road network under <Link className="text-brand-700 hover:underline" href="/locations">Locations &amp; Roads</Link>.
              </p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                {openEdges.map((e) => (
                  <Checkbox
                    key={e.id}
                    checked={edgeIds.includes(e.id)}
                    onChange={(ev) => setEdgeIds((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))}
                    label={`${nodeName.get(e.fromNodeId)} ↔ ${nodeName.get(e.toNodeId)}`}
                    description={e.name ?? undefined}
                  />
                ))}
              </div>
            )}
          </fieldset>
        )}
        {type === "URGENT_ORDER" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Customer" required>
              <Input required minLength={2} value={urgent.customerName} onChange={(e) => setUrgent((u) => ({ ...u, customerName: e.target.value }))} />
            </Field>
            <Field label="Pickup" required>
              <Select required value={urgent.pickupLocationId} onChange={(e) => setUrgent((u) => ({ ...u, pickupLocationId: e.target.value }))}>
                <option value="">Select…</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Drop" required>
              <Select required value={urgent.dropLocationId} onChange={(e) => setUrgent((u) => ({ ...u, dropLocationId: e.target.value }))}>
                <option value="">Select…</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Weight (kg)" required>
              <Input type="number" min={1} step={1} required value={urgent.weightKg} onChange={(e) => setUrgent((u) => ({ ...u, weightKg: e.target.value }))} />
            </Field>
            <Field label="Window start">
              <DateTimeInput value={win.windowStart} onChange={(v) => setWin((w) => ({ ...w, windowStart: v }))} />
            </Field>
            <Field label="Window end">
              <DateTimeInput value={win.windowEnd} onChange={(v) => setWin((w) => ({ ...w, windowEnd: v }))} />
            </Field>
          </div>
        )}
        {runs.data?.length === 0 && <Alert kind="info">Scenarios re-plan an existing OptiRoute run. Create a plan in OptiRoute first.</Alert>}
      </FormShell>
    </Card>
  );
}

function ScenariosInner() {
  const { can } = useAuth();
  const list = useApi<Scenario[]>("/scenarios");
  const [status, setStatus] = useState("all");
  const all = list.data ?? [];
  const rows = status === "all" ? all : all.filter((s) => s.status === status);
  const columns: Array<Column<Scenario>> = [
    { key: "name", header: "Scenario", sortValue: (s) => s.name, cell: (s) => <Link className="font-medium text-brand-700 hover:underline" href={`/scenarios/${s.id}`}>{s.name}</Link> },
    { key: "type", header: "Disruption", sortValue: (s) => s.type, cell: (s) => humanize(s.type), hideBelow: "md" },
    {
      key: "runs",
      header: "Plans",
      hideBelow: "lg",
      cell: (s) => (
        <span className="whitespace-nowrap text-xs">
          <Link className="text-brand-700 hover:underline" href={`/optiroute/runs/${s.baseRunId}`}>#{s.baseRunId}</Link>
          {s.resultRunId && (
            <>
              {" → "}
              <Link className="text-brand-700 hover:underline" href={`/optiroute/runs/${s.resultRunId}`}>#{s.resultRunId}</Link>
            </>
          )}
        </span>
      ),
    },
    { key: "impact", header: "Impact", cell: (s) => <span className="text-xs">{s.comparison?.summary ?? "—"}</span>, hideBelow: "sm" },
    { key: "status", header: "Status", sortValue: (s) => s.status, cell: (s) => <StatusBadge status={s.status} label={s.status === "EVALUATED" ? "Awaiting decision" : undefined} /> },
    { key: "created", header: "Created", sortValue: (s) => s.createdAt, cell: (s) => <span className="whitespace-nowrap text-xs">{fmtDateTime(s.createdAt)}</span>, hideBelow: "lg" },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Scenarios" subtitle="What-if re-planning: see how a disruption changes a plan, compare before and after, then approve or reject." />
      {can("optimize:run") && <NewScenario />}
      <Tabs
        label="Filter scenarios by status"
        value={status}
        onChange={setStatus}
        tabs={[
          { id: "all", label: "All", count: all.length },
          { id: "EVALUATED", label: "Awaiting decision", count: all.filter((s) => s.status === "EVALUATED").length },
          { id: "APPROVED", label: "Approved", count: all.filter((s) => s.status === "APPROVED").length },
          { id: "REJECTED", label: "Rejected", count: all.filter((s) => s.status === "REJECTED").length },
        ]}
      />
      {list.loading ? (
        <TableSkeleton />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(s) => s.id}
          searchText={(s) => `${s.name} ${s.type} ${s.comparison?.summary ?? ""}`}
          searchPlaceholder="Search scenarios…"
          initialSort={{ key: "created", dir: "desc" }}
          caption="Scenario history"
          mobileCard={(s) => (
            <ListCard
              title={<Link className="font-medium text-brand-700 hover:underline" href={`/scenarios/${s.id}`}>{s.name}</Link>}
              status={<StatusBadge status={s.status} label={s.status === "EVALUATED" ? "Awaiting decision" : undefined} />}
              subtitle={humanize(s.type)}
              details={[
                ["Impact", s.comparison?.summary ?? "—", true],
                ["Plans", `#${s.baseRunId}${s.resultRunId ? ` → #${s.resultRunId}` : ""}`],
                ["Created", fmtDateTime(s.createdAt)],
              ]}
            />
          )}
          empty={{ title: all.length ? "No scenarios with this status" : "No scenarios yet", icon: FlaskConical, description: all.length ? undefined : "Simulate a disruption against an OptiRoute plan to see its impact before acting." }}
        />
      )}
    </div>
  );
}

export default function ScenariosPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ScenariosInner />
    </Suspense>
  );
}
