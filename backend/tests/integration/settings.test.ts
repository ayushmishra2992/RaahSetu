import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = !!process.env.TEST_DATABASE_URL;
type App = Parameters<typeof request>[0];
let app: App;
let disconnect: () => Promise<void>;
const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

describe.skipIf(!enabled)("company settings are merged, never reset (integration)", () => {
  let A: { token: string };
  let B: { token: string };
  let manager: { token: string };

  beforeAll(async () => {
    const mod = await import("../../src/app");
    const prismaMod = await import("../../src/config/prisma");
    app = mod.createApp();
    disconnect = () => prismaMod.prisma.$disconnect();
    const reg = async (s: string) => {
      const r = await request(app).post("/api/auth/register-company").send({ companyName: `Settings Co ${s}`, adminName: `Admin ${s}`, email: `settings-${s}@example.test`, password: "Passw0rd!" });
      expect(r.status).toBe(201);
      return { token: r.body.token as string };
    };
    A = await reg("a");
    B = await reg("b");
    await request(app).post("/api/users").set(auth(A)).send({ name: "Manager", email: "settings-manager@example.test", password: "Passw0rd!", role: "MANAGER" });
    manager = { token: (await request(app).post("/api/auth/login").send({ email: "settings-manager@example.test", password: "Passw0rd!" })).body.token };
  });

  afterAll(async () => {
    await disconnect?.();
  });

  const get = async (who = A) => (await request(app).get("/api/company").set(auth(who))).body.settings;

  it("saving another section keeps a custom compliance policy (regression)", async () => {
    const policy = { blockOnMissing: true, blockOnUnverified: true, driverRequirements: ["DRIVING_LICENSE", "DRIVER_PHOTO"], ewayBillValueThreshold: 75000, vehicleRequirements: [{ type: "RC" }, { type: "INSURANCE" }] };
    expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: policy } })).status).toBe(200);
    // What the Settings page's "Costs & emissions" and "OptiRoute" tabs send now…
    expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { fuelPricePerUnit: { DIESEL: 91.5 }, documentExpiryAlertDays: 21 } })).status).toBe(200);
    expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { defaultWeights: { time: 3 } } })).status).toBe(200);
    // …and a profile-only save.
    expect((await request(app).patch("/api/company").set(auth(A)).send({ name: "Settings Co A Renamed" })).status).toBe(200);
    const s = await get();
    expect(s.compliance).toMatchObject({ blockOnMissing: true, blockOnUnverified: true, driverRequirements: ["DRIVING_LICENSE", "DRIVER_PHOTO"], ewayBillValueThreshold: 75000 });
    expect(s.compliance.vehicleRequirements.map((r: { type: string }) => r.type)).toEqual(["RC", "INSURANCE"]);
    expect(s.fuelPricePerUnit.DIESEL).toBe(91.5);
    expect(s.fuelPricePerUnit.PETROL).toBeGreaterThan(0); // untouched sibling kept
    expect(s.documentExpiryAlertDays).toBe(21);
    expect(s.defaultWeights.time).toBe(3);
    expect(s.defaultWeights.distance).toBeGreaterThanOrEqual(0);
  });

  it("an old client sending the full settings object without `compliance` keeps the policy", async () => {
    const s = await get();
    const { compliance: _omit, ...legacy } = s;
    expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { ...legacy, driverCostPerHour: 250 } })).status).toBe(200);
    const after = await get();
    expect(after.driverCostPerHour).toBe(250);
    expect(after.compliance.blockOnMissing).toBe(true);
  });

  it("rejects an invalid merged result and leaves stored settings unchanged", async () => {
    const before = await get();
    const bad = await request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: { ewayBillValueThreshold: -1 } } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.error.details)).toMatch(/settings\.compliance\.ewayBillValueThreshold/);
    expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { documentExpiryAlertDays: 500 } })).status).toBe(400);
    expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: "not an object" })).status).toBe(400);
    expect(await get()).toEqual(before);
  });

  it("concurrent saves of different sections both persist", async () => {
    const rs = await Promise.all([
      request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: { blockOnMissingShipmentDocs: true } } }),
      request(app).patch("/api/company").set(auth(A)).send({ settings: { fuelPricePerUnit: { CNG: 88 } } }),
      request(app).patch("/api/company").set(auth(A)).send({ settings: { loadPenaltyAtFullLoad: 0.3 } }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    const s = await get();
    expect(s.compliance.blockOnMissingShipmentDocs).toBe(true);
    expect(s.compliance.blockOnMissing).toBe(true);
    expect(s.fuelPricePerUnit.CNG).toBe(88);
    expect(s.loadPenaltyAtFullLoad).toBe(0.3);
  });

  it("is admin-only and per company", async () => {
    expect((await request(app).patch("/api/company").set(auth(manager)).send({ settings: { compliance: { blockOnMissing: false } } })).status).toBe(403);
    const other = await get(B);
    expect(other.compliance.blockOnMissing).toBe(false); // B keeps defaults
    expect((await get()).compliance.blockOnMissing).toBe(true);
  });

  it("the stricter policy is what dispatch uses", async () => {
    const check = await request(app).get("/api/compliance/overview").set(auth(A));
    expect(check.status).toBe(200);
    expect(check.body.policy.blockOnMissing).toBe(true);
    expect(check.body.policy.vehicleRequirements.map((r: { type: string }) => r.type)).toEqual(["RC", "INSURANCE"]);
  });
});
