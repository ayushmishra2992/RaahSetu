"use client";

import { MapPinned, Pencil, Plus, Route, Waypoints } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FormShell } from "@/components/forms";
import { LOCATION_TYPES, LocationForm } from "@/components/LocationForm";
import { MapLegend, RouteMap, type MapLine, type MapPoint } from "@/components/RouteMap";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmButton,
  DataTable,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  SyntheticNote,
  Tabs,
  useConfirm,
  useToast,
  type Column,
} from "@/components/ds";
import { api, errorMessage } from "@/lib/api";
import { fmtMinutes, fmtNum, humanize } from "@/lib/format";
import { locationKind } from "@/lib/map";
import type { Location, RoadEdge, RoadNode } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function coordError(lat: string, lng: string): { lat?: string; lng?: string } {
  const e: { lat?: string; lng?: string } = {};
  const a = Number(lat);
  const b = Number(lng);
  if (lat === "" || !Number.isFinite(a) || a < -90 || a > 90) e.lat = "Latitude must be between −90 and 90.";
  if (lng === "" || !Number.isFinite(b) || b < -180 || b > 180) e.lng = "Longitude must be between −180 and 180.";
  return e;
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

type EdgeRow = RoadEdge & { fromName: string; toName: string };

export default function LocationsPage() {
  const { can } = useAuth();
  const locations = useApi<Location[]>("/locations");
  const network = useApi<{ nodes: RoadNode[]; edges: RoadEdge[] }>("/road-network");
  const [tab, setTab] = useState("locations");
  const [modal, setModal] = useState<"loc" | "node" | "edge" | null>(null);
  const [editing, setEditing] = useState<Location | undefined>();
  const [path, setPath] = useState<PathResult | null>(null);
  const [pathForm, setPathForm] = useState({ from: "", to: "" });
  const [pathError, setPathError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [nodeForm, setNodeForm] = useState({ name: "", lat: "", lng: "" });
  const [edgeForm, setEdgeForm] = useState({ fromNodeId: "", toNodeId: "", distanceKm: "", speedKmph: "45", name: "", bidirectional: "true" });
  const confirm = useConfirm();
  const toast = useToast();

  if (locations.loading || network.loading) return <Loading variant="page" label="Loading locations…" />;
  if (locations.error) return <ErrorState message={locations.error} onRetry={locations.reload} />;
  const nodes = network.data?.nodes ?? [];
  const edges = network.data?.edges ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const write = can("locations:write");
  const locs = locations.data ?? [];
  const closed = edges.filter((e) => e.isClosed).length;

  const points: MapPoint[] = [...nodes.map((n) => ({ lat: n.lat, lng: n.lng, kind: "node" as const, label: n.name })), ...locs.map((l) => ({ lat: l.lat, lng: l.lng, kind: locationKind(l.type), label: l.name }))];
  const pathEdges = new Set(path?.edgeIds ?? []);
  const lines: MapLine[] = edges.map((e) => ({
    points: [nodeById.get(e.fromNodeId)!, nodeById.get(e.toNodeId)!].filter(Boolean),
    color: e.isClosed ? "#dc2626" : pathEdges.has(e.id) ? "#5b5bd6" : "#475569",
    dashed: e.isClosed || !pathEdges.has(e.id),
    label: `${e.name ?? "Road"} ${e.distanceKm} km${e.isClosed ? " (closed)" : ""}`,
  }));

  const edgeRows: EdgeRow[] = edges.map((e) => ({ ...e, fromName: nodeById.get(e.fromNodeId)?.name ?? `#${e.fromNodeId}`, toName: nodeById.get(e.toNodeId)?.name ?? `#${e.toNodeId}` }));

  const locColumns: Array<Column<Location>> = [
    { key: "name", header: "Name", sortValue: (l) => l.name, cell: (l) => <span className="font-medium text-ink">{l.name}<span className="block text-xs font-normal text-muted">{l.address}</span></span> },
    { key: "type", header: "Type", sortValue: (l) => l.type, cell: (l) => <Badge color={l.type === "DEPOT" ? "teal" : l.type === "WAREHOUSE" ? "blue" : "gray"}>{humanize(l.type)}</Badge> },
    { key: "coords", header: "Coordinates", cell: (l) => <span className="tabular whitespace-nowrap text-xs">{l.lat.toFixed(4)}, {l.lng.toFixed(4)}</span>, hideBelow: "md" },
    { key: "node", header: "Road node", cell: (l) => l.roadNode?.name ?? <span className="text-muted">Automatic</span>, hideBelow: "lg" },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (l) =>
        write && (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${l.name}`} onClick={() => { setEditing(l); setModal("loc"); }}>
              Edit
            </Button>
            <ConfirmButton size="sm" confirmLabel="Delete location" title={`Delete ${l.name}?`} description="Locations used by any order or trip can’t be deleted. Vehicles using it as their depot lose their depot." onConfirm={async () => {
              try {
                await api(`/locations/${l.id}`, { method: "DELETE" });
                toast.success(`${l.name} deleted`);
                locations.reload();
              } catch (e) {
                setMsg(errorMessage(e));
              }
            }}>
              Delete
            </ConfirmButton>
          </span>
        ),
    },
  ];

  const edgeColumns: Array<Column<EdgeRow>> = [
    { key: "seg", header: "Segment", sortValue: (e) => e.fromName, cell: (e) => <span className="text-ink">{e.fromName} {e.bidirectional ? "↔" : "→"} {e.toName}<span className="block text-xs text-muted">#{e.id} {e.name}</span></span> },
    { key: "km", header: "Distance", align: "right", sortValue: (e) => e.distanceKm, cell: (e) => fmtNum(e.distanceKm, "km") },
    { key: "speed", header: "Speed", align: "right", sortValue: (e) => e.speedKmph, cell: (e) => `${e.speedKmph} km/h`, hideBelow: "sm" },
    { key: "state", header: "State", sortValue: (e) => (e.isClosed ? 0 : 1), cell: (e) => (e.isClosed ? <Badge color="red" dot>Closed</Badge> : <Badge color="green" dot>Open</Badge>) },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (e) =>
        write && (
          <span className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                confirm({
                  title: `${e.isClosed ? "Reopen" : "Close"} ${e.fromName} ↔ ${e.toName}?`,
                  description: e.isClosed ? "OptiRoute may route through this segment again in new plans." : "New OptiRoute plans and shortest paths will avoid this segment. Existing trips are not changed.",
                  confirmLabel: e.isClosed ? "Reopen road" : "Close road",
                  tone: e.isClosed ? "primary" : "danger",
                  action: async () => {
                    await api(`/road-network/edges/${e.id}`, { method: "PATCH", body: { isClosed: !e.isClosed } });
                    network.reload();
                  },
                })
              }
            >
              {e.isClosed ? "Reopen" : "Close"}
            </Button>
            <ConfirmButton size="sm" confirmLabel="Delete segment" title={`Delete ${e.fromName} ↔ ${e.toName}?`} description="The segment is removed from the road network. Closing it is usually better if the road may reopen." onConfirm={async () => {
              await api(`/road-network/edges/${e.id}`, { method: "DELETE" });
              network.reload();
            }}>
              Delete
            </ConfirmButton>
          </span>
        ),
    },
  ];

  const nodeColumns: Array<Column<RoadNode>> = [
    { key: "name", header: "Node", sortValue: (n) => n.name, cell: (n) => <span className="font-medium text-ink">{n.name}</span> },
    { key: "coords", header: "Coordinates", cell: (n) => <span className="tabular text-xs">{n.lat.toFixed(4)}, {n.lng.toFixed(4)}</span>, hideBelow: "sm" },
    { key: "degree", header: "Segments", align: "right", sortValue: (n) => edges.filter((e) => e.fromNodeId === n.id || e.toNodeId === n.id).length, cell: (n) => edges.filter((e) => e.fromNodeId === n.id || e.toNodeId === n.id).length },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (n) =>
        write && (
          <ConfirmButton size="sm" confirmLabel="Delete node" title={`Delete node ${n.name}?`} description="Every road segment connected to this node is deleted too, and locations snapped to it switch to automatic snapping." onConfirm={async () => {
            await api(`/road-network/nodes/${n.id}`, { method: "DELETE" });
            network.reload();
            locations.reload();
          }}>
            Delete
          </ConfirmButton>
        ),
    },
  ];

  async function findPath() {
    setPathError(null);
    try {
      setPath(await api<PathResult>(`/road-network/path?from=${pathForm.from}&to=${pathForm.to}`));
    } catch (e) {
      setPath(null);
      setPathError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Locations & road network"
        subtitle="Depots, warehouses and customers, plus the road graph OptiRoute uses for shortest paths and road closures."
        actions={
          write && (
            <Button icon={Plus} onClick={() => { setEditing(undefined); setModal("loc"); }}>
              Add location
            </Button>
          )
        }
      />
      {msg && <Alert title="Couldn't complete that">{msg}</Alert>}
      {network.error && <ErrorState title="Road network unavailable" message={network.error} onRetry={network.reload} />}

      <Card title="Map" icon={MapPinned} actions={<Badge color="amber">Road lines schematic</Badge>}>
        <RouteMap points={points} lines={lines} height={400} />
        <MapLegend kinds={["depot", "warehouse", "customer", "other", "node"]} />
        <p className="mt-1 text-xs text-muted">Road segments are drawn as straight lines between junctions. Grey dashed = open, red = closed, violet = last computed shortest path.</p>
      </Card>

      <Tabs
        label="Locations and roads sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "locations", label: "Locations", count: locs.length },
          { id: "roads", label: "Road segments", count: edges.length },
          { id: "nodes", label: "Road nodes", count: nodes.length },
          { id: "path", label: "Shortest path" },
        ]}
      />

      {tab === "locations" && (
        <DataTable
          rows={locs.filter((l) => !typeFilter || l.type === typeFilter)}
          columns={locColumns}
          rowKey={(l) => l.id}
          searchText={(l) => `${l.name} ${l.address ?? ""}`}
          searchPlaceholder="Search locations…"
          toolbar={
            <Select aria-label="Filter by location type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="sm:w-44">
              <option value="">All types</option>
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          }
          initialSort={{ key: "name", dir: "asc" }}
          caption="Locations"
          empty={{ title: "No locations yet", icon: MapPinned, description: "Add a depot and customer locations before creating orders." }}
        />
      )}

      {tab === "roads" && (
        <div className="space-y-3">
          <SyntheticNote>Segment distances default to straight line × 1.25 unless you enter a surveyed distance. Replace with measured distances for real operations.</SyntheticNote>
          <DataTable
            rows={edgeRows}
            columns={edgeColumns}
            rowKey={(e) => e.id}
            searchText={(e) => `${e.fromName} ${e.toName} ${e.name ?? ""} #${e.id}`}
            searchPlaceholder="Search segments…"
            toolbar={
              <div className="flex items-center gap-2 sm:ml-auto">
                {closed > 0 && <Badge color="red">{closed} closed</Badge>}
                {write && (
                  <Button size="sm" variant="secondary" icon={Plus} disabled={nodes.length < 2} title={nodes.length < 2 ? "Add at least two road nodes first" : undefined} onClick={() => setModal("edge")}>
                    Add segment
                  </Button>
                )}
              </div>
            }
            caption="Road segments"
            empty={{ title: "No road segments", icon: Waypoints, description: "Without a road network OptiRoute uses straight-line × 1.3 estimates." }}
          />
        </div>
      )}

      {tab === "nodes" && (
        <DataTable
          rows={nodes}
          columns={nodeColumns}
          rowKey={(n) => n.id}
          searchText={(n) => n.name}
          searchPlaceholder="Search nodes…"
          toolbar={
            write && (
              <Button size="sm" variant="secondary" icon={Plus} className="sm:ml-auto" onClick={() => setModal("node")}>
                Add node
              </Button>
            )
          }
          initialSort={{ key: "name", dir: "asc" }}
          caption="Road nodes"
          empty={{ title: "No road nodes", icon: Waypoints, description: "Nodes are junctions; segments connect them." }}
        />
      )}

      {tab === "path" && (
        <Card title="Shortest path" icon={Route} description="A* and Dijkstra over open segments; both must return the same distance">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="From">
              <Select value={pathForm.from} onChange={(e) => setPathForm((p) => ({ ...p, from: e.target.value }))}>
                <option value="">Select…</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="To">
              <Select value={pathForm.to} onChange={(e) => setPathForm((p) => ({ ...p, to: e.target.value }))}>
                <option value="">Select…</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </Select>
            </Field>
            <Button disabled={!pathForm.from || !pathForm.to || pathForm.from === pathForm.to} onClick={findPath}>
              Find path
            </Button>
          </div>
          {pathError && (
            <div className="mt-3">
              <Alert>{pathError}</Alert>
            </div>
          )}
          {path &&
            (path.found ? (
              <div className="mt-4 space-y-2 text-sm">
                <p className="text-lg font-semibold text-ink">
                  {fmtNum(path.distanceKm, "km")} · {fmtMinutes(path.minutes)}
                </p>
                <p className="text-muted">{path.nodeNames.join(" → ")}</p>
                <p className="text-xs text-muted">
                  A* expanded {path.comparison.astar.expandedNodes} nodes ({path.comparison.astar.runtimeMs.toFixed(2)} ms); Dijkstra expanded {path.comparison.dijkstra.expandedNodes} ({path.comparison.dijkstra.runtimeMs.toFixed(2)} ms). The path is highlighted on the map.
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <Alert kind="warning">No open path between these nodes. A closed segment may be blocking the only route.</Alert>
              </div>
            ))}
        </Card>
      )}

      <Modal open={modal === "loc"} title={editing ? `Edit ${editing.name}` : "Add location"} onClose={() => setModal(null)} wide>
        {modal === "loc" && (
          <LocationForm
            key={editing?.id ?? "new"}
            loc={editing}
            nodes={nodes}
            existing={locs}
            existingAction="edit"
            onUseExisting={(l) => setEditing(l)}
            onSaved={() => {
              setModal(null);
              toast.success(editing ? "Location updated" : "Location added");
              locations.reload();
            }}
          />
        )}
      </Modal>
      <Modal open={modal === "node"} title="Add road node" onClose={() => setModal(null)}>
        <FormShell
          submitLabel="Add node"
          onSubmit={async () => {
            const e = coordError(nodeForm.lat, nodeForm.lng);
            if (e.lat || e.lng) throw new Error([e.lat, e.lng].filter(Boolean).join(" "));
            await api("/road-network/nodes", { body: { name: nodeForm.name.trim(), lat: Number(nodeForm.lat), lng: Number(nodeForm.lng) } });
            setModal(null);
            setNodeForm({ name: "", lat: "", lng: "" });
            network.reload();
          }}
        >
          <Field label="Name" required>
            <Input required value={nodeForm.name} onChange={(e) => setNodeForm((s) => ({ ...s, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" required>
              <Input required type="number" step="any" min={-90} max={90} value={nodeForm.lat} onChange={(e) => setNodeForm((s) => ({ ...s, lat: e.target.value }))} />
            </Field>
            <Field label="Longitude" required>
              <Input required type="number" step="any" min={-180} max={180} value={nodeForm.lng} onChange={(e) => setNodeForm((s) => ({ ...s, lng: e.target.value }))} />
            </Field>
          </div>
        </FormShell>
      </Modal>
      <Modal open={modal === "edge"} title="Add road segment" onClose={() => setModal(null)}>
        <FormShell
          submitLabel="Add segment"
          onSubmit={async () => {
            if (edgeForm.fromNodeId === edgeForm.toNodeId) throw new Error("Choose two different nodes.");
            await api("/road-network/edges", {
              body: {
                fromNodeId: Number(edgeForm.fromNodeId),
                toNodeId: Number(edgeForm.toNodeId),
                distanceKm: edgeForm.distanceKm ? Number(edgeForm.distanceKm) : undefined,
                speedKmph: Number(edgeForm.speedKmph),
                bidirectional: edgeForm.bidirectional === "true",
                name: edgeForm.name.trim() || null,
              },
            });
            setModal(null);
            network.reload();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required>
              <Select required value={edgeForm.fromNodeId} onChange={(e) => setEdgeForm((s) => ({ ...s, fromNodeId: e.target.value }))}>
                <option value="">Select…</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="To" required>
              <Select required value={edgeForm.toNodeId} onChange={(e) => setEdgeForm((s) => ({ ...s, toNodeId: e.target.value }))}>
                <option value="">Select…</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Distance (km)" hint="Blank = straight line × 1.25">
              <Input type="number" step="any" min={0.1} value={edgeForm.distanceKm} onChange={(e) => setEdgeForm((s) => ({ ...s, distanceKm: e.target.value }))} />
            </Field>
            <Field label="Speed (km/h)">
              <Input type="number" min={5} max={120} value={edgeForm.speedKmph} onChange={(e) => setEdgeForm((s) => ({ ...s, speedKmph: e.target.value }))} />
            </Field>
            <Field label="Direction">
              <Select value={edgeForm.bidirectional} onChange={(e) => setEdgeForm((s) => ({ ...s, bidirectional: e.target.value }))}>
                <option value="true">Two-way</option>
                <option value="false">One-way (from → to)</option>
              </Select>
            </Field>
            <Field label="Name">
              <Input value={edgeForm.name} onChange={(e) => setEdgeForm((s) => ({ ...s, name: e.target.value }))} />
            </Field>
          </div>
        </FormShell>
      </Modal>
    </div>
  );
}
