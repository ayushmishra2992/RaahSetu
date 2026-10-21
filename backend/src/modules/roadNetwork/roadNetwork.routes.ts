import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { authOf } from "../../lib/http";
import { parseBody, parseId, parseQuery } from "../../lib/validate";
import { requirePermission } from "../../middleware/auth";
import { haversineKm } from "../../optimizer/geo";
import { RoadGraph } from "../../optimizer/graph";

const router = Router();

router.get("/", requirePermission("locations:read"), async (req, res) => {
  const auth = authOf(req);
  const [nodes, edges] = await Promise.all([
    prisma.roadNode.findMany({ where: { companyId: auth.companyId }, orderBy: { name: "asc" } }),
    prisma.roadEdge.findMany({ where: { companyId: auth.companyId }, orderBy: { id: "asc" } }),
  ]);
  res.json({ nodes, edges });
});

const NodeBody = z.object({ name: z.string().trim().min(1).max(120), lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

router.post("/nodes", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(NodeBody, req);
  const node = await prisma.roadNode.create({ data: { ...body, companyId: auth.companyId } });
  await audit(auth, "road_node.created", "RoadNode", node.id, { name: node.name });
  res.status(201).json(node);
});

router.delete("/nodes/:id", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  if (!(await prisma.roadNode.findFirst({ where: { id, companyId: auth.companyId } }))) throw notFound("Road node");
  await prisma.roadNode.delete({ where: { id } });
  await audit(auth, "road_node.deleted", "RoadNode", id);
  res.status(204).end();
});

const EdgeBody = z.object({
  fromNodeId: z.coerce.number().int().positive(),
  toNodeId: z.coerce.number().int().positive(),
  distanceKm: z.coerce.number().positive().optional(),
  speedKmph: z.coerce.number().positive().max(120).default(45),
  bidirectional: z.boolean().default(true),
  name: z.string().trim().max(120).optional().nullable(),
});

router.post("/edges", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const body = parseBody(EdgeBody, req);
  if (body.fromNodeId === body.toNodeId) throw badRequest("An edge must connect two different nodes");
  const nodes = await prisma.roadNode.findMany({ where: { companyId: auth.companyId, id: { in: [body.fromNodeId, body.toNodeId] } } });
  if (nodes.length !== 2) throw badRequest("Both nodes must belong to your company");
  const [a, b] = [nodes.find((n) => n.id === body.fromNodeId)!, nodes.find((n) => n.id === body.toNodeId)!];
  const distanceKm = body.distanceKm ?? Math.round(haversineKm(a, b) * 1.25 * 10) / 10;
  const edge = await prisma.roadEdge.create({ data: { ...body, distanceKm, companyId: auth.companyId } });
  await audit(auth, "road_edge.created", "RoadEdge", edge.id);
  res.status(201).json(edge);
});

router.patch("/edges/:id", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  const body = parseBody(z.object({ isClosed: z.boolean().optional(), speedKmph: z.coerce.number().positive().max(120).optional(), distanceKm: z.coerce.number().positive().optional(), name: z.string().trim().max(120).optional() }), req);
  if (!(await prisma.roadEdge.findFirst({ where: { id, companyId: auth.companyId } }))) throw notFound("Road edge");
  const edge = await prisma.roadEdge.update({ where: { id }, data: body });
  await audit(auth, body.isClosed === undefined ? "road_edge.updated" : body.isClosed ? "road_edge.closed" : "road_edge.opened", "RoadEdge", id, body);
  res.json(edge);
});

router.delete("/edges/:id", requirePermission("locations:write"), async (req, res) => {
  const auth = authOf(req);
  const id = parseId(req.params.id);
  if (!(await prisma.roadEdge.findFirst({ where: { id, companyId: auth.companyId } }))) throw notFound("Road edge");
  await prisma.roadEdge.delete({ where: { id } });
  await audit(auth, "road_edge.deleted", "RoadEdge", id);
  res.status(204).end();
});

/** Point-to-point shortest path; returns both Dijkstra and A* for comparison. */
router.get("/path", requirePermission("locations:read"), async (req, res) => {
  const auth = authOf(req);
  const q = parseQuery(z.object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() }), req);
  const [nodes, edges] = await Promise.all([
    prisma.roadNode.findMany({ where: { companyId: auth.companyId } }),
    prisma.roadEdge.findMany({ where: { companyId: auth.companyId } }),
  ]);
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(q.from) || !ids.has(q.to)) throw notFound("Road node");
  const graph = new RoadGraph(nodes, edges);
  const t0 = performance.now();
  const astar = graph.shortestPath(q.from, q.to, true);
  const t1 = performance.now();
  const dijkstra = graph.shortestPath(q.from, q.to, false);
  const t2 = performance.now();
  const names = new Map(nodes.map((n) => [n.id, n.name]));
  res.json({
    found: astar.found,
    distanceKm: astar.distanceKm,
    minutes: astar.minutes,
    nodeIds: astar.nodeIds,
    edgeIds: astar.edgeIds,
    nodeNames: astar.nodeIds.map((id) => names.get(id)),
    comparison: {
      astar: { expandedNodes: astar.expanded, distanceKm: astar.distanceKm, runtimeMs: t1 - t0 },
      dijkstra: { expandedNodes: dijkstra.expanded, distanceKm: dijkstra.distanceKm, runtimeMs: t2 - t1 },
    },
    note: "Closed edges are excluded. Distances come from the company road network (synthetic in the demo seed).",
  });
});

export default router;
