import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = !!process.env.TEST_DATABASE_URL;
type App = Parameters<typeof request>[0];
let app: App;
let disconnect: () => Promise<void>;
const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });
const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

/** Strings that would reveal KYC detail (document type, its label, masked numbers, its own messages). */
const KYC_DETAIL = /KYC_ID|KYC identity proof|XXXX-XXXX|5678/;
const KYC_NEUTRAL = "A KYC record needs attention (details are visible to admins and managers only)";

describe.skipIf(!enabled)("KYC detail never reaches roles without kyc:read (OptiRoute, manual trips, Control Tower)", () => {
  let A: { token: string };
  let manager: { token: string };
  let dispatcher: { token: string };
  let employee: { token: string };
  const id: Record<string, number> = {};

  beforeAll(async () => {
    const mod = await import("../../src/app");
    const prismaMod = await import("../../src/config/prisma");
    app = mod.createApp();
    disconnect = () => prismaMod.prisma.$disconnect();
    const reg = await request(app).post("/api/auth/register-company").send({ companyName: "KYC Redaction Co", adminName: "Admin", email: "kycr-admin@example.test", password: "Passw0rd!" });
    A = { token: reg.body.token };
    const user = async (role: string) => {
      const email = `kycr-${role.toLowerCase()}@example.test`;
      expect((await request(app).post("/api/users").set(auth(A)).send({ name: role, email, password: "Passw0rd!", role })).status).toBe(201);
      return { token: (await request(app).post("/api/auth/login").send({ email, password: "Passw0rd!" })).body.token as string };
    };
    manager = await user("MANAGER");
    dispatcher = await user("DISPATCHER");
    employee = await user("EMPLOYEE");

    // Policy: drivers must hold a KYC proof, and a missing one blocks dispatch. No vehicle
    // document is required, so only the KYC rule decides eligibility in these tests.
    const policy = await request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: { vehicleRequirements: [], driverRequirements: ["KYC_ID"], blockOnMissing: true } } });
    expect(policy.status).toBe(200);

    const loc = async (name: string, lat: number, type: string) => (await request(app).post("/api/locations").set(auth(A)).send({ name, lat, lng: 77.1, type })).body.id as number;
    id.depot = await loc("KYC Depot", 28.5, "DEPOT");
    id.cust = await loc("KYC Customer", 28.55, "CUSTOMER");
    id.vehicle = (await request(app).post("/api/vehicles").set(auth(A)).send({ registrationNumber: "DL01KY0001", type: "VAN", capacityKg: 800, fuelType: "DIESEL", mileageKmPerUnit: 10, depotLocationId: id.depot })).body.id;
    const driver = async (name: string, lic: string) => (await request(app).post("/api/drivers").set(auth(A)).send({ name, phone: "+91 90000 60001", licenseNumber: lic, licenseExpiry: iso(400) })).body.id as number;
    id.withKyc = await driver("Kavya With KYC", "DL0120200060001");
    id.withoutKyc = await driver("Nikhil No KYC", "DL0120200060002");
    // A masked KYC proof for one driver, expiring within the alert window (Control Tower alert).
    const k = await request(app).post("/api/documents").set(auth(A)).send({ type: "KYC_ID", documentNumber: "XXXX-XXXX-5678", driverId: id.withKyc, expiresOn: iso(5) });
    expect(k.status).toBe(201);
    // A non-KYC document expiring too, so every role has at least one alert to compare.
    expect((await request(app).post("/api/documents").set(auth(A)).send({ type: "INSURANCE", documentNumber: "INS-KY-1", vehicleId: id.vehicle, expiresOn: iso(5) })).status).toBe(201);
    const order = async () => (await request(app).post("/api/orders").set(auth(A)).send({ customerName: "KYC customer", pickupLocationId: id.depot, dropLocationId: id.cust, weightKg: 100 })).body.id as number;
    id.order1 = await order();
    id.order2 = await order();
  });

  afterAll(async () => {
    await disconnect?.();
  });

  it("admins still see the full KYC reason on the driver record (authorised path unchanged)", async () => {
    for (const who of [A, manager]) {
      const d = await request(app).get(`/api/drivers/${id.withoutKyc}`).set(auth(who));
      expect(d.body.compliance.eligible).toBe(false);
      expect(d.body.compliance.blockers.join(" ")).toMatch(/KYC identity proof has not been added/);
    }
  });

  it("manual trip rejection (422) keeps the decision but hides the KYC detail", async () => {
    for (const who of [dispatcher, A]) {
      const r = await request(app).post("/api/trips").set(auth(who)).send({ vehicleId: id.vehicle, driverId: id.withoutKyc, orderIds: [id.order1] });
      expect(r.status).toBe(422);
      expect(r.body.error.message).toBe(`Driver cannot take this trip: ${KYC_NEUTRAL}`);
      expect(JSON.stringify(r.body)).not.toMatch(KYC_DETAIL);
    }
  });

  it("stored OptiRoute plans exclude the same driver for the same reason, without KYC detail, for every reader", async () => {
    const run = await request(app)
      .post("/api/optiroute/runs")
      .set(auth(dispatcher))
      .send({ algorithm: "GREEDY_INSERTION", orderIds: [id.order1], vehicleIds: [id.vehicle], assignments: [{ vehicleId: id.vehicle, driverId: id.withoutKyc }] });
    expect(run.status).toBe(201);
    const ex = run.body.result.exclusions.find((e: { kind: string; id: number }) => e.kind === "DRIVER" && e.id === id.withoutKyc);
    expect(ex.reason).toBe(KYC_NEUTRAL); // still excluded: eligibility unchanged
    // The eligible driver (with a KYC proof) was used instead.
    const used = (run.body.result.routes as Array<{ driverId: number; stops: unknown[] }>).filter((r) => r.stops.length);
    expect(used.map((r) => r.driverId)).toEqual([id.withKyc]);
    for (const who of [employee, dispatcher, manager, A]) {
      const stored = await request(app).get(`/api/optiroute/runs/${run.body.id}`).set(auth(who));
      expect(stored.status).toBe(200);
      expect(JSON.stringify(stored.body)).not.toMatch(KYC_DETAIL);
    }
  });

  it("dispatch decisions are unchanged: the driver with a KYC proof can still be assigned", async () => {
    const r = await request(app).post("/api/trips").set(auth(dispatcher)).send({ vehicleId: id.vehicle, driverId: id.withKyc, orderIds: [id.order2] });
    expect(r.status).toBe(201);
  });

  it("Control Tower shows KYC expiry alerts only to kyc:read roles, with consistent counts", async () => {
    const docAlerts = async (who: { token: string }) => {
      const r = await request(app).get("/api/control-tower").set(auth(who));
      expect(r.status).toBe(200);
      return { all: r.body.alerts as Array<{ type: string; message: string }>, docs: (r.body.alerts as Array<{ type: string; message: string }>).filter((a) => a.type === "DOCUMENT_EXPIRY") };
    };
    const admin = await docAlerts(A);
    const mgr = await docAlerts(manager);
    for (const full of [admin, mgr]) {
      expect(full.docs.map((a) => a.message).join(" | ")).toMatch(/KYC_ID for Kavya With KYC expires on/);
      expect(full.docs.some((a) => /INSURANCE for DL01KY0001/.test(a.message))).toBe(true);
    }
    for (const who of [employee, dispatcher]) {
      const r = await docAlerts(who);
      expect(JSON.stringify(r.all)).not.toMatch(KYC_DETAIL);
      expect(r.docs.some((a) => /INSURANCE for DL01KY0001/.test(a.message))).toBe(true); // other alerts unaffected
      expect(r.docs.length).toBe(admin.docs.length - 1); // exactly the KYC alert removed
      expect(r.all.length).toBe(admin.all.length - 1); // and the overall list matches
    }
  });
});
