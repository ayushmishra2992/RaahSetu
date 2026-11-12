"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DateTimeInput, FormShell } from "@/components/forms";
import { Card, ErrorState, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import type { Driver, Location, RoadEdge, RoadNode, RunSummary, Scenario, Vehicle } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const TYPES = [
  ["VEHICLE_BREAKDOWN", "Vehicle breakdown"],
  ["DRIVER_UNAVAILABLE", "Driver unavailable"],
  ["ROAD_CLOSURE", "Road closure"],
  ["URGENT_ORDER", "Urgent order arrives"],
] as const;

function NewScenario() {
  const router = useRouter();
  const params = useSearchParams();
  const runs = useApi<RunSummary[]>("/optiroute/runs");
  const vehicles = useApi<Vehicle[]>("/vehicles");
  const drivers = useApi<Driver[]>("/drivers");
  const locations = useApi<Location[]>("/locations");
  const network = useApi<{ nodes: RoadNode[]; edges: RoadEdge[] }>("/road-network");
  const [type, setType] = useState<(typeof TYPES)[number][0]>("VEHICLE_BREAKDOWN");
  const [name, setName] = useState("");
  const [baseRunId, setBaseRunId] = useState(params.get("baseRunId") ?? "");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [edgeIds, setEdgeIds] = useState<number[]>([]);
  const [urgent, setUrgent] = useState({ customerName: "", pickupLocationId: "", dropLocationId: "", weightKg: "", serviceMinutes: "20" });
  const [win, setWin] = useState<{ windowStart: string | null; windowEnd: string | null }>({ windowStart: null, windowEnd: null });
  const nodeName = new Map((network.data?.nodes ?? []).map((n) => [n.id, n.name]));

  return (
    <Card title="Simulate a disruption">
      <FormShell submitLabel="Evaluate scenario" onSubmit={async () => {
        const p =
          type === "VEHICLE_BREAKDOWN" ? { vehicleId: Number(vehicleId) }
          : type === "DRIVER_UNAVAILABLE" ? { driverId: Number(driverId) }
          : type === "ROAD_CLOSURE" ? { edgeIds }
          : { ...urgent, pickupLocationId: Number(urgent.pickupLocationId), dropLocationId: Number(urgent.dropLocationId), weightKg: Number(urgent.weightKg), serviceMinutes: Number(urgent.serviceMinutes), ...win };
        const s = await api<{ id: number }>("/scenarios", { body: { type, name: name || TYPES.find((t) => t[0] === type)![1], baseRunId: Number(baseRunId), params: p } });
        router.push(`/scenarios/${s.id}`);
      }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Base plan"><Select required value={baseRunId} onChange={(e) => setBaseRunId(e.target.value)}><option value="">Select a run…</option>{runs.data?.map((r) => <option key={r.id} value={r.id}>#{r.id} {r.name} ({fmtDateTime(r.createdAt)})</option>)}</Select></Field>
          <Field label="Disruption"><Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Scenario name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MH04AB1234 clutch failure" /></Field>
        </div>
        {type === "VEHICLE_BREAKDOWN" && (
          <Field label="Vehicle that broke down"><Select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}><option value="">Select…</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.registrationNumber}</option>)}</Select></Field>
        )}
        {type === "DRIVER_UNAVAILABLE" && (
          <Field label="Driver who is unavailable"><Select required value={driverId} onChange={(e) => setDriverId(e.target.value)}><option value="">Select…</option>{drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        )}
        {type === "ROAD_CLOSURE" && (
          <div>
            <p className="mb-1 text-sm font-medium">Road segments to close</p>
            {(network.data?.edges ?? []).length === 0 ? <p className="text-sm text-muted">No road network configured — add one under Locations & Roads.</p> : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line p-2">
                {network.data!.edges.filter((e) => !e.isClosed).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={edgeIds.includes(e.id)} onChange={(ev) => setEdgeIds((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))} />
                    {nodeName.get(e.fromNodeId)} ↔ {nodeName.get(e.toNodeId)} <span className="text-xs text-muted">{e.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {type === "URGENT_ORDER" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Customer"><Input required value={urgent.customerName} onChange={(e) => setUrgent((u) => ({ ...u, customerName: e.target.value }))} /></Field>
            <Field label="Pickup"><Select required value={urgent.pickupLocationId} onChange={(e) => setUrgent((u) => ({ ...u, pickupLocationId: e.target.value }))}><option value="">Select…</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Drop"><Select required value={urgent.dropLocationId} onChange={(e) => setUrgent((u) => ({ ...u, dropLocationId: e.target.value }))}><option value="">Select…</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="Weight (kg)"><Input type="number" min={1} required value={urgent.weightKg} onChange={(e) => setUrgent((u) => ({ ...u, weightKg: e.target.value }))} /></Field>
            <Field label="Window start"><DateTimeInput value={win.windowStart} onChange={(v) => setWin((w) => ({ ...w, windowStart: v }))} /></Field>
            <Field label="Window end"><DateTimeInput value={win.windowEnd} onChange={(v) => setWin((w) => ({ ...w, windowEnd: v }))} /></Field>
          </div>
        )}
        <p className="text-xs text-muted">The base plan&apos;s orders and vehicles are re-optimised with the same algorithm and seed. Nothing changes in your data until a manager approves.</p>
      </FormShell>
    </Card>
  );
}

function ScenariosInner() {
  const { can } = useAuth();
  const list = useApi<Scenario[]>("/scenarios");
  return (
    <div className="space-y-5">
      <PageHeader title="Scenarios" subtitle="What-if re-planning: compare before/after plans, then approve or reject." />
      {can("optimize:run") && <NewScenario />}
      <Card title="Scenario history">
        {list.loading ? <Loading /> : list.error ? <ErrorState message={list.error} /> : (
          <Table head={["Scenario", "Type", "Base run", "Result run", "Impact", "Status", "Created"]} empty={list.data?.length === 0}>
            {list.data?.map((s) => (
              <tr key={s.id}>
                <Td><Link className="font-medium text-brand-700" href={`/scenarios/${s.id}`}>{s.name}</Link></Td>
                <Td>{humanize(s.type)}</Td>
                <Td><Link className="text-brand-700" href={`/optiroute/runs/${s.baseRunId}`}>#{s.baseRunId}</Link></Td>
                <Td>{s.resultRunId && <Link className="text-brand-700" href={`/optiroute/runs/${s.resultRunId}`}>#{s.resultRunId}</Link>}</Td>
                <Td className="text-xs">{s.comparison?.summary}</Td>
                <Td><StatusBadge status={s.status} /></Td>
                <Td className="text-xs">{fmtDateTime(s.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
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
