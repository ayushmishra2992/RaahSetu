import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = !!process.env.TEST_DATABASE_URL;

// Imported lazily so unit-only runs never need a database.
type App = Parameters<typeof request>[0];
let app: App;
let disconnect: () => Promise<void>;

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

interface Tenant {
  token: string;
  companyId: number;
}

const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

async function registerCompany(suffix: string): Promise<Tenant> {
  const res = await request(app)
    .post("/api/auth/register-company")
    .send({ companyName: `Test Co ${suffix}`, adminName: `Admin ${suffix}`, email: `admin-${suffix}@example.test`, password: "Passw0rd!" });
  expect(res.status).toBe(201);
  return { token: res.body.token, companyId: res.body.company.id };
}

async function createUser(admin: Tenant, role: string, email: string) {
  const res = await request(app).post("/api/users").set(auth(admin)).send({ name: `${role} user`, email, password: "Passw0rd!", role });
  expect(res.status).toBe(201);
  const login = await request(app).post("/api/auth/login").send({ email, password: "Passw0rd!" });
  expect(login.status).toBe(200);
  return { token: login.body.token as string, userId: res.body.id as number };
}

describe.skipIf(!enabled)("RaahSetu API (integration, real PostgreSQL)", () => {
  let A: Tenant;
  let B: Tenant;
  let dispatcher: { token: string };
  let viewer: { token: string };
  let driverUser: { token: string; userId: number };
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    const mod = await import("../../src/app");
    const prismaMod = await import("../../src/config/prisma");
    app = mod.createApp();
    disconnect = () => prismaMod.prisma.$disconnect();
    A = await registerCompany("a");
    B = await registerCompany("b");
    dispatcher = await createUser(A, "DISPATCHER", "dispatcher-a@example.test");
    viewer = await createUser(A, "EMPLOYEE", "viewer-a@example.test");
    driverUser = await createUser(A, "DRIVER", "driver-a@example.test");
  });

  afterAll(async () => {
    await disconnect?.();
  });

  describe("authentication", () => {
    it("rejects unauthenticated requests and bad credentials", async () => {
      expect((await request(app).get("/api/vehicles")).status).toBe(401);
      expect((await request(app).get("/api/vehicles").set({ Authorization: "Bearer not-a-token" })).status).toBe(401);
      const bad = await request(app).post("/api/auth/login").send({ email: "admin-a@example.test", password: "wrong-pass1" });
      expect(bad.status).toBe(401);
    });

    it("normalises email and supports cookie sessions", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: "  ADMIN-A@Example.TEST ", password: "Passw0rd!" });
      expect(res.status).toBe(200);
      const cookie = res.headers["set-cookie"];
      expect(String(cookie)).toMatch(/rs_token=.*HttpOnly/i);
      const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe("ADMIN");
      expect(me.body.permissions).toContain("users:manage");
      expect(me.body.user.passwordHash).toBeUndefined();
    });

    it("rejects weak passwords and duplicate emails", async () => {
      const weak = await request(app).post("/api/auth/register-company").send({ companyName: "X", adminName: "Y Z", email: "w@example.test", password: "short" });
      expect(weak.status).toBe(400);
      const dup = await request(app).post("/api/auth/register-company").send({ companyName: "Dup Co", adminName: "Dup Admin", email: "admin-a@example.test", password: "Passw0rd!" });
      expect(dup.status).toBe(409);
    });

    it("blocks deactivated users immediately", async () => {
      const temp = await createUser(A, "EMPLOYEE", "temp-a@example.test");
      const list = await request(app).get("/api/users").set(auth(A));
      const id = list.body.find((u: { email: string }) => u.email === "temp-a@example.test").id;
      expect((await request(app).patch(`/api/users/${id}`).set(auth(A)).send({ isActive: false })).status).toBe(200);
      expect((await request(app).get("/api/vehicles").set(auth(temp))).status).toBe(401);
    });
  });

  describe("fleet setup and role permissions", () => {
    it("creates locations, vehicles, drivers and orders", async () => {
      const loc = async (name: string, lat: number, lng: number, type = "CUSTOMER") => {
        const r = await request(app).post("/api/locations").set(auth(A)).send({ name, lat, lng, type });
        expect(r.status).toBe(201);
        return r.body.id as number;
      };
      ids.depot = await loc("Depot", 19.0, 73.0, "DEPOT");
      ids.wh = await loc("Warehouse", 19.03, 73.02, "WAREHOUSE");
      ids.c1 = await loc("Customer 1", 19.08, 72.98);
      ids.c2 = await loc("Customer 2", 19.1, 73.06);
      ids.c3 = await loc("Customer 3", 18.98, 73.09);

      const v = await request(app).post("/api/vehicles").set(auth(A)).send({ registrationNumber: "mh 04 ab 1111", type: "TRUCK", capacityKg: 5000, fuelType: "DIESEL", mileageKmPerUnit: 8, depotLocationId: ids.depot });
      expect(v.status).toBe(201);
      expect(v.body.registrationNumber).toBe("MH04AB1111");
      ids.v1 = v.body.id;
      const v2 = await request(app).post("/api/vehicles").set(auth(A)).send({ registrationNumber: "MH04AB2222", type: "VAN", capacityKg: 800, fuelType: "ELECTRIC", mileageKmPerUnit: 6.5, depotLocationId: ids.depot });
      ids.v2 = v2.body.id;

      const future = new Date(Date.now() + 365 * 86400000).toISOString();
      const d1 = await request(app).post("/api/drivers").set(auth(A)).send({ name: "Driver One", phone: "+91 90000 00001", licenseNumber: "MH0120200000001", licenseExpiry: future, userId: driverUser.userId });
      expect(d1.status).toBe(201);
      ids.d1 = d1.body.id;
      const d2 = await request(app).post("/api/drivers").set(auth(A)).send({ name: "Driver Two", phone: "+91 90000 00002", licenseNumber: "MH0120200000002", licenseExpiry: future });
      ids.d2 = d2.body.id;

      const order = async (drop: number, weightKg: number, priority = "NORMAL") => {
        const r = await request(app).post("/api/orders").set(auth(dispatcher)).send({ customerName: "Cust", pickupLocationId: ids.wh, dropLocationId: drop, weightKg, priority });
        expect(r.status).toBe(201);
        return r.body.id as number;
      };
      ids.o1 = await order(ids.c1, 1200, "HIGH");
      ids.o2 = await order(ids.c2, 900);
      ids.o3 = await order(ids.c3, 400, "URGENT");
    });

    it("enforces role permissions", async () => {
      const veh = { registrationNumber: "MH04ZZ9999", type: "VAN", capacityKg: 500, fuelType: "DIESEL", mileageKmPerUnit: 10 };
      expect((await request(app).post("/api/vehicles").set(auth(viewer)).send(veh)).status).toBe(403);
      expect((await request(app).post("/api/vehicles").set(auth(dispatcher)).send(veh)).status).toBe(403);
      expect((await request(app).post("/api/orders").set(auth(viewer)).send({})).status).toBe(403);
      expect((await request(app).get("/api/users").set(auth(dispatcher))).status).toBe(403);
      expect((await request(app).get("/api/vehicles").set(auth(viewer))).status).toBe(200);
      expect((await request(app).get("/api/vehicles").set(auth(driverUser))).status).toBe(403);
    });

    it("validates input", async () => {
      const r = await request(app).post("/api/orders").set(auth(A)).send({ customerName: "X", pickupLocationId: ids.wh, dropLocationId: ids.wh, weightKg: -1 });
      expect(r.status).toBe(400);
      expect(r.body.error.details.length).toBeGreaterThan(0);
      expect((await request(app).get("/api/vehicles/abc").set(auth(A))).status).toBe(400);
    });

    it("uploads documents with signature checks and serves them only to the owner", async () => {
      const ok = await request(app).post("/api/documents").set(auth(A)).field("type", "INSURANCE").field("documentNumber", "INS-1").field("vehicleId", String(ids.v1)).field("expiresOn", new Date(Date.now() + 200 * 86400000).toISOString()).attach("file", PNG, { filename: "ins.png", contentType: "image/png" });
      expect(ok.status).toBe(201);
      expect(ok.body.hasFile).toBe(true);
      expect(ok.body.storageKey).toBeUndefined();
      ids.doc = ok.body.id;
      const spoof = await request(app).post("/api/documents").set(auth(A)).field("type", "PUC").field("documentNumber", "P1").field("vehicleId", String(ids.v1)).attach("file", Buffer.from("not really a pdf"), { filename: "x.pdf", contentType: "application/pdf" });
      expect(spoof.status).toBe(400);
      const exe = await request(app).post("/api/documents").set(auth(A)).field("type", "PUC").field("documentNumber", "P1").field("vehicleId", String(ids.v1)).attach("file", Buffer.from("MZ"), { filename: "x.exe", contentType: "application/x-msdownload" });
      expect(exe.status).toBe(400);
      const dl = await request(app).get(`/api/documents/${ids.doc}/file`).set(auth(A));
      expect(dl.status).toBe(200);
      expect(dl.headers["content-type"]).toMatch(/image\/png/);
    });
  });

  describe("tenant isolation", () => {
    it("hides company A records from company B on read, update and delete", async () => {
      expect((await request(app).get(`/api/vehicles/${ids.v1}`).set(auth(B))).status).toBe(404);
      expect((await request(app).patch(`/api/vehicles/${ids.v1}`).set(auth(B)).send({ capacityKg: 1 })).status).toBe(404);
      expect((await request(app).delete(`/api/vehicles/${ids.v1}`).set(auth(B))).status).toBe(404);
      expect((await request(app).get(`/api/drivers/${ids.d1}`).set(auth(B))).status).toBe(404);
      expect((await request(app).get(`/api/orders/${ids.o1}`).set(auth(B))).status).toBe(404);
      expect((await request(app).post(`/api/orders/${ids.o1}/cancel`).set(auth(B))).status).toBe(404);
      expect((await request(app).get(`/api/documents/${ids.doc}/file`).set(auth(B))).status).toBe(404);
      expect((await request(app).delete(`/api/documents/${ids.doc}`).set(auth(B))).status).toBe(404);
      expect((await request(app).patch(`/api/locations/${ids.depot}`).set(auth(B)).send({ name: "hacked" })).status).toBe(404);
      const list = await request(app).get("/api/vehicles").set(auth(B));
      expect(list.body).toHaveLength(0);
    });

    it("prevents B from referencing A's records in its own writes", async () => {
      const r = await request(app).post("/api/orders").set(auth(B)).send({ customerName: "X", pickupLocationId: ids.wh, dropLocationId: ids.c1, weightKg: 10 });
      expect(r.status).toBe(400);
      const v = await request(app).post("/api/vehicles").set(auth(B)).send({ registrationNumber: "KA01AA0001", type: "VAN", capacityKg: 500, fuelType: "DIESEL", mileageKmPerUnit: 10, depotLocationId: ids.depot });
      expect(v.status).toBe(400);
      const opt = await request(app).post("/api/optiroute/runs").set(auth(B)).send({ orderIds: [ids.o1] });
      expect(opt.status).toBe(400);
    });

    it("stores optional location-search details and keeps them per company", async () => {
      const r = await request(app)
        .post("/api/locations")
        .set(auth(A))
        .send({ name: "Bhiwandi Logistics Park", lat: 19.2813, lng: 73.0483, type: "WAREHOUSE", address: "Mankoli, Bhiwandi, Maharashtra 421302, India", city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", placeProvider: "locationiq", providerPlaceId: "321", coordsSource: "SEARCH" });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ city: "Bhiwandi", state: "Maharashtra", postalCode: "421302", country: "India", placeProvider: "locationiq", providerPlaceId: "321", coordsSource: "SEARCH" });

      // Locations created without the new fields default to MANUAL with empty details.
      const plain = await request(app).get("/api/locations").set(auth(A));
      const depot = plain.body.find((l: { id: number }) => l.id === ids.depot);
      expect(depot).toMatchObject({ coordsSource: "MANUAL", city: null, postalCode: null, placeProvider: null });

      // Moving the pin: only the sent fields change.
      const moved = await request(app).patch(`/api/locations/${r.body.id}`).set(auth(A)).send({ lat: 19.282, lng: 73.049, coordsSource: "PIN_ADJUSTED" });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ coordsSource: "PIN_ADJUSTED", city: "Bhiwandi", providerPlaceId: "321" });
      // Blank text clears a field.
      const cleared = await request(app).patch(`/api/locations/${r.body.id}`).set(auth(A)).send({ postalCode: "  " });
      expect(cleared.body.postalCode).toBeNull();

      expect((await request(app).post("/api/locations").set(auth(A)).send({ name: "Bad", lat: 19, lng: 73, coordsSource: "GPS" })).status).toBe(400);
      expect((await request(app).post("/api/locations").set(auth(A)).send({ name: "Bad", lat: 19, lng: 73, placeProvider: "google" })).status).toBe(400);
      expect((await request(app).post("/api/locations").set(auth(A)).send({ name: "Bad", lat: 19, lng: 73, postalCode: "x".repeat(13) })).status).toBe(400);

      // Tenant isolation for the new fields.
      expect((await request(app).patch(`/api/locations/${r.body.id}`).set(auth(B)).send({ city: "hacked" })).status).toBe(404);
      const bList = await request(app).get("/api/locations").set(auth(B));
      expect(bList.body.some((l: { providerPlaceId: string | null }) => l.providerPlaceId === "321")).toBe(false);
      await request(app).delete(`/api/locations/${r.body.id}`).set(auth(A)).expect(204);
    });

    it("stores states and union territories under their canonical names", async () => {
      const make = async (state: string) =>
        (await request(app).post("/api/locations").set(auth(A)).send({ name: `State ${state}`, lat: 20, lng: 78, state, city: "Somewhere", postalCode: "110001" })).body;
      expect((await make("NCT of Delhi")).state).toBe("Delhi");
      expect((await make("orissa")).state).toBe("Odisha");
      expect((await make("Jammu & Kashmir")).state).toBe("Jammu and Kashmir");
      // Not a state/UT name: kept as typed (manual entries outside the list are allowed).
      expect((await make("Some Province")).state).toBe("Some Province");
      const loc = await make("maharashtra");
      expect(loc.state).toBe("Maharashtra");
      const patched = await request(app).patch(`/api/locations/${loc.id}`).set(auth(A)).send({ state: "Pondicherry", city: " Puducherry ", postalCode: "605001" });
      expect(patched.body).toMatchObject({ state: "Puducherry", city: "Puducherry", postalCode: "605001" });
      const list = await request(app).get("/api/locations").set(auth(A));
      for (const l of list.body.filter((x: { name: string }) => x.name.startsWith("State "))) await request(app).delete(`/api/locations/${l.id}`).set(auth(A)).expect(204);
    });

    it("location search endpoints are protected and report when search is not configured", async () => {
      // Tests run with PLACES_PROVIDER=none, so no provider is ever contacted.
      const status = await request(app).get("/api/places/status").set(auth(viewer));
      expect(status.body).toMatchObject({ enabled: false, reverse: false });
      expect((await request(app).get("/api/places/reverse?lat=19&lng=73").set(auth(viewer))).status).toBe(403);
      const reverse = await request(app).get("/api/places/reverse?lat=19&lng=73").set(auth(dispatcher));
      expect(reverse.status).toBe(503);
      expect(reverse.body.error.code).toBe("PLACES_DISABLED");
      expect((await request(app).get("/api/places/reverse?lat=19&lng=73")).status).toBe(401);
    });

    it("ignores a client-supplied companyId", async () => {
      const r = await request(app).post("/api/locations").set(auth(B)).send({ name: "B depot", lat: 12.9, lng: 77.5, type: "DEPOT", companyId: A.companyId });
      expect(r.status).toBe(201);
      expect(r.body.companyId).toBe(B.companyId);
    });
  });

  describe("OptiRoute → trips → billing", () => {
    let runId: number;
    let tripId: number;

    it("rejects invalid optimization input", async () => {
      expect((await request(app).post("/api/optiroute/runs").set(auth(A)).send({ weights: { time: -5 } })).status).toBe(400);
      expect((await request(app).post("/api/optiroute/runs").set(auth(A)).send({ algorithm: "QUANTUM" })).status).toBe(400);
      expect((await request(app).post("/api/optiroute/runs").set(auth(A)).send({ orderIds: [999999] })).status).toBe(400);
      expect((await request(app).post("/api/optiroute/runs").set(auth(viewer)).send({})).status).toBe(403);
    });

    it("plans all pending orders, persists the run and explains assumptions", async () => {
      const r = await request(app).post("/api/optiroute/runs").set(auth(dispatcher)).send({ algorithm: "LOCAL_SEARCH", seed: 3 });
      expect(r.status).toBe(201);
      expect(r.body.feasible).toBe(true);
      expect(r.body.distanceSource).toBe("HAVERSINE_ESTIMATE");
      expect(r.body.result.violations).toEqual([]);
      expect(r.body.result.unserved).toHaveLength(0);
      expect(r.body.result.assumptions.length).toBeGreaterThan(2);
      runId = r.body.id;
      const list = await request(app).get("/api/optiroute/runs").set(auth(A));
      expect(list.body.map((x: { id: number }) => x.id)).toContain(runId);
      expect((await request(app).get(`/api/optiroute/runs/${runId}`).set(auth(B))).status).toBe(404);
    });

    it("dispatches the plan into trips exactly once", async () => {
      const r = await request(app).post(`/api/optiroute/runs/${runId}/dispatch`).set(auth(dispatcher));
      expect(r.status).toBe(201);
      expect(r.body.trips.length).toBeGreaterThan(0);
      tripId = r.body.trips.find((t: { driverId: number }) => t.driverId === ids.d1)?.id ?? r.body.trips[0].id;
      expect((await request(app).post(`/api/optiroute/runs/${runId}/dispatch`).set(auth(dispatcher))).status).toBe(409);
      const order = await request(app).get(`/api/orders/${ids.o1}`).set(auth(A));
      expect(order.body.status).toBe("ASSIGNED");
    });

    it("runs the trip lifecycle with state checks and driver restrictions", async () => {
      expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(A)).send({ status: "COMPLETED" })).status).toBe(409);
      expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(B)).send({ status: "DISPATCHED" })).status).toBe(404);
      expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(A)).send({ status: "DISPATCHED" })).status).toBe(200);
      const trip = await request(app).get(`/api/trips/${tripId}`).set(auth(A));
      expect(trip.body.vehicle.status).toBe("ON_TRIP");
      const ownTrip = trip.body.driverId === ids.d1;
      const actor = ownTrip ? driverUser : A;
      if (ownTrip) {
        expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(driverUser)).send({ status: "CANCELLED" })).status).toBe(403);
      }
      expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(actor)).send({ status: "IN_TRANSIT" })).status).toBe(200);
      const live = await request(app).get(`/api/trips/${tripId}`).set(auth(A));
      expect(live.body.simulatedPosition?.simulated ?? true).toBe(true);
      const stops = live.body.stops.filter((s: { type: string }) => s.type === "PICKUP" || s.type === "DROP");
      const firstDrop = stops.find((s: { type: string }) => s.type === "DROP");
      expect((await request(app).post(`/api/trips/${tripId}/stops/${firstDrop.id}`).set(auth(actor)).send({ action: "COMPLETE" })).status).toBe(409);
      expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(actor)).send({ status: "COMPLETED" })).status).toBe(409);
      for (const s of stops.filter((x: { type: string }) => x.type === "PICKUP")) {
        expect((await request(app).post(`/api/trips/${tripId}/stops/${s.id}`).set(auth(actor)).send({ action: "COMPLETE" })).status).toBe(200);
      }
      for (const s of stops.filter((x: { type: string }) => x.type === "DROP")) {
        expect((await request(app).post(`/api/trips/${tripId}/stops/${s.id}`).set(auth(actor)).send({ action: "COMPLETE" })).status).toBe(200);
      }
      expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(actor)).send({ status: "COMPLETED" })).status).toBe(200);
      const done = await request(app).get(`/api/trips/${tripId}`).set(auth(A));
      expect(done.body.status).toBe("COMPLETED");
      expect(done.body.vehicle.status).toBe("AVAILABLE");
      expect(done.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(["PLANNED", "DISPATCHED", "IN_TRANSIT", "COMPLETED"]);
      for (const s of stops) expect(s.order === null || ["DELIVERED"].includes((await request(app).get(`/api/orders/${s.order.id}`).set(auth(A))).body.status)).toBe(true);
    });

    it("creates, issues and publicly verifies an invoice via QR token", async () => {
      const inv = await request(app).post("/api/billing").set(auth(A)).send({ kind: "INVOICE", tripId, customerName: "Cust", taxRatePercent: 18, items: [{ description: "Freight", quantity: 1, rate: 10000 }] });
      expect(inv.status).toBe(201);
      expect(inv.body.total).toBe(11800);
      expect(inv.body.number).toMatch(/^INV-\d{4}-0001$/);
      expect((await request(app).post(`/api/billing/${inv.body.id}/mark-paid`).set(auth(A))).status).toBe(409);
      expect((await request(app).post(`/api/billing/${inv.body.id}/issue`).set(auth(A))).status).toBe(200);
      expect((await request(app).put(`/api/billing/${inv.body.id}`).set(auth(A)).send({ customerName: "X", items: [{ description: "a", quantity: 1, rate: 1 }] })).status).toBe(409);
      const qr = await request(app).get(`/api/billing/${inv.body.id}/qr`).set(auth(A));
      expect(qr.body.dataUrl).toMatch(/^data:image\/png;base64,/);
      const token = qr.body.url.split("/verify/")[1];
      const pub = await request(app).get(`/api/public/verify/${token}`);
      expect(pub.status).toBe(200);
      expect(pub.body).toMatchObject({ valid: true, type: "INVOICE", status: "ISSUED", total: 11800 });
      expect(pub.body.id).toBeUndefined();
      expect((await request(app).get("/api/public/verify/does-not-exist-token-123")).status).toBe(404);
      expect((await request(app).get(`/api/billing/${inv.body.id}`).set(auth(B))).status).toBe(404);
      const tripQr = await request(app).get(`/api/trips/${tripId}/qr`).set(auth(A));
      const tripPub = await request(app).get(`/api/public/verify/${tripQr.body.url.split("/verify/")[1]}`);
      expect(tripPub.body.type).toBe("TRIP");
    });
  });

  describe("eligibility, scenarios and analytics", () => {
    it("excludes vehicles with expired compliance documents", async () => {
      const doc = await request(app).post("/api/documents").set(auth(A)).send({ type: "PUC", documentNumber: "PUC-OLD", vehicleId: ids.v2, expiresOn: new Date(Date.now() - 86400000).toISOString() });
      expect(doc.status).toBe(201);
      const ord = await request(app).post("/api/orders").set(auth(A)).send({ customerName: "Cust C", pickupLocationId: ids.wh, dropLocationId: ids.c2, weightKg: 300 });
      expect(ord.status).toBe(201);
      const r = await request(app).post("/api/optiroute/runs").set(auth(A)).send({ algorithm: "GREEDY_INSERTION" });
      expect(r.status).toBe(201);
      const ex = r.body.result.exclusions.find((e: { id: number; kind: string }) => e.kind === "VEHICLE" && e.id === ids.v2);
      expect(ex.reason).toMatch(/PUC expired/);
      ids.run2 = r.body.id;
    });

    it("evaluates a breakdown scenario, compares plans and applies it on approval", async () => {
      const bad = await request(app).post("/api/scenarios").set(auth(A)).send({ type: "VEHICLE_BREAKDOWN", name: "x", baseRunId: ids.run2, params: { vehicleId: 999999 } });
      expect(bad.status).toBe(400);
      const sc = await request(app).post("/api/scenarios").set(auth(dispatcher)).send({ type: "URGENT_ORDER", name: "Urgent pharma", baseRunId: ids.run2, params: { customerName: "Hospital", pickupLocationId: ids.wh, dropLocationId: ids.c3, weightKg: 100 } });
      expect(sc.status).toBe(201);
      expect(sc.body.comparison.scenario.servedOrders).toBeGreaterThanOrEqual(sc.body.comparison.base.servedOrders);
      expect((await request(app).post(`/api/scenarios/${sc.body.id}/approve`).set(auth(dispatcher))).status).toBe(403);
      const ok = await request(app).post(`/api/scenarios/${sc.body.id}/approve`).set(auth(A)).send({ note: "go" });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("APPROVED");
      const orders = await request(app).get("/api/orders?priority=URGENT&status=PENDING").set(auth(A));
      expect(orders.body.some((o: { customerName: string }) => o.customerName === "Hospital")).toBe(true);
      const run = await request(app).get(`/api/optiroute/runs/${sc.body.resultRunId}`).set(auth(A));
      expect(JSON.stringify(run.body.result.routes)).not.toMatch(/"orderId":-1/);
      expect((await request(app).post(`/api/optiroute/runs/${sc.body.resultRunId}/dispatch`).set(auth(A))).status).toBe(201);

      // Base plan only had one eligible truck: a breakdown leaves nothing to plan with.
      const br = await request(app).post("/api/scenarios").set(auth(A)).send({ type: "VEHICLE_BREAKDOWN", name: "Truck down", baseRunId: ids.run2, params: { vehicleId: ids.v1 } });
      expect(br.status).toBe(422);
      const du = await request(app).post("/api/scenarios").set(auth(A)).send({ type: "DRIVER_UNAVAILABLE", name: "Driver sick", baseRunId: ids.run2, params: { driverId: ids.d1 } });
      expect(du.status).toBe(201);
      expect(du.body.comparison.delta).toBeDefined();
      const rej = await request(app).post(`/api/scenarios/${du.body.id}/reject`).set(auth(A)).send({});
      expect(rej.body.status).toBe("REJECTED");
    });

    it("returns GreenFleet estimates with assumptions and a control tower snapshot", async () => {
      const est = await request(app).post("/api/greenfleet/estimate").set(auth(A)).send({ distanceKm: 100, loadKg: 500 });
      expect(est.status).toBe(200);
      expect(est.body.kind).toBe("ESTIMATE");
      expect(est.body.rows.length).toBeGreaterThan(0);
      expect(est.body.assumptions.emissionKgPerUnit.DIESEL).toBe(2.68);
      const sum = await request(app).get("/api/greenfleet/summary").set(auth(A));
      expect(sum.status).toBe(200);
      const ct = await request(app).get("/api/control-tower").set(auth(viewer));
      expect(ct.status).toBe(200);
      expect(ct.body.alerts.some((a: { type: string }) => a.type === "DOCUMENT_EXPIRY")).toBe(true);
      expect(ct.body.telemetryNote).toMatch(/SIMULATED/);
      const audit = await request(app).get("/api/audit").set(auth(A));
      expect(audit.body.some((e: { action: string }) => e.action === "optimization.dispatched")).toBe(true);
      const bAudit = await request(app).get("/api/audit").set(auth(B));
      expect(bAudit.body.every((e: { companyId: number }) => e.companyId === B.companyId)).toBe(true);
    });
  });

  describe("concurrency safety (parallel requests)", () => {
    // A fresh company so these tests do not depend on state left by earlier ones.
    let C: Tenant;
    const c: Record<string, number> = {};
    const statuses = (rs: Array<{ status: number }>) => rs.map((r) => r.status).sort();

    beforeAll(async () => {
      C = await registerCompany("c");
      const loc = async (name: string, lat: number, lng: number, type = "CUSTOMER") =>
        (await request(app).post("/api/locations").set(auth(C)).send({ name, lat, lng, type })).body.id as number;
      c.depot = await loc("C Depot", 19.0, 73.0, "DEPOT");
      c.wh = await loc("C Warehouse", 19.03, 73.02, "WAREHOUSE");
      c.cust = await loc("C Customer", 19.08, 72.98);
      const future = new Date(Date.now() + 365 * 86400000).toISOString();
      for (const i of [1, 2, 3, 4]) {
        const v = await request(app).post("/api/vehicles").set(auth(C)).send({ registrationNumber: `KA01CC000${i}`, type: "TRUCK", capacityKg: 5000, fuelType: "DIESEL", mileageKmPerUnit: 8, depotLocationId: c.depot });
        expect(v.status).toBe(201);
        c[`v${i}`] = v.body.id;
        const d = await request(app).post("/api/drivers").set(auth(C)).send({ name: `C Driver ${i}`, phone: `+91 90000 1000${i}`, licenseNumber: `KA0120200000${i}0`, licenseExpiry: future });
        expect(d.status).toBe(201);
        c[`d${i}`] = d.body.id;
      }
      for (const i of [1, 2, 3]) {
        const o = await request(app).post("/api/orders").set(auth(C)).send({ customerName: `C Cust ${i}`, pickupLocationId: c.wh, dropLocationId: c.cust, weightKg: 300 });
        expect(o.status).toBe(201);
        c[`o${i}`] = o.body.id;
      }
    });

    const plan = async (orderIds: number[], vehicleId: number, driverId: number) => {
      const r = await request(app).post("/api/optiroute/runs").set(auth(C)).send({ algorithm: "GREEDY_INSERTION", orderIds, vehicleIds: [vehicleId], assignments: [{ vehicleId, driverId }] });
      expect(r.status).toBe(201);
      expect(r.body.feasible).toBe(true);
      expect(r.body.result.unserved).toHaveLength(0);
      return r.body.id as number;
    };

    it("dispatches the same plan only once under parallel requests", async () => {
      c.run1 = await plan([c.o1], c.v1, c.d1);
      const rs = await Promise.all(Array.from({ length: 5 }, () => request(app).post(`/api/optiroute/runs/${c.run1}/dispatch`).set(auth(C))));
      expect(statuses(rs)).toEqual([201, 409, 409, 409, 409]);
      const run = await request(app).get(`/api/optiroute/runs/${c.run1}`).set(auth(C));
      expect(run.body.trips).toHaveLength(1);
      c.trip1 = run.body.trips[0].id;
    });

    it("never assigns the same order to two plans dispatched in parallel", async () => {
      // Different vehicles and drivers, same orders: only the order claim can stop the second plan.
      const runA = await plan([c.o2, c.o3], c.v2, c.d2);
      const runB = await plan([c.o2, c.o3], c.v3, c.d3);
      const rs = await Promise.all([runA, runB].map((id) => request(app).post(`/api/optiroute/runs/${id}/dispatch`).set(auth(C))));
      expect(statuses(rs)).toEqual([201, 409]);
      const trips = await request(app).get("/api/trips").set(auth(C));
      const active = trips.body.filter((t: { status: string }) => t.status !== "CANCELLED");
      // trip1 from the previous test + exactly one trip from runA or runB.
      expect(active).toHaveLength(2);
      for (const id of [c.o2, c.o3]) {
        const o = await request(app).get(`/api/orders/${id}`).set(auth(C));
        expect(o.body.status).toBe("ASSIGNED");
        expect(o.body.tripStops.filter((s: { type?: string; trip: { status: string } }) => s.trip.status !== "CANCELLED").length).toBe(2); // one pickup + one drop
      }
      c.baseRun = rs[0].status === 201 ? runA : runB;
    });

    it("applies a trip status transition only once under parallel requests", async () => {
      const rs = await Promise.all(Array.from({ length: 4 }, () => request(app).post(`/api/trips/${c.trip1}/status`).set(auth(C)).send({ status: "DISPATCHED" })));
      expect(statuses(rs)).toEqual([200, 409, 409, 409]);
      const trip = await request(app).get(`/api/trips/${c.trip1}`).set(auth(C));
      expect(trip.body.events.filter((e: { toStatus: string }) => e.toStatus === "DISPATCHED")).toHaveLength(1);
      expect(trip.body.vehicle.status).toBe("ON_TRIP");
    });

    it("updates a stop only once under parallel requests", async () => {
      expect((await request(app).post(`/api/trips/${c.trip1}/status`).set(auth(C)).send({ status: "IN_TRANSIT" })).status).toBe(200);
      const trip = await request(app).get(`/api/trips/${c.trip1}`).set(auth(C));
      const pickup = trip.body.stops.find((s: { type: string }) => s.type === "PICKUP");
      const rs = await Promise.all(Array.from({ length: 4 }, () => request(app).post(`/api/trips/${c.trip1}/stops/${pickup.id}`).set(auth(C)).send({ action: "ARRIVE" })));
      expect(statuses(rs)).toEqual([200, 409, 409, 409]);
    });

    it("approves a scenario only once under parallel requests", async () => {
      const sc = await request(app).post("/api/scenarios").set(auth(C)).send({ type: "URGENT_ORDER", name: "Parallel approval", baseRunId: c.baseRun, params: { customerName: "Concurrent Hospital", pickupLocationId: c.wh, dropLocationId: c.cust, weightKg: 50 } });
      expect(sc.status).toBe(201);
      const rs = await Promise.all(Array.from({ length: 3 }, () => request(app).post(`/api/scenarios/${sc.body.id}/approve`).set(auth(C)).send({})));
      expect(statuses(rs)).toEqual([200, 409, 409]);
      const orders = await request(app).get("/api/orders").set(auth(C));
      expect(orders.body.filter((o: { customerName: string }) => o.customerName === "Concurrent Hospital")).toHaveLength(1);
      const reject = await request(app).post(`/api/scenarios/${sc.body.id}/reject`).set(auth(C)).send({});
      expect(reject.status).toBe(409);
    });

    it("does not verify DRAFT invoices as valid", async () => {
      const inv = await request(app).post("/api/billing").set(auth(C)).send({ kind: "INVOICE", customerName: "Draft Cust", taxRatePercent: 18, items: [{ description: "Freight", quantity: 1, rate: 100 }] });
      expect(inv.status).toBe(201);
      const qr = await request(app).get(`/api/billing/${inv.body.id}/qr`).set(auth(C));
      const pub = await request(app).get(`/api/public/verify/${qr.body.url.split("/verify/")[1]}`);
      expect(pub.body).toMatchObject({ valid: false, status: "DRAFT" });
    });

    it("returns 400, not 500, for a malformed GreenFleet vehicle id", async () => {
      expect((await request(app).get("/api/greenfleet/vehicle/abc").set(auth(C))).status).toBe(400);
    });
  });
});
