import { readdir } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const enabled = !!process.env.TEST_DATABASE_URL;
type App = Parameters<typeof request>[0];
let app: App;
let prisma: typeof import("../../src/config/prisma").prisma;
let hooks: typeof import("../../src/modules/shipments/pods.routes").podTestHooks;

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

describe.skipIf(!enabled)("proof of delivery is atomic, idempotent and leaves no orphans (integration)", () => {
  let A: { token: string; companyId: number };
  let tripId: number;
  const drop: Record<string, number> = {};
  const order: Record<string, number> = {};

  /** Stored objects for this company on the local test storage (UPLOAD_DIR=./.test-uploads). */
  const storedFiles = async () => (await readdir(path.resolve(process.env.UPLOAD_DIR ?? "./.test-uploads", String(A.companyId))).catch(() => [])).length;
  const attachmentRows = () => prisma.attachment.count({ where: { companyId: A.companyId } });

  const pod = (fields: Record<string, string | number>, files: { signature?: boolean; photos?: Array<{ data: Buffer; name: string; type: string }> } = { signature: true }) => {
    const r = request(app).post("/api/pods").set(auth(A));
    for (const [k, v] of Object.entries(fields)) r.field(k, String(v));
    if (files.signature) r.attach("signature", PNG, { filename: "sig.png", contentType: "image/png" });
    for (const p of files.photos ?? []) r.attach("photos", p.data, { filename: p.name, contentType: p.type });
    return r;
  };

  beforeAll(async () => {
    const mod = await import("../../src/app");
    prisma = (await import("../../src/config/prisma")).prisma;
    hooks = (await import("../../src/modules/shipments/pods.routes")).podTestHooks;
    app = mod.createApp();
    const reg = await request(app).post("/api/auth/register-company").send({ companyName: "POD Co", adminName: "Admin", email: "pod-admin@example.test", password: "Passw0rd!" });
    A = { token: reg.body.token, companyId: reg.body.company.id };
    const loc = async (name: string, lat: number, lng: number, type: string) => (await request(app).post("/api/locations").set(auth(A)).send({ name, lat, lng, type })).body.id as number;
    const depot = await loc("POD Depot", 19.07, 72.88, "DEPOT");
    const c1 = await loc("POD Customer 1", 19.1, 72.9, "CUSTOMER");
    const c2 = await loc("POD Customer 2", 19.12, 72.86, "CUSTOMER");
    const v = await request(app).post("/api/vehicles").set(auth(A)).send({ registrationNumber: "MH01PD0001", type: "TRUCK", capacityKg: 5000, fuelType: "DIESEL", mileageKmPerUnit: 6, depotLocationId: depot });
    const d = await request(app).post("/api/drivers").set(auth(A)).send({ name: "POD Driver", phone: "+91 90000 30001", licenseNumber: "MH0120200030001", licenseExpiry: new Date(Date.now() + 400 * 86400000).toISOString() });
    for (const [key, to] of [["one", c1], ["two", c2]] as const) {
      const o = await request(app).post("/api/orders").set(auth(A)).send({ customerName: `POD customer ${key}`, pickupLocationId: depot, dropLocationId: to, weightKg: 400 });
      order[key] = o.body.id;
    }
    const t = await request(app).post("/api/trips").set(auth(A)).send({ vehicleId: v.body.id, driverId: d.body.id, orderIds: [order.one, order.two] });
    expect(t.status).toBe(201);
    tripId = t.body.id;
    expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(A)).send({ status: "DISPATCHED" })).status).toBe(200);
    expect((await request(app).post(`/api/trips/${tripId}/status`).set(auth(A)).send({ status: "IN_TRANSIT" })).status).toBe(200);
    const stops = (await request(app).get(`/api/trips/${tripId}`).set(auth(A))).body.stops as Array<{ id: number; type: string; orderId: number }>;
    for (const s of stops.filter((x) => x.type === "PICKUP")) expect((await request(app).post(`/api/trips/${tripId}/stops/${s.id}`).set(auth(A)).send({ action: "COMPLETE" })).status).toBe(200);
    drop.one = stops.find((s) => s.type === "DROP" && s.orderId === order.one)!.id;
    drop.two = stops.find((s) => s.type === "DROP" && s.orderId === order.two)!.id;
  });

  afterEach(() => {
    hooks.failAfterStopUpdate = false;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const state = async (stopId: number, orderId: number) => ({
    stop: (await prisma.tripStop.findUniqueOrThrow({ where: { id: stopId } })).status,
    order: (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    pods: await prisma.proofOfDelivery.count({ where: { tripStopId: stopId } }),
  });

  it("rolls back the stop, order, POD and files when a failure happens after the stop update", async () => {
    const filesBefore = await storedFiles();
    const rowsBefore = await attachmentRows();
    hooks.failAfterStopUpdate = true;
    const r = await pod({ tripId, tripStopId: drop.one, status: "DELIVERED", receiverName: "Rakesh" }, { signature: true, photos: [{ data: JPG, name: "goods.jpg", type: "image/jpeg" }] });
    expect(r.status).toBe(500);
    expect(await state(drop.one, order.one)).toEqual({ stop: "PENDING", order: "IN_TRANSIT", pods: 0 });
    expect(await attachmentRows()).toBe(rowsBefore);
    expect(await storedFiles()).toBe(filesBefore); // uploaded objects were removed again
    const audit = await prisma.auditEvent.count({ where: { companyId: A.companyId, action: { in: ["pod.recorded", "trip.stop_complete"] }, metadata: { path: ["stopId"], equals: drop.one } } });
    expect(audit).toBe(0); // the stop audit row rolled back with the rest
  });

  it("succeeds on retry after the rolled-back attempt", async () => {
    const r = await pod({ tripId, tripStopId: drop.one, status: "DELIVERED", receiverName: "Rakesh" }, { signature: true, photos: [{ data: JPG, name: "goods.jpg", type: "image/jpeg" }] });
    expect(r.status).toBe(201);
    expect(await state(drop.one, order.one)).toEqual({ stop: "COMPLETED", order: "DELIVERED", pods: 1 });
    expect(r.body.attachments.map((a: { role: string }) => a.role).sort()).toEqual(["PHOTO", "SIGNATURE"]);
    expect(await storedFiles()).toBe(await attachmentRows());
  });

  it("answers a repeated submission with 409 naming the existing POD, without side effects", async () => {
    const existing = await prisma.proofOfDelivery.findUniqueOrThrow({ where: { tripStopId: drop.one } });
    const files = await storedFiles();
    const r = await pod({ tripId, tripStopId: drop.one, status: "DELIVERED", receiverName: "Rakesh" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("POD_EXISTS");
    expect(r.body.error.details.podId).toBe(existing.id);
    expect(await storedFiles()).toBe(files);
    expect(await state(drop.one, order.one)).toEqual({ stop: "COMPLETED", order: "DELIVERED", pods: 1 });
  });

  it("lets exactly one of several simultaneous submissions win, with no orphaned files", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map(() => pod({ tripId, tripStopId: drop.two, status: "DELIVERED", receiverName: "Sunita" }, { signature: true, photos: [{ data: JPG, name: "p.jpg", type: "image/jpeg" }] })));
    const statuses = rs.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    // M1: with the trip locked first, every loser sees the winner and names it.
    const winner = rs.find((r) => r.status === 201)!.body.id;
    for (const r of rs.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe("POD_EXISTS");
      expect(r.body.error.details.podId).toBe(winner);
    }
    expect(await state(drop.two, order.two)).toEqual({ stop: "COMPLETED", order: "DELIVERED", pods: 1 });
    const pd = await prisma.proofOfDelivery.findUniqueOrThrow({ where: { tripStopId: drop.two }, include: { attachments: true } });
    expect(pd.attachments).toHaveLength(2);
    expect(await storedFiles()).toBe(await attachmentRows());
  });

});

describe.skipIf(!enabled)("POD versus trip cancellation (integration, M1)", () => {
  /** A fresh company with one IN_TRANSIT trip whose pickup is done; returns what the tests need. */
  async function setup(suffix: string) {
    const mod = await import("../../src/app");
    const app2 = mod.createApp();
    const reg = await request(app2).post("/api/auth/register-company").send({ companyName: `POD Race ${suffix}`, adminName: "Admin", email: `pod-race-${suffix}@example.test`, password: "Passw0rd!" });
    const T = { token: reg.body.token as string, companyId: reg.body.company.id as number };
    const loc = async (name: string, lat: number, type: string) => (await request(app2).post("/api/locations").set(auth(T)).send({ name, lat, lng: 72.8, type })).body.id as number;
    const depot = await loc(`R Depot ${suffix}`, 19.0, "DEPOT");
    const cust = await loc(`R Customer ${suffix}`, 19.06, "CUSTOMER");
    const v = await request(app2).post("/api/vehicles").set(auth(T)).send({ registrationNumber: `MH01RC${suffix}`, type: "VAN", capacityKg: 800, fuelType: "DIESEL", mileageKmPerUnit: 10, depotLocationId: depot });
    const d = await request(app2).post("/api/drivers").set(auth(T)).send({ name: "R Driver", phone: "+91 90000 50001", licenseNumber: `MH01202000${suffix}01`, licenseExpiry: new Date(Date.now() + 400 * 86400000).toISOString() });
    const o = await request(app2).post("/api/orders").set(auth(T)).send({ customerName: "R customer", pickupLocationId: depot, dropLocationId: cust, weightKg: 100 });
    const t = await request(app2).post("/api/trips").set(auth(T)).send({ vehicleId: v.body.id, driverId: d.body.id, orderIds: [o.body.id] });
    await request(app2).post(`/api/trips/${t.body.id}/status`).set(auth(T)).send({ status: "DISPATCHED" });
    await request(app2).post(`/api/trips/${t.body.id}/status`).set(auth(T)).send({ status: "IN_TRANSIT" });
    const stops = (await request(app2).get(`/api/trips/${t.body.id}`).set(auth(T))).body.stops as Array<{ id: number; type: string }>;
    await request(app2).post(`/api/trips/${t.body.id}/stops/${stops.find((s) => s.type === "PICKUP")!.id}`).set(auth(T)).send({ action: "COMPLETE" });
    return { app2, T, tripId: t.body.id as number, dropId: stops.find((s) => s.type === "DROP")!.id, orderId: o.body.id as number };
  }
  const submit = (app2: App, T: { token: string }, tripId: number, dropId: number) =>
    request(app2).post("/api/pods").set(auth(T)).field("tripId", String(tripId)).field("tripStopId", String(dropId)).field("status", "DELIVERED").field("receiverName", "Receiver")
      .attach("signature", PNG, { filename: "sig.png", contentType: "image/png" });

  it("a cancelled trip takes no POD, and nothing is stored", async () => {
    const { app2, T, tripId, dropId } = await setup("01");
    expect((await request(app2).post(`/api/trips/${tripId}/status`).set(auth(T)).send({ status: "CANCELLED" })).status).toBe(200);
    const r = await submit(app2, T, tripId, dropId);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/cancelled/i);
    const dir = path.resolve(process.env.UPLOAD_DIR ?? "./.test-uploads", String(T.companyId));
    expect((await readdir(dir).catch(() => [])).length).toBe(0);
  });

  it("racing cancel and POD always ends in a consistent state", async () => {
    const { app2, T, tripId, dropId, orderId } = await setup("02");
    const [cancel, podRes] = await Promise.all([request(app2).post(`/api/trips/${tripId}/status`).set(auth(T)).send({ status: "CANCELLED" }), submit(app2, T, tripId, dropId)]);
    expect(cancel.status).toBe(200); // IN_TRANSIT → CANCELLED is always allowed
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: dropId } });
    const pods = await prisma.proofOfDelivery.count({ where: { tripStopId: dropId } });
    const files = (await readdir(path.resolve(process.env.UPLOAD_DIR ?? "./.test-uploads", String(T.companyId))).catch(() => [])).length;
    if (podRes.status === 201) {
      // POD won the lock: the delivery happened before the cancellation.
      expect(stop.status).toBe("COMPLETED");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");
      expect(pods).toBe(1);
      expect(files).toBe(1);
    } else {
      // Cancel won: no POD, the stop was skipped, nothing left in storage.
      expect(podRes.status).toBe(409);
      expect(stop.status).toBe("SKIPPED");
      expect(pods).toBe(0);
      expect(files).toBe(0);
    }
  });
});

