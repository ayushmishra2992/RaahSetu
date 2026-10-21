"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { MapLegend, RouteMap, type MapLine, type MapPoint } from "@/components/RouteMap";
import { Alert, Badge, Button, Card, ConfirmButton, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, SyntheticNote, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtMinutes, fmtNum, humanize } from "@/lib/format";
import type { Location, RoadEdge, RoadNode } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function LocationForm({ loc, nodes, onSaved }: { loc?: Location; nodes: RoadNode[]; onSaved: () => void }) {
  const [f, setF] = useState({ name: loc?.name ?? "", address: loc?.address ?? "", type: loc?.type ?? "CUSTOMER", lat: loc?.lat?.toString() ?? "", lng: loc?.lng?.toString() ?? "", roadNodeId: loc?.roadNodeId?.toString() ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <FormShell submitLabel={loc ? "Save" : "Add location"} onSubmit={async () => {
      await api(loc ? `/locations/${loc.id}` : "/locations", { method: loc ? "PATCH" : "POST", body: { ...f, lat: Number(f.lat), lng: Number(f.lng), address: f.address || null, roadNodeId: f.roadNodeId ? Number(f.roadNodeId) : null } });
      onSaved();
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input required value={f.name} onChange={set("name")} /></Field>
        <Field label="Type"><Select value={f.type} onChange={set("type")}>{["DEPOT", "WAREHOUSE", "CUSTOMER", "OTHER"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Latitude"><Input required type="number" step="any" value={f.lat} onChange={set("lat")} /></Field>
        <Field label="Longitude"><Input required type="number" step="any" value={f.lng} onChange={set("lng")} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><Input value={f.address} onChange={set("address")} /></Field></div>
        <div className="sm:col-span-2">
          <Field label="Nearest road node" hint="Leave empty to snap automatically to the nearest node">
            <Select value={f.roadNodeId} onChange={set("roadNodeId")}>
              <option value="">Auto (nearest)</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </FormShell>
  );
}

interface PathResult {
  found: boolean;
  distanceKm: number;
  minutes: number;
  nodeIds: number[];
  edgeIds: number[];
  nodeNames: string[];
  comparison: { astar: { expandedNodes: number; runtimeMs: number }; dijkstra: { expandedNodes: number; runtimeMs: number } };
}

export default function LocationsPage() {
  const { can } = useAuth();
  const locations = useApi<Location[]>("/locations");
  const network = useApi<{ nodes: RoadNode[]; edges: RoadEdge[] }>("/road-network");
  const [modal, setModal] = useState<"loc" | "node" | "edge" | null>(null);
  const [editing, setEditing] = useState<Location | undefined>();
  const [path, setPath] = useState<PathResult | null>(null);
  const [pathForm, setPathForm] = useState({ from: "", to: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [nodeForm, setNodeForm] = useState({ name: "", lat: "", lng: "" });
  const [edgeForm, setEdgeForm] = useState({ fromNodeId: "", toNodeId: "", distanceKm: "", speedKmph: "45", name: "" });

  if (locations.loading || network.loading) return <Loading />;
  if (locations.error) return <ErrorState message={locations.error} onRetry={locations.reload} />;
  const nodes = network.data?.nodes ?? [];
  const edges = network.data?.edges ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const write = can("locations:write");

  const points: MapPoint[] = [
    ...nodes.map((n) => ({ lat: n.lat, lng: n.lng, kind: "node" as const, label: n.name })),
    ...(locations.data ?? []).map((l) => ({ lat: l.lat, lng: l.lng, kind: l.type === "DEPOT" ? ("depot" as const) : l.type === "WAREHOUSE" ? ("pickup" as const) : ("drop" as const) })),
  ];
  const pathEdges = new Set(path?.edgeIds ?? []);
  const lines: MapLine[] = edges.map((e) => ({
    points: [nodeById.get(e.fromNodeId)!, nodeById.get(e.toNodeId)!].filter(Boolean),
    color: e.isClosed ? "#dc2626" : pathEdges.has(e.id) ? "#5b5bd6" : "#94a3b8",
    dashed: e.isClosed || !pathEdges.has(e.id),
    label: `${e.name ?? "Road"} ${e.distanceKm} km${e.isClosed ? " (closed)" : ""}`,
  }));

  return (
    <div className="space-y-5">
      <PageHeader title="Locations & road network" subtitle="Depots, warehouses and customers, plus the road graph OptiRoute uses for shortest paths." actions={write && <Button onClick={() => { setEditing(undefined); setModal("loc"); }}>Add location</Button>} />
      {msg && <Alert kind="info">{msg}</Alert>}
      <Card title="Map" actions={<Badge color="amber">Schematic</Badge>}>
        <RouteMap points={points} lines={lines} height={420} />
        <MapLegend />
        <p className="mt-1 text-xs text-muted">Grey dashed = open road, red = closed road, violet = last computed shortest path.</p>
      </Card>

      <Card title={`Locations (${locations.data?.length ?? 0})`}>
        <Table head={["Name", "Type", "Coordinates", "Road node", ""]} empty={locations.data?.length === 0}>
          {locations.data?.map((l) => (
            <tr key={l.id}>
              <Td className="font-medium">{l.name}<div className="text-xs text-muted">{l.address}</div></Td>
              <Td>{humanize(l.type)}</Td>
              <Td className="tabular text-xs">{l.lat.toFixed(4)}, {l.lng.toFixed(4)}</Td>
              <Td>{l.roadNode?.name ?? <span className="text-muted">auto</span>}</Td>
              <Td>{write && (
                <span className="flex gap-1">
                  <Button variant="ghost" onClick={() => { setEditing(l); setModal("loc"); }}>Edit</Button>
                  <ConfirmButton confirmLabel="Delete" onConfirm={async () => { try { await api(`/locations/${l.id}`, { method: "DELETE" }); locations.reload(); } catch (e) { setMsg(errorMessage(e)); } }}>Delete</ConfirmButton>
                </span>
              )}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Road segments (${edges.length})`} actions={write && (<><Button variant="secondary" onClick={() => setModal("node")}>Add node</Button><Button variant="secondary" onClick={() => setModal("edge")}>Add segment</Button></>)}>
          <SyntheticNote>The demo network is synthetic (straight-line × 1.25). Replace with surveyed distances or an imported road graph for real operations.</SyntheticNote>
          <div className="mt-3 max-h-96 overflow-y-auto">
            <Table head={["Segment", "km", "km/h", "State", ""]} empty={edges.length === 0}>
              {edges.map((e) => (
                <tr key={e.id}>
                  <Td>{nodeById.get(e.fromNodeId)?.name} ↔ {nodeById.get(e.toNodeId)?.name}<div className="text-xs text-muted">#{e.id} {e.name}</div></Td>
                  <Td className="tabular">{e.distanceKm}</Td>
                  <Td className="tabular">{e.speedKmph}</Td>
                  <Td>{e.isClosed ? <Badge color="red">Closed</Badge> : <Badge color="green">Open</Badge>}</Td>
                  <Td>{write && <Button variant="ghost" onClick={async () => { await api(`/road-network/edges/${e.id}`, { method: "PATCH", body: { isClosed: !e.isClosed } }); network.reload(); }}>{e.isClosed ? "Reopen" : "Close"}</Button>}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
        <Card title="Shortest path (Dijkstra vs A*)">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="From"><Select value={pathForm.from} onChange={(e) => setPathForm((p) => ({ ...p, from: e.target.value }))}><option value="">Select…</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
            <Field label="To"><Select value={pathForm.to} onChange={(e) => setPathForm((p) => ({ ...p, to: e.target.value }))}><option value="">Select…</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
            <Button disabled={!pathForm.from || !pathForm.to} onClick={async () => { try { setPath(await api<PathResult>(`/road-network/path?from=${pathForm.from}&to=${pathForm.to}`)); setMsg(null); } catch (e) { setMsg(errorMessage(e)); } }}>Find</Button>
          </div>
          {path && (path.found ? (
            <div className="mt-4 space-y-2 text-sm">
              <p className="font-medium">{fmtNum(path.distanceKm, "km")} · {fmtMinutes(path.minutes)}</p>
              <p className="text-muted">{path.nodeNames.join(" → ")}</p>
              <p className="text-xs text-muted">A* expanded {path.comparison.astar.expandedNodes} nodes ({path.comparison.astar.runtimeMs.toFixed(2)} ms); Dijkstra expanded {path.comparison.dijkstra.expandedNodes} ({path.comparison.dijkstra.runtimeMs.toFixed(2)} ms). Same distance by construction.</p>
            </div>
          ) : <Alert kind="warning">No open path between these nodes.</Alert>)}
        </Card>
      </div>

      <Modal open={modal === "loc"} title={editing ? `Edit ${editing.name}` : "Add location"} onClose={() => setModal(null)} wide>
        <LocationForm key={editing?.id ?? "new"} loc={editing} nodes={nodes} onSaved={() => { setModal(null); locations.reload(); }} />
      </Modal>
      <Modal open={modal === "node"} title="Add road node" onClose={() => setModal(null)}>
        <FormShell submitLabel="Add node" onSubmit={async () => { await api("/road-network/nodes", { body: { name: nodeForm.name, lat: Number(nodeForm.lat), lng: Number(nodeForm.lng) } }); setModal(null); network.reload(); }}>
          <Field label="Name"><Input required value={nodeForm.name} onChange={(e) => setNodeForm((s) => ({ ...s, name: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude"><Input required type="number" step="any" value={nodeForm.lat} onChange={(e) => setNodeForm((s) => ({ ...s, lat: e.target.value }))} /></Field>
            <Field label="Longitude"><Input required type="number" step="any" value={nodeForm.lng} onChange={(e) => setNodeForm((s) => ({ ...s, lng: e.target.value }))} /></Field>
          </div>
        </FormShell>
      </Modal>
      <Modal open={modal === "edge"} title="Add road segment" onClose={() => setModal(null)}>
        <FormShell submitLabel="Add segment" onSubmit={async () => { await api("/road-network/edges", { body: { fromNodeId: Number(edgeForm.fromNodeId), toNodeId: Number(edgeForm.toNodeId), distanceKm: edgeForm.distanceKm ? Number(edgeForm.distanceKm) : undefined, speedKmph: Number(edgeForm.speedKmph), name: edgeForm.name || null } }); setModal(null); network.reload(); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Select required value={edgeForm.fromNodeId} onChange={(e) => setEdgeForm((s) => ({ ...s, fromNodeId: e.target.value }))}><option value="">Select…</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
            <Field label="To"><Select required value={edgeForm.toNodeId} onChange={(e) => setEdgeForm((s) => ({ ...s, toNodeId: e.target.value }))}><option value="">Select…</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select></Field>
            <Field label="Distance (km)" hint="Blank = straight line × 1.25"><Input type="number" step="any" min={0.1} value={edgeForm.distanceKm} onChange={(e) => setEdgeForm((s) => ({ ...s, distanceKm: e.target.value }))} /></Field>
            <Field label="Speed (km/h)"><Input type="number" min={5} max={120} value={edgeForm.speedKmph} onChange={(e) => setEdgeForm((s) => ({ ...s, speedKmph: e.target.value }))} /></Field>
          </div>
          <Field label="Name"><Input value={edgeForm.name} onChange={(e) => setEdgeForm((s) => ({ ...s, name: e.target.value }))} /></Field>
        </FormShell>
      </Modal>
    </div>
  );
}
