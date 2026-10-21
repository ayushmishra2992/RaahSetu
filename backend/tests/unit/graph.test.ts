import { describe, expect, it } from "vitest";
import { graphMatrix } from "../../src/optimizer/distance";
import { RoadGraph } from "../../src/optimizer/graph";

const nodes = [
  { id: 1, lat: 19.0, lng: 73.0 },
  { id: 2, lat: 19.1, lng: 73.0 },
  { id: 3, lat: 19.2, lng: 73.0 },
  { id: 4, lat: 19.1, lng: 73.2 },
];
const edges = [
  { id: 10, fromNodeId: 1, toNodeId: 2, distanceKm: 12, speedKmph: 60, bidirectional: true },
  { id: 11, fromNodeId: 2, toNodeId: 3, distanceKm: 12, speedKmph: 60, bidirectional: true },
  { id: 12, fromNodeId: 1, toNodeId: 4, distanceKm: 30, speedKmph: 60, bidirectional: true },
  { id: 13, fromNodeId: 4, toNodeId: 3, distanceKm: 30, speedKmph: 60, bidirectional: true },
];

describe("RoadGraph", () => {
  it("finds the same shortest path with Dijkstra and A*", () => {
    const g = new RoadGraph(nodes, edges);
    const a = g.shortestPath(1, 3, true);
    const d = g.shortestPath(1, 3, false);
    expect(a.found).toBe(true);
    expect(a.nodeIds).toEqual([1, 2, 3]);
    expect(a.distanceKm).toBeCloseTo(24);
    expect(d.distanceKm).toBeCloseTo(a.distanceKm);
    expect(a.minutes).toBeCloseTo(24);
    expect(a.expanded).toBeLessThanOrEqual(d.expanded);
  });

  it("routes around a closed road", () => {
    const g = new RoadGraph(nodes, edges, [11]);
    const p = g.shortestPath(1, 3);
    expect(p.nodeIds).toEqual([1, 4, 3]);
    expect(p.distanceKm).toBeCloseTo(60);
  });

  it("reports no path when the network is disconnected", () => {
    const g = new RoadGraph(nodes, edges, [11, 13]);
    expect(g.shortestPath(1, 3).found).toBe(false);
  });

  it("respects one-way edges", () => {
    const g = new RoadGraph(nodes, [{ id: 1, fromNodeId: 1, toNodeId: 2, distanceKm: 5, speedKmph: 50, bidirectional: false }]);
    expect(g.shortestPath(1, 2).found).toBe(true);
    expect(g.shortestPath(2, 1).found).toBe(false);
  });

  it("builds a location matrix with Infinity for unreachable pairs", () => {
    const locs = [
      { id: 100, name: "a", lat: 19.0, lng: 73.0, roadNodeId: 1 },
      { id: 101, name: "b", lat: 19.2, lng: 73.0, roadNodeId: 3 },
    ];
    const open = graphMatrix({ locations: locs, nodes, edges });
    expect(open.distKm[0][1]).toBeCloseTo(24, 0);
    const closed = graphMatrix({ locations: locs, nodes, edges, closedEdgeIds: [11, 13] });
    expect(closed.distKm[0][1]).toBe(Infinity);
  });
});
