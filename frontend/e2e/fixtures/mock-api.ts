/**
 * Answers every /api/* request inside the browser with fixture data, so smoke
 * tests never reach the backend or any database. Map tiles are served from a
 * locally generated placeholder: automated/headless traffic to
 * tile.openstreetmap.org is not allowed by the OSM tile usage policy.
 */
import { crc32, deflateSync } from "node:zlib";
import type { Page, Route } from "@playwright/test";
import * as F from "./data";

export interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  body: unknown;
}

export interface MockOptions {
  /** Signed-in role; null = not signed in (/auth/me → 401). */
  role?: F.Role | null;
  /** Serve real OpenStreetMap tiles (only for occasional human-reviewed screenshots). */
  realTiles?: boolean;
  /** Per-test overrides: "METHOD /path" → JSON body or a handler. */
  overrides?: Record<string, unknown | ((req: RecordedRequest) => { status?: number; body?: unknown })>;
}

function solidPng(rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, ...rgb]))), chunk("IEND", Buffer.alloc(0))]);
}
const PLACEHOLDER_TILE = solidPng([233, 238, 236]);

const byStatus = <T extends { status: string }>(rows: T[], q: URLSearchParams) => (q.get("status") ? rows.filter((r) => r.status === q.get("status")) : rows);

