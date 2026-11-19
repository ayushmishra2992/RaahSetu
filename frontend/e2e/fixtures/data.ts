/**
 * Synthetic API fixtures for Playwright smoke tests and review screenshots.
 * Shapes follow src/lib/types.ts. Nothing here touches a database: every
 * /api/* request is answered in the browser by mock-api.ts.
 */
import { permissionsFor } from "../../../backend/src/lib/permissions";

export type Role = "ADMIN" | "MANAGER" | "DISPATCHER" | "EMPLOYEE" | "DRIVER";

const DAY = 86_400_000;
const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const at = (h: number, m = 0) => {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const settings = {
  fuelPricePerUnit: { DIESEL: 92, PETROL: 104, CNG: 80, ELECTRIC: 9 },
  emissionKgPerUnit: { DIESEL: 2.68, PETROL: 2.31, CNG: 2.75, ELECTRIC: 0.71 },
  loadPenaltyAtFullLoad: 0.2,
  driverCostPerHour: 150,
  defaultWeights: { time: 1, distance: 0.5, cost: 0.01, emissions: 0.2, lateness: 2, risk: 1 },
  documentExpiryAlertDays: 30,
  currency: "INR",
};

export const company = { id: 1, name: "QA Test Logistics", gstNumber: "27AAACQ1234A1Z5", address: "Plot 12, MIDC", city: "Bhiwandi", state: "Maharashtra", phone: "+91 22 4000 0000", settings };

const USERS: Record<Role, { id: number; name: string; email: string }> = {
  ADMIN: { id: 1, name: "QA Admin", email: "qa-admin@example.test" },
  MANAGER: { id: 2, name: "QA Manager", email: "qa-manager@example.test" },
  DISPATCHER: { id: 3, name: "QA Dispatcher", email: "qa-dispatcher@example.test" },
  EMPLOYEE: { id: 4, name: "QA Viewer", email: "qa-viewer@example.test" },
  DRIVER: { id: 5, name: "QA Driver One", email: "qa-driver@example.test" },
};

/** /api/auth/me for a role — permissions come from the backend's own matrix. */
export function meFor(role: Role) {
  return {
    user: { ...USERS[role], role, driver: role === "DRIVER" ? { id: 1, name: "QA Driver One" } : null },
    company,
    permissions: permissionsFor(role) as string[],
  };
}

export const L = {
  1: { id: 1, name: "Bhiwandi Depot", type: "DEPOT", lat: 19.2967, lng: 73.0631 },
  2: { id: 2, name: "Vashi Warehouse", type: "WAREHOUSE", lat: 19.0771, lng: 72.9986 },
  3: { id: 3, name: "Andheri Customer", type: "CUSTOMER", lat: 19.1136, lng: 72.8697 },
  4: { id: 4, name: "Thane Customer", type: "CUSTOMER", lat: 19.2183, lng: 72.9781 },
  5: { id: 5, name: "Dadar Customer", type: "CUSTOMER", lat: 19.0178, lng: 72.8478 },
  6: { id: 6, name: "Kurla Yard", type: "OTHER", lat: 19.0728, lng: 72.8826 },
} as const;
type LocId = keyof typeof L;
export const locations = Object.values(L).map((l) => ({ ...l, address: `${l.name}, Mumbai Metropolitan Region`, roadNodeId: null, roadNode: null }));
const loc = (id: LocId) => locations[id - 1];

export const roadNetwork = {
  nodes: [
    { id: 1, name: "Bhiwandi Jn", lat: 19.285, lng: 73.05 },
    { id: 2, name: "Thane Jn", lat: 19.205, lng: 72.975 },
    { id: 3, name: "Airoli Jn", lat: 19.155, lng: 72.998 },
    { id: 4, name: "Vashi Jn", lat: 19.075, lng: 72.99 },
    { id: 5, name: "Ghatkopar Jn", lat: 19.085, lng: 72.91 },
    { id: 6, name: "Andheri Jn", lat: 19.118, lng: 72.86 },
    { id: 7, name: "Dadar Jn", lat: 19.02, lng: 72.845 },
  ],
  edges: [
    [1, 1, 2, 12, false, "Mumbai–Nashik Hwy"],
    [2, 2, 3, 7, false, "Thane–Belapur Rd"],
    [3, 3, 4, 9, false, "Thane–Belapur Rd"],
    [4, 4, 5, 9, false, "Sion–Panvel Hwy"],
    [5, 5, 6, 7, false, "JVLR"],
    [6, 5, 7, 9, false, "Eastern Express Hwy"],
    [7, 2, 6, 18, true, "Ghodbunder link"],
  ].map(([id, a, b, km, closed, name]) => ({ id, fromNodeId: a, toNodeId: b, distanceKm: km, speedKmph: 45, bidirectional: true, isClosed: closed, name })),
};

const vehicle = (id: number, reg: string, type: string, cap: number, fuel: string, mileage: number, status: string, make: string, model: string) => ({
  id, registrationNumber: reg, type, make, model, year: 2022, capacityKg: cap, fuelType: fuel, mileageKmPerUnit: mileage, avgSpeedKmph: 40, status, odometerKm: 48210 + id * 1000, depotLocationId: 1, depotLocation: { id: 1, name: "Bhiwandi Depot" },
});
export const vehicles = [
  vehicle(1, "MH04QA1001", "TRUCK", 5000, "DIESEL", 8, "ON_TRIP", "Tata", "LPT 1109"),
  vehicle(2, "MH04QA1002", "VAN", 800, "DIESEL", 12, "MAINTENANCE", "Mahindra", "Supro"),
  vehicle(3, "MH04QA1003", "MINI_TRUCK", 1500, "CNG", 14, "ON_TRIP", "Ashok Leyland", "Dost"),
  vehicle(4, "MH04QA1004", "VAN", 1000, "ELECTRIC", 6, "AVAILABLE", "Tata", "Ace EV"),
];

const driver = (id: number, name: string, status: string, expiryDays: number, userId: number | null) => ({
  id, name, phone: `+91 90000 0000${id}`, licenseNumber: `MH04 2026000${id}`, licenseExpiry: iso(expiryDays * DAY), status, maxShiftHours: 10, userId, user: userId ? { id: userId, email: USERS.DRIVER.email } : null,
});
export const drivers = [driver(1, "QA Driver One", "ON_TRIP", 400, 5), driver(2, "QA Driver Two", "ON_TRIP", 20, null), driver(3, "Ravi Patil", "AVAILABLE", 700, null)];

const order = (id: number, pickup: LocId, drop: LocId, kg: number, priority: string, status: string, customer: string) => ({
  id, orderNumber: `ORD-QA${String(id).padStart(4, "0")}`, customerName: customer, customerPhone: "+91 98200 00000", pickupLocationId: pickup, dropLocationId: drop,
  pickupLocation: { id: pickup, name: L[pickup].name }, dropLocation: { id: drop, name: L[drop].name }, weightKg: kg, priority, readyAt: null,
  windowStart: at(10), windowEnd: at(18), serviceMinutes: 20, status, notes: null, declaredValue: 250000, createdAt: iso(-DAY),
});
export const orders = [
  order(1, 2, 3, 1200, "NORMAL", "IN_TRANSIT", "Andheri Retail Pvt Ltd"),
  order(2, 2, 4, 900, "HIGH", "IN_TRANSIT", "Thane Distributors"),
  order(3, 2, 5, 400, "URGENT", "IN_TRANSIT", "Dadar Pharma"),
  order(4, 2, 3, 650, "NORMAL", "PENDING", "Andheri Retail Pvt Ltd"),
  order(5, 2, 5, 300, "LOW", "PENDING", "Dadar Pharma"),
  order(6, 2, 4, 1100, "NORMAL", "DELIVERED", "Thane Distributors"),
];

const doc = (id: number, type: string, number: string, expiryDays: number | null, owner: { vehicleId?: number; driverId?: number }, state: string, hasFile = true) => ({
  id, type, documentNumber: number, issuedOn: iso(-300 * DAY), expiresOn: expiryDays == null ? null : iso(expiryDays * DAY), notes: null,
  vehicleId: owner.vehicleId ?? null, driverId: owner.driverId ?? null,
  vehicle: owner.vehicleId ? { id: owner.vehicleId, registrationNumber: vehicles[owner.vehicleId - 1].registrationNumber } : null,
  driver: owner.driverId ? { id: owner.driverId, name: drivers[owner.driverId - 1].name } : null,
  fileName: hasFile ? `${type.toLowerCase()}.pdf` : null, hasFile, expiryState: state,
});
export const documents = [
  doc(1, "INSURANCE", "INS-55120", 240, { vehicleId: 1 }, "VALID"),
  doc(2, "PUC", "PUC-88123", -6, { vehicleId: 2 }, "EXPIRED"),
  doc(3, "FITNESS", "FIT-20931", 18, { vehicleId: 3 }, "EXPIRING_SOON"),
  doc(4, "RC", "RC-MH04QA1004", null, { vehicleId: 4 }, "NO_EXPIRY", false),
  doc(5, "DRIVING_LICENSE", "MH04 20260002", 20, { driverId: 2 }, "EXPIRING_SOON"),
];

const metrics = { distanceKm: 62.4, durationMin: 210, drivingMin: 150, waitingMin: 0, fuelUnits: 7.8, fuelCost: 702, driverCost: 525, operatingCost: 1227, co2Kg: 20.9, latenessMin: 0, risk: 0.1, maxLoadKg: 2100, utilizationPct: 42 };
const pst = (sequence: number, type: string, locationId: number, orderId: number | null = null) => ({ sequence, type, orderId, locationId, arrivalMin: sequence * 35, serviceStartMin: sequence * 35, departureMin: sequence * 35 + 10, waitMin: 0, latenessMin: 0, loadAfterKg: 0, legDistanceKm: 12 });
export const runResult = {
  algorithm: "LOCAL_SEARCH", seed: 42,
  routes: [
    { vehicleId: 1, vehicleLabel: "MH04QA1001", driverId: 1, driverName: "QA Driver One", stops: [pst(0, "DEPOT_START", 1), pst(1, "PICKUP", 2, 1), pst(2, "PICKUP", 2, 2), pst(3, "DROP", 4, 2), pst(4, "DROP", 3, 1), pst(5, "DEPOT_END", 1)], metrics },
    { vehicleId: 3, vehicleLabel: "MH04QA1003", driverId: 2, driverName: "QA Driver Two", stops: [pst(0, "DEPOT_START", 1), pst(1, "PICKUP", 2, 3), pst(2, "DROP", 5, 3), pst(3, "DEPOT_END", 1)], metrics: { ...metrics, distanceKm: 71.2, maxLoadKg: 400, utilizationPct: 27 } },
  ],
  unserved: [], totals: { ...metrics, distanceKm: 133.6, servedOrders: 3, vehiclesUsed: 2 },
  objective: { time: 6, distance: 13, cost: 24, emissions: 4, lateness: 0, risk: 1, unservedPenalty: 0, total: 48 },
  feasible: true, violations: [], iterations: 400, convergence: [{ iteration: 0, best: 60 }, { iteration: 100, best: 52 }, { iteration: 400, best: 48 }], runtimeMs: 85,
  distanceSource: "ROAD_NETWORK", planStart: at(9),
  exclusions: [{ kind: "vehicle", id: 2, label: "MH04QA1002", reason: "PUC expired" }],
  assumptions: ["Distances use shortest paths (Dijkstra) over the company road network; closed roads are excluded."],
  locations: Object.fromEntries(Object.values(L).map((l) => [l.id, { name: l.name, lat: l.lat, lng: l.lng }])),
  orders: { 1: { label: "ORD-QA0001", customerName: "Andheri Retail Pvt Ltd", weightKg: 1200, priority: "NORMAL" }, 2: { label: "ORD-QA0002", customerName: "Thane Distributors", weightKg: 900, priority: "HIGH" }, 3: { label: "ORD-QA0003", customerName: "Dadar Pharma", weightKg: 400, priority: "URGENT" } },
};
const runSummary = { id: 1, name: "Morning wave", algorithm: "LOCAL_SEARCH", seed: 42, objective: 48, feasible: true, totalDistanceKm: 133.6, totalCo2Kg: 41.8, totalCost: 2454, unservedCount: 0, runtimeMs: 85, distanceSource: "ROAD_NETWORK", dispatchedAt: iso(-3 * 3600_000), createdAt: iso(-4 * 3600_000) };
export const runs = [runSummary, { ...runSummary, id: 2, name: "Greedy baseline", algorithm: "GREEDY", objective: 55, totalDistanceKm: 151.2, totalCost: 2720, dispatchedAt: null, createdAt: iso(-5 * 3600_000) }];
export const run = { ...runSummary, request: { hardTimeWindows: true, returnToDepot: true, maxIterations: 400 }, result: runResult, trips: [{ id: 1, tripNumber: "TRP-QA0001", status: "IN_TRANSIT", vehicleId: 1 }] };
export const optirouteMeta = {
  algorithms: [{ id: "GREEDY", label: "Greedy insertion", description: "Fast constructive baseline." }, { id: "LOCAL_SEARCH", label: "Local search", description: "Greedy start improved by relocate/swap moves." }, { id: "SIMULATED_ANNEALING", label: "Simulated annealing", description: "Escapes local optima; slower." }],
  defaultWeights: settings.defaultWeights,
  objective: "J = w_time·hours + w_distance·km + w_cost·cost + w_emissions·kg CO₂ + w_lateness·late min + w_risk·risk + unserved penalty",
  hardConstraints: ["Vehicle capacity at every point of the route", "Pickup before delivery on the same vehicle", "Delivery time windows (unless soft windows are chosen)", "Driver shift limit"],
};

const tstop = (id: number, sequence: number, type: string, lid: LocId, status: string, ord: (typeof orders)[number] | null = null) => ({
  id, sequence, type, locationId: lid, location: loc(lid), orderId: ord?.id ?? null,
  order: ord ? { id: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, weightKg: ord.weightKg, windowEnd: ord.windowEnd, status: ord.status } : null,
  plannedArrival: at(9 + sequence), actualArrival: status === "COMPLETED" ? at(9 + sequence, 5) : null, status,
});
const tripBase = (id: number, vehicleIdx: number, driverIdx: number, status: string) => ({
  id, tripNumber: `TRP-QA000${id}`, vehicleId: vehicles[vehicleIdx].id, driverId: drivers[driverIdx].id, status, plannedStart: at(9), plannedEnd: at(15), actualStart: status === "IN_TRANSIT" ? at(9, 2) : null, actualEnd: null,
  plannedDistanceKm: 62.4, estFuelUnits: 7.8, estCost: 1227, estCo2Kg: 20.9, notes: null, vehicle: vehicles[vehicleIdx], driver: drivers[driverIdx], optimizationRunId: 1,
});
export const trip = {
  ...tripBase(1, 0, 0, "IN_TRANSIT"),
  stops: [tstop(1, 0, "DEPOT_START", 1, "COMPLETED"), tstop(2, 1, "PICKUP", 2, "COMPLETED", orders[0]), tstop(3, 2, "PICKUP", 2, "COMPLETED", orders[1]), tstop(4, 3, "DROP", 4, "PENDING", orders[1]), tstop(5, 4, "DROP", 3, "PENDING", orders[0]), tstop(6, 5, "DEPOT_END", 1, "PENDING")],
  events: [{ id: 1, fromStatus: null, toStatus: "PLANNED", note: null, createdAt: at(8, 50) }, { id: 2, fromStatus: "PLANNED", toStatus: "DISPATCHED", note: null, createdAt: at(8, 58) }, { id: 3, fromStatus: "DISPATCHED", toStatus: "IN_TRANSIT", note: "Loaded at 09:00", createdAt: at(9, 2) }],
  billingDocuments: [], optimizationRun: { id: 1, name: "Morning wave", algorithm: "LOCAL_SEARCH" },
  simulatedPosition: { simulated: true, lat: 19.16, lng: 73.0, progressPct: 45, nextStop: "Thane Customer", etaToNextStop: at(12, 10), delayMinutes: 0 },
};
export const trips = [
  { ...tripBase(1, 0, 0, "IN_TRANSIT"), _count: { stops: 6 } },
  { ...tripBase(2, 2, 1, "DISPATCHED"), _count: { stops: 4 } },
  { ...tripBase(3, 3, 2, "PLANNED"), _count: { stops: 4 }, optimizationRunId: null },
  { ...tripBase(4, 0, 0, "COMPLETED"), _count: { stops: 4 }, plannedStart: iso(-2 * DAY) },
];

const routeOf = (stops: typeof trip.stops) => stops.map((s) => ({ lat: s.location.lat, lng: s.location.lng, name: s.location.name, type: s.type, status: s.status }));
export const controlTower = {
  generatedAt: iso(0),
  kpis: { fleetUtilizationPct: 50, onTimeDeliveryPct30d: 92.3, completedTrips30d: 14, plannedKm30d: 1840, estimatedCost30d: 48200, estimatedCo2Kg30d: 612.4 },
  alerts: [
    { severity: "critical", type: "DOCUMENT_EXPIRY", message: "PUC for MH04QA1002 expired", link: "/documents" },
    { severity: "warning", type: "DOCUMENT_EXPIRY", message: "FITNESS for MH04QA1003 expires soon", link: "/documents" },
    { severity: "warning", type: "LICENCE_EXPIRY", message: "Driving licence of QA Driver Two expires soon", link: "/drivers/2" },
    { severity: "info", type: "ROAD_CLOSED", message: "1 road segment(s) currently closed", link: "/locations" },
  ],
  counts: { vehicles: { ON_TRIP: 2, AVAILABLE: 1, MAINTENANCE: 1 }, drivers: { ON_TRIP: 2, AVAILABLE: 1 }, orders: { IN_TRANSIT: 3, PENDING: 2, DELIVERED: 1 }, trips: { IN_TRANSIT: 1, DISPATCHED: 1, PLANNED: 1, COMPLETED: 1 } },
  liveTrips: [
    { id: 1, tripNumber: "TRP-QA0001", status: "IN_TRANSIT", vehicle: "MH04QA1001", driver: "QA Driver One", stopsDone: 3, stopsTotal: 6, position: { lat: 19.16, lng: 73.0, progressPct: 45, nextStop: "Thane Customer", delayMinutes: 0 }, route: routeOf(trip.stops) },
    { id: 2, tripNumber: "TRP-QA0002", status: "DISPATCHED", vehicle: "MH04QA1003", driver: "QA Driver Two", stopsDone: 0, stopsTotal: 4, position: null, route: ([1, 2, 5, 1] as LocId[]).map((id, i) => ({ lat: L[id].lat, lng: L[id].lng, name: L[id].name, type: i === 0 ? "DEPOT_START" : i === 3 ? "DEPOT_END" : id === 2 ? "PICKUP" : "DROP", status: "PENDING" })) },
  ],
  recentRuns: runs,
  telemetryNote: "Positions are SIMULATED from the planned schedule; no GPS provider is connected.",
};

export const scenarios = [{
  id: 1, name: "MH04QA1003 clutch failure", type: "VEHICLE_BREAKDOWN", params: { vehicleId: 3 }, status: "EVALUATED", baseRunId: 1, resultRunId: 2,
  comparison: { base: { objective: 48, distanceKm: 133.6, servedOrders: 3 }, scenario: { objective: 55, distanceKm: 151.2, servedOrders: 3 }, delta: { objective: 7, distanceKm: 17.6, servedOrders: 0 }, reassignedOrders: [{ orderId: 3, label: "ORD-QA0003", from: "MH04QA1003", to: "MH04QA1001" }], newlyUnserved: [], summary: "All orders still served; +17.6 km" },
  decisionNote: null, decidedAt: null, createdAt: iso(-3600_000),
}];

export const billingDocs = [
  { id: 1, kind: "INVOICE", number: "INV-2026-QA0001", status: "ISSUED", tripId: 4, trip: { id: 4, tripNumber: "TRP-QA0004" }, customerName: "Thane Distributors", customerGstin: "27AABCT1234B1Z2", customerAddress: "Wagle Estate, Thane", taxRatePercent: 18, subtotal: 10000, taxAmount: 1800, total: 11800, issuedAt: iso(-DAY), dueDate: iso(14 * DAY), notes: null, createdAt: iso(-DAY), items: [{ id: 1, description: "Freight charges", quantity: 1, unit: "trip", rate: 10000, amount: 10000 }], seller: { name: company.name, gstNumber: company.gstNumber, address: company.address, city: company.city, state: company.state } },
  { id: 2, kind: "DELIVERY_CHALLAN", number: "DC-2026-QA0001", status: "DRAFT", tripId: 1, trip: { id: 1, tripNumber: "TRP-QA0001" }, customerName: "Andheri Retail Pvt Ltd", customerGstin: null, customerAddress: null, taxRatePercent: 0, subtotal: 0, taxAmount: 0, total: 0, issuedAt: null, dueDate: null, notes: null, createdAt: iso(-3600_000), items: [{ id: 2, description: "Packaged goods", quantity: 40, unit: "cartons", rate: 0, amount: 0 }], seller: { name: company.name, gstNumber: company.gstNumber, address: company.address, city: company.city, state: company.state } },
];

export const users = (Object.keys(USERS) as Role[]).map((role) => ({ ...USERS[role], role, isActive: true, lastLoginAt: iso(-3600_000), driver: role === "DRIVER" ? { id: 1, name: "QA Driver One" } : null }));

export const auditEvents = [
  { id: 3, action: "order.updated", entityType: "Order", entityId: 4, metadata: { fields: ["weightKg", "windowEnd"] }, userName: "QA Dispatcher", createdAt: at(9, 2) },
  { id: 2, action: "road_edge.closed", entityType: "RoadEdge", entityId: 2, metadata: { isClosed: true }, userName: "QA Dispatcher", createdAt: at(8, 50) },
  { id: 1, action: "document.created", entityType: "ComplianceDocument", entityId: 2, metadata: { type: "PUC" }, userName: "QA Manager", createdAt: iso(-DAY) },
];

export const greenSummary = {
  periodDays: 30,
  rows: vehicles.map((v, i) => ({ vehicleId: v.id, registrationNumber: v.registrationNumber, fuelType: v.fuelType, fuelUnit: v.fuelType === "ELECTRIC" ? "kWh" : v.fuelType === "CNG" ? "kg" : "L", completedTrips: 4 - i, estimated: { distanceKm: 520 - i * 90, fuelUnits: 61 - i * 9, co2Kg: 163 - i * 30, operatingCost: 14800 - i * 2100 }, logged: { fills: 3, quantity: 64 - i * 8, cost: 5900 - i * 700, co2KgFromFuel: 171 - i * 28 }, configuredMileage: v.mileageKmPerUnit, observedMileage: i === 3 ? null : v.mileageKmPerUnit - 0.4 })),
  totals: { estCo2Kg: 612.4, loggedCo2Kg: 640.2, estCost: 48200, loggedFuelCost: 21500 },
  notes: ["Estimated values use planned distance and configured mileage.", "Observed mileage needs at least two fills with odometer readings."],
};
export const fuelRecords = vehicles.slice(0, 3).map((v, i) => ({ id: i + 1, filledAt: iso(-(i + 2) * DAY), quantity: 60 - i * 5, totalCost: 5520 - i * 400, odometerKm: v.odometerKm, vehicle: { id: v.id, registrationNumber: v.registrationNumber, fuelType: v.fuelType } }));

export const vehicleDetail = { ...vehicles[0], documents: documents.filter((d) => d.vehicleId === 1), trips: trips.filter((t) => t.vehicleId === 1).map((t) => ({ ...t, driver: { id: t.driver.id, name: t.driver.name } })), fuelRecords: fuelRecords.filter((r) => r.vehicle.id === 1) };
export const driverDetail = { ...drivers[0], documents: [], trips: trips.filter((t) => t.driverId === 1).map((t) => ({ ...t, vehicle: { id: t.vehicle.id, registrationNumber: t.vehicle.registrationNumber } })) };

/** 1×1 PNG used for QR codes in fixtures. */
export const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Location-search fixtures (the real provider is never called in tests). */
export const placesStatus = { enabled: true, provider: "locationiq", fallback: "geoapify", reverse: true, attribution: [{ text: "Test search data", url: "https://example.test/attribution" }], minQueryLength: 3 };
export const placeSuggestions = [
  { providerPlaceId: "p-1", name: "Bhiwandi Logistics Park", address: "Bhiwandi Logistics Park, Mankoli, Bhiwandi, Thane, Maharashtra, 421302, India", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", lat: 19.2813, lng: 73.0483 },
  { providerPlaceId: "p-2", name: "Bhiwandi Bypass Warehouse 7", address: "Warehouse 7, Bhiwandi Bypass, Bhiwandi, Maharashtra, 421302, India", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", lat: 19.2741, lng: 73.0612 },
  { providerPlaceId: "p-3", name: "Andheri East Cold Store", address: "Andheri East Cold Store, Marol, Andheri East, Mumbai, Maharashtra, 400059, India", city: "Mumbai", state: "Maharashtra", postalCode: "400059", country: "India", lat: 19.1136, lng: 72.8697 },
];

/** Reverse lookup fixture: the matched address point is 22 m north of the pin (never moves the pin). */
export const reverseFor = (lat: number, lng: number) => ({
  provider: "locationiq",
  attribution: placesStatus.attribution,
  place: { providerPlaceId: "rev-1", name: "Mankoli Naka", address: "Mankoli Naka, Anjur Phata Road, Bhiwandi, Thane, Maharashtra, 421302, India", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", lat: lat + 0.0002, lng },
  distanceM: 22,
});

// ── Documents & compliance (shapes match backend/src/modules/compliance and shipments)
const compliantItem = (type: string) => ({ type, required: true, state: "COMPLIANT", documentId: 1, documentNumber: `${type}-1`, expiresOn: "2027-06-30T00:00:00.000Z", daysToExpiry: 220, blocking: false, message: `${type} is valid` });
export const vehicleCompliance = {
  overall: "EXPIRED",
  eligible: false,
  items: [compliantItem("RC"), compliantItem("INSURANCE"), { ...compliantItem("PUC"), state: "EXPIRED", expiresOn: "2026-10-01T00:00:00.000Z", daysToExpiry: -48, blocking: true, message: "PUC expired on 2026-10-01" }],
  blockers: ["PUC expired on 2026-10-01"],
  warnings: [],
};
export const driverCompliance = { overall: "COMPLIANT", eligible: true, items: [compliantItem("DRIVING_LICENSE")], blockers: [], warnings: [] };
export const complianceOverview = {
  evaluatedAt: "2026-11-18T06:00:00.000Z",
  alertDays: 30,
  vehicles: { total: 3, blocked: 1, byState: { COMPLIANT: 1, EXPIRING_SOON: 1, PENDING_VERIFICATION: 0, MISSING: 0, EXPIRED: 1 } },
  drivers: { total: 2, blocked: 0, byState: { COMPLIANT: 2, EXPIRING_SOON: 0, PENDING_VERIFICATION: 0, MISSING: 0, EXPIRED: 0 } },
  attention: [{ kind: "VEHICLE", id: 2, label: "MH04QA1002", overall: "EXPIRED", eligible: false, issues: ["PUC expired on 2026-10-01"] }],
};
export const tripDocuments = {
  trip: { id: 1, tripNumber: "TRP-QA0001", status: "IN_TRANSIT", vehicle: "MH04QA1001", driver: "Ramesh Pawar" },
  compliance: { eligible: true, blockers: [], warnings: [], vehicle: driverCompliance, driver: driverCompliance, shipments: [{ orderId: 1, orderNumber: "ORD-QA0001", ewayBill: { applicable: false, state: "NOT_APPLICABLE", message: "Declared value ₹20000 is within ₹50000", blocking: false } }] },
  vehicleDocuments: [],
  driverDocuments: [],
  billing: [],
  orders: [{ id: 1, orderNumber: "ORD-QA0001", customerName: "QA Customer", declaredValue: 20000, weightKg: 500, stopId: 3, stopStatus: "PENDING", dropLocation: "Vashi Market", ewayBills: [], lorryReceipts: [], pod: null }],
};
