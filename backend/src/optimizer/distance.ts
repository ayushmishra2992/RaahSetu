import { haversineKm } from "./geo";
import { RoadGraph, type GraphEdge, type GraphNode } from "./graph";
import type { DistanceMatrix, OptLocation } from "./types";

/** Assumptions for the straight-line fallback, surfaced in API responses. */
export const HAVERSINE_CIRCUITY_FACTOR = 1.3;
export const HAVERSINE_SPEED_KMPH = 45;
/** Location → nearest road node access legs (last-mile) assumptions. */
export const ACCESS_CIRCUITY_FACTOR = 1.2;
export const ACCESS_SPEED_KMPH = 25;

export function haversineMatrix(locations: OptLocation[]): DistanceMatrix {
  const index = new Map(locations.map((l, i) => [l.id, i]));
  const n = locations.length;
  const distKm = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const timeMin = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = haversineKm(locations[i], locations[j]) * HAVERSINE_CIRCUITY_FACTOR;
      distKm[i][j] = d;
      timeMin[i][j] = (d / HAVERSINE_SPEED_KMPH) * 60;
    }
  }
  return { index, distKm, timeMin, source: "HAVERSINE_ESTIMATE" };
}

export interface GraphMatrixInput {
  locations: Array<OptLocation & { roadNodeId?: number | null }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  closedEdgeIds?: number[];
}

/**
 * Builds a location-to-location matrix over the road graph using one Dijkstra
 * per distinct snapped node. Pairs with no path are `Infinity` (the solver
 * treats them as infeasible rather than silently falling back).
 */
export function graphMatrix(input: GraphMatrixInput): DistanceMatrix {
  const graph = new RoadGraph(input.nodes, input.edges, input.closedEdgeIds ?? []);
  const { locations } = input;
  const index = new Map(locations.map((l, i) => [l.id, i]));
  const snapped = locations.map((l) => {
    if (l.roadNodeId && graph.nodes.has(l.roadNodeId)) {
      const node = graph.nodes.get(l.roadNodeId)!;
      return { nodeId: l.roadNodeId, accessKm: haversineKm(l, node) * ACCESS_CIRCUITY_FACTOR };
    }
    const nearest = graph.nearestNode(l);
    return nearest
      ? { nodeId: nearest.nodeId, accessKm: nearest.distanceKm * ACCESS_CIRCUITY_FACTOR }
      : { nodeId: -1, accessKm: Infinity };
  });
  const cache = new Map<number, ReturnType<RoadGraph["dijkstraAll"]>>();
  const n = locations.length;
  const distKm = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const timeMin = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const si = snapped[i];
    if (!cache.has(si.nodeId)) cache.set(si.nodeId, graph.dijkstraAll(si.nodeId));
    const sp = cache.get(si.nodeId)!;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const sj = snapped[j];
      const core = si.nodeId === sj.nodeId ? 0 : sp.dist.get(sj.nodeId);
      const coreMin = si.nodeId === sj.nodeId ? 0 : sp.minutes.get(sj.nodeId);
      if (core === undefined || coreMin === undefined || !Number.isFinite(si.accessKm + sj.accessKm)) {
        distKm[i][j] = Infinity;
        timeMin[i][j] = Infinity;
        continue;
      }
      if (si.nodeId === sj.nodeId) {
        // Same access node: travel directly between the two locations.
        const d = haversineKm(locations[i], locations[j]) * ACCESS_CIRCUITY_FACTOR;
        distKm[i][j] = d;
        timeMin[i][j] = (d / ACCESS_SPEED_KMPH) * 60;
        continue;
      }
      const access = si.accessKm + sj.accessKm;
      distKm[i][j] = core + access;
      timeMin[i][j] = coreMin + (access / ACCESS_SPEED_KMPH) * 60;
    }
  }
  return { index, distKm, timeMin, source: "ROAD_GRAPH" };
}