function fixtureFor(method: string, path: string, q: URLSearchParams, role: F.Role, body?: unknown): { status?: number; body?: unknown } | undefined {
  if (method === "GET") {
    const id = Number(path.split("/").pop());
    const table: Record<string, () => unknown> = {
      "/api/auth/me": () => F.meFor(role),
      "/api/control-tower": () => F.controlTower,
      "/api/locations": () => F.locations,
      "/api/road-network": () => F.roadNetwork,
      "/api/vehicles": () => byStatus(F.vehicles, q).filter((v) => !q.get("search") || v.registrationNumber.includes(q.get("search")!.toUpperCase())),
      "/api/drivers": () => byStatus(F.drivers, q),
      "/api/orders": () => byStatus(F.orders, q).filter((o) => !q.get("priority") || o.priority === q.get("priority")),
      "/api/trips": () => (role === "DRIVER" ? F.trips.filter((t) => t.driverId === 1) : byStatus(F.trips, q)),
      "/api/documents": () =>
        F.documents.filter(
          (d) =>
            (!q.get("type") || d.type === q.get("type")) &&
            (!q.get("vehicleId") || d.vehicleId === Number(q.get("vehicleId"))) &&
            (!q.get("driverId") || d.driverId === Number(q.get("driverId"))) &&
            (!q.has("expiringWithinDays") || d.expiryState === "EXPIRED" || d.expiryState === "EXPIRING_SOON"),
        ),
      "/api/optiroute/meta": () => F.optirouteMeta,
      "/api/optiroute/runs": () => F.runs,
      "/api/scenarios": () => F.scenarios,
      "/api/billing": () => F.billingDocs.filter((d) => !q.get("kind") || d.kind === q.get("kind")),
      "/api/users": () => F.users,
      "/api/audit": () => F.auditEvents,
      "/api/greenfleet/summary": () => F.greenSummary,
      "/api/fuel-records": () => F.fuelRecords,
      "/api/places/status": () => F.placesStatus,
      "/api/places/reverse": () => F.reverseFor(Number(q.get("lat")), Number(q.get("lng"))),
      "/api/places/autocomplete": () => {
        const words = (q.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        return { provider: F.placesStatus.provider, attribution: F.placesStatus.attribution, results: F.placeSuggestions.filter((s) => words.every((w) => `${s.name} ${s.address}`.toLowerCase().includes(w))) };
      },
    };
    if (table[path]) return { body: table[path]() };
    if (path === "/api/road-network/path")
      return { body: { found: true, distanceKm: 37, minutes: 49, nodeIds: [1, 2, 3, 4], edgeIds: [1, 2, 3], nodeNames: ["Bhiwandi Jn", "Thane Jn", "Airoli Jn", "Vashi Jn"], comparison: { astar: { expandedNodes: 4, runtimeMs: 0.12 }, dijkstra: { expandedNodes: 6, runtimeMs: 0.2 } } } };
    if (/^\/api\/trips\/\d+\/qr$/.test(path) || /^\/api\/billing\/\d+\/qr$/.test(path)) return { body: { url: "http://localhost:3000/verify/fixture-token", dataUrl: F.TINY_PNG } };
    if (/^\/api\/trips\/\d+$/.test(path)) return { body: { ...F.trip, id } };
    if (/^\/api\/optiroute\/runs\/\d+$/.test(path)) return { body: { ...F.run, id } };
    if (/^\/api\/orders\/\d+$/.test(path)) {
      // id 99 is the order the POST /api/orders fixture "creates".
      const o = id === 99 ? { ...F.orders[3], id: 99 } : F.orders.find((x) => x.id === id);
      return o ? { body: { ...o, tripStops: id <= 3 ? [{ id: 10 + id, type: "PICKUP", trip: { id: 1, tripNumber: "TRP-QA0001", status: "IN_TRANSIT" } }] : [] } } : { status: 404, body: { error: { message: "Order not found" } } };
    }
    if (/^\/api\/vehicles\/\d+$/.test(path)) return { body: F.vehicleDetail };
    if (/^\/api\/drivers\/\d+$/.test(path)) return { body: F.driverDetail };
    if (/^\/api\/billing\/\d+$/.test(path)) return { body: F.billingDocs.find((d) => d.id === id) ?? F.billingDocs[0] };
    if (/^\/api\/scenarios\/\d+$/.test(path)) return { body: { ...F.scenarios[0], baseRun: F.run, resultRun: { ...F.run, id: 2 } } };
    return undefined;
  }
  if (path === "/api/auth/login") return { body: { user: F.meFor(role).user } };
  if (path === "/api/auth/logout") return { status: 204 };
  if (method === "POST" && path === "/api/locations") return { status: 201, body: { id: 50, roadNodeId: null, roadNode: null, ...(typeof body === "object" && body ? body : {}) } };
  if (method === "POST" && path === "/api/orders") return { status: 201, body: { ...F.orders[3], id: 99 } };
  if (method === "POST" && path === "/api/greenfleet/estimate")
    return {
      body: {
        rows: F.vehicles.map((v, i) => ({ vehicleId: v.id, registrationNumber: v.registrationNumber, fuelType: v.fuelType, capacityKg: v.capacityKg, canCarry: v.capacityKg >= 1000, durationMin: 180, fuelUnits: 10 + i, fuelUnit: v.fuelType === "ELECTRIC" ? "kWh" : v.fuelType === "CNG" ? "kg" : "L", fuelCost: 900 + i * 50, driverCost: 450, operatingCost: 1350 + i * 50, co2Kg: 20 + i * 3, co2PerTonneKm: 0.15 })),
        assumptions: [],
      },
    };
  // Generic success for other mutations; tests assert on the recorded request.
  return { body: { ok: true, id: 1, trips: [] } };
}

export async function mockApi(page: Page, opts: MockOptions = {}) {
  const role = opts.role === undefined ? "ADMIN" : opts.role;
  const requests: RecordedRequest[] = [];
  const unmocked: string[] = [];

  await page.route(/^https?:\/\/[^/]+\/api\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    let body: unknown = undefined;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    const rec: RecordedRequest = { method: req.method(), path: url.pathname, query: url.search, body };
    requests.push(rec);

    const key = `${rec.method} ${rec.path}`;
    const override = opts.overrides?.[key];
    let res: { status?: number; body?: unknown } | undefined;
    if (override !== undefined) res = typeof override === "function" ? (override as (r: RecordedRequest) => { status?: number; body?: unknown })(rec) : { body: override };
    else if (role === null && rec.path === "/api/auth/me") res = { status: 401, body: { error: { message: "Not signed in" } } };
    else if (role !== null) res = fixtureFor(rec.method, rec.path, url.searchParams, role, rec.body);
    if (!res) {
      unmocked.push(key);
      res = { status: 404, body: { error: { message: `Unmocked ${key}` } } };
    }
    const status = res.status ?? 200;
    return route.fulfill(status === 204 ? { status } : { status, contentType: "application/json", body: JSON.stringify(res.body ?? {}) });
  });

  if (!opts.realTiles) {
    await page.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PLACEHOLDER_TILE }));
  }
  return { requests, unmocked };
}
