import { haversineKm } from "./geo";

export interface GraphNode {
  id: number;
  name?: string;
  lat: number;
  lng: number;
}

export interface GraphEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  distanceKm: number;
  speedKmph: number;
  bidirectional: boolean;
  isClosed?: boolean;
}

interface Adj {
  to: number;
  edgeId: number;
  distanceKm: number;
  minutes: number;
}

export interface PathResult {
  found: boolean;
  nodeIds: number[];
  edgeIds: number[];
  distanceKm: number;
  minutes: number;
  /** Nodes popped from the priority queue — useful to compare Dijkstra vs A*. */
  expanded: number;
}

/** Binary min-heap keyed by priority. */
class MinHeap<T> {
  private items: Array<{ key: number; value: T }> = [];
  get size() {
    return this.items.length;
  }
  push(key: number, value: T) {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p].key <= items[i].key) break;
      [items[p], items[i]] = [items[i], items[p]];
      i = p;
    }
  }
  pop(): { key: number; value: T } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].key < items[m].key) m = l;
        if (r < items.length && items[r].key < items[m].key) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}

export class RoadGraph {
  readonly nodes = new Map<number, GraphNode>();
  private adj = new Map<number, Adj[]>();
  /** Scale for the A* heuristic that keeps it admissible for this graph. */
  private heuristicScale = 1;

  constructor(nodes: GraphNode[], edges: GraphEdge[], closedEdgeIds: Iterable<number> = []) {
    const closed = new Set(closedEdgeIds);
    for (const n of nodes) {
      this.nodes.set(n.id, n);
      this.adj.set(n.id, []);
    }
    let minRatio = 1;
    for (const e of edges) {
      if (e.isClosed || closed.has(e.id)) continue;
      if (!this.nodes.has(e.fromNodeId) || !this.nodes.has(e.toNodeId)) continue;
      if (!(e.distanceKm > 0) || !(e.speedKmph > 0)) continue;
      const minutes = (e.distanceKm / e.speedKmph) * 60;
      this.adj.get(e.fromNodeId)!.push({ to: e.toNodeId, edgeId: e.id, distanceKm: e.distanceKm, minutes });
      if (e.bidirectional) {
        this.adj.get(e.toNodeId)!.push({ to: e.fromNodeId, edgeId: e.id, distanceKm: e.distanceKm, minutes });
      }
      const straight = haversineKm(this.nodes.get(e.fromNodeId)!, this.nodes.get(e.toNodeId)!);
      if (straight > 0) minRatio = Math.min(minRatio, e.distanceKm / straight);
    }
    this.heuristicScale = Math.max(0, Math.min(1, minRatio));
  }

  /** Single-source shortest distances (km) and the travel minutes along those paths. */
  dijkstraAll(source: number): { dist: Map<number, number>; minutes: Map<number, number> } {
    const dist = new Map<number, number>();
    const minutes = new Map<number, number>();
    if (!this.nodes.has(source)) return { dist, minutes };
    dist.set(source, 0);
    minutes.set(source, 0);
    const heap = new MinHeap<number>();
    heap.push(0, source);
    const done = new Set<number>();
    while (heap.size) {
      const { key, value: u } = heap.pop()!;
      if (done.has(u)) continue;
      done.add(u);
      for (const a of this.adj.get(u) ?? []) {
        const nd = key + a.distanceKm;
        if (nd < (dist.get(a.to) ?? Infinity) - 1e-12) {
          dist.set(a.to, nd);
          minutes.set(a.to, minutes.get(u)! + a.minutes);
          heap.push(nd, a.to);
        }
      }
    }
    return { dist, minutes };
  }

  /** Point-to-point shortest path. `useHeuristic` switches between A* and Dijkstra. */
  shortestPath(from: number, to: number, useHeuristic = true): PathResult {
    const empty: PathResult = { found: false, nodeIds: [], edgeIds: [], distanceKm: Infinity, minutes: Infinity, expanded: 0 };
    if (!this.nodes.has(from) || !this.nodes.has(to)) return empty;
    const target = this.nodes.get(to)!;
    const h = (id: number) => (useHeuristic ? haversineKm(this.nodes.get(id)!, target) * this.heuristicScale : 0);
    const g = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, { node: number; edge: Adj }>();
    const heap = new MinHeap<number>();
    heap.push(h(from), from);
    const closed = new Set<number>();
    let expanded = 0;
    while (heap.size) {
      const { value: u } = heap.pop()!;
      if (closed.has(u)) continue;
      closed.add(u);
      expanded++;
      if (u === to) break;
      for (const a of this.adj.get(u) ?? []) {
        const ng = g.get(u)! + a.distanceKm;
        if (ng < (g.get(a.to) ?? Infinity) - 1e-12) {
          g.set(a.to, ng);
          prev.set(a.to, { node: u, edge: a });
          heap.push(ng + h(a.to), a.to);
        }
      }
    }
    if (!g.has(to)) return { ...empty, expanded };
    const nodeIds = [to];
    const edgeIds: number[] = [];
    let minutes = 0;
    let cur = to;
    while (cur !== from) {
      const p = prev.get(cur)!;
      edgeIds.push(p.edge.edgeId);
      minutes += p.edge.minutes;
      cur = p.node;
      nodeIds.push(cur);
    }
    nodeIds.reverse();
    edgeIds.reverse();
    return { found: true, nodeIds, edgeIds, distanceKm: g.get(to)!, minutes, expanded };
  }

  nearestNode(point: { lat: number; lng: number }): { nodeId: number; distanceKm: number } | null {
    let best: { nodeId: number; distanceKm: number } | null = null;
    for (const n of this.nodes.values()) {
      const d = haversineKm(point, n);
      if (!best || d < best.distanceKm) best = { nodeId: n.id, distanceKm: d };
    }
    return best;
  }
}