describe.skipIf(!enabled)("failed delivery outcome is atomic too (integration)", () => {
  it("a FAILED POD skips the stop and returns the order to planning in one step", async () => {
    const mod = await import("../../src/app");
    const db = (await import("../../src/config/prisma")).prisma;
    const app2 = mod.createApp();
    const reg = await request(app2).post("/api/auth/register-company").send({ companyName: "POD Fail Co", adminName: "Admin", email: "pod-fail@example.test", password: "Passw0rd!" });
    const T = { token: reg.body.token as string };
    const loc = async (name: string, lat: number, type: string) => (await request(app2).post("/api/locations").set(auth(T)).send({ name, lat, lng: 72.9, type })).body.id as number;
    const depot = await loc("F Depot", 19.0, "DEPOT");
    const cust = await loc("F Customer", 19.05, "CUSTOMER");
    const v = await request(app2).post("/api/vehicles").set(auth(T)).send({ registrationNumber: "MH01PF0001", type: "VAN", capacityKg: 800, fuelType: "DIESEL", mileageKmPerUnit: 10, depotLocationId: depot });
    const d = await request(app2).post("/api/drivers").set(auth(T)).send({ name: "F Driver", phone: "+91 90000 40001", licenseNumber: "MH0120200040001", licenseExpiry: new Date(Date.now() + 400 * 86400000).toISOString() });
    const o = await request(app2).post("/api/orders").set(auth(T)).send({ customerName: "F customer", pickupLocationId: depot, dropLocationId: cust, weightKg: 100 });
    const t = await request(app2).post("/api/trips").set(auth(T)).send({ vehicleId: v.body.id, driverId: d.body.id, orderIds: [o.body.id] });
    await request(app2).post(`/api/trips/${t.body.id}/status`).set(auth(T)).send({ status: "DISPATCHED" });
    await request(app2).post(`/api/trips/${t.body.id}/status`).set(auth(T)).send({ status: "IN_TRANSIT" });
    const stops = (await request(app2).get(`/api/trips/${t.body.id}`).set(auth(T))).body.stops as Array<{ id: number; type: string }>;
    await request(app2).post(`/api/trips/${t.body.id}/stops/${stops.find((s) => s.type === "PICKUP")!.id}`).set(auth(T)).send({ action: "COMPLETE" });
    const dropId = stops.find((s) => s.type === "DROP")!.id;
    // An invalid photo is rejected before any write: stop untouched, nothing stored.
    const dir = path.resolve(process.env.UPLOAD_DIR ?? "./.test-uploads", String(reg.body.company.id));
    const count = async () => (await readdir(dir).catch(() => [])).length;
    const badPhoto = await request(app2).post("/api/pods").set(auth(T)).field("tripId", String(t.body.id)).field("tripStopId", String(dropId)).field("status", "DELIVERED").field("receiverName", "Guard")
      .attach("signature", PNG, { filename: "sig.png", contentType: "image/png" })
      .attach("photos", Buffer.from("%PDF-1.4"), { filename: "p.pdf", contentType: "application/pdf" });
    expect(badPhoto.status).toBe(400);
    expect((await db.tripStop.findUniqueOrThrow({ where: { id: dropId } })).status).toBe("PENDING");
    expect(await count()).toBe(0);
    const noRemarks = await request(app2).post("/api/pods").set(auth(T)).field("tripId", String(t.body.id)).field("tripStopId", String(dropId)).field("status", "FAILED").field("receiverName", "Guard");
    expect(noRemarks.status).toBe(400);
    expect((await db.tripStop.findUniqueOrThrow({ where: { id: dropId } })).status).toBe("PENDING");
    const r = await request(app2).post("/api/pods").set(auth(T)).field("tripId", String(t.body.id)).field("tripStopId", String(dropId)).field("status", "FAILED").field("receiverName", "Guard").field("remarks", "Premises closed");
    expect(r.status).toBe(201);
    expect((await db.tripStop.findUniqueOrThrow({ where: { id: dropId } })).status).toBe("SKIPPED");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.body.id } })).status).toBe("PENDING");
    await db.$disconnect();
  });
});
