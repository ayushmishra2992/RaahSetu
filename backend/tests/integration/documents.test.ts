import { inflateRawSync } from "node:zlib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = !!process.env.TEST_DATABASE_URL;
type App = Parameters<typeof request>[0];
let app: App;
let disconnect: () => Promise<void>;

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from("%PDF-1.4\n%test\n");
const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

interface Who {
  token: string;
  userId?: number;
  companyId?: number;
}
const auth = (t: Who) => ({ Authorization: `Bearer ${t.token}` });

async function registerCompany(suffix: string): Promise<Who> {
  const res = await request(app)
    .post("/api/auth/register-company")
    .send({ companyName: `Docs Co ${suffix}`, adminName: `Admin ${suffix}`, email: `docs-admin-${suffix}@example.test`, password: "Passw0rd!" });
  expect(res.status).toBe(201);
  return { token: res.body.token, companyId: res.body.company.id };
}
async function createUser(admin: Who, role: string, email: string): Promise<Who> {
  const res = await request(app).post("/api/users").set(auth(admin)).send({ name: `${role} user`, email, password: "Passw0rd!", role });
  expect(res.status).toBe(201);
  const login = await request(app).post("/api/auth/login").send({ email, password: "Passw0rd!" });
  return { token: login.body.token, userId: res.body.id };
}

/** Entry names of a ZIP (central directory) plus a reader for one entry. */
function zipEntries(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const body = zip.subarray(local + 30 + zip.readUInt16LE(local + 26), local + 30 + zip.readUInt16LE(local + 26) + size);
    out[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    p += 46 + nameLen;
  }
  return out;
}
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe.skipIf(!enabled)("transport documents, compliance and POD (integration)", () => {
  let A: Who, B: Who, dispatcher: Who, employee: Who, manager: Who, driverUser: Who, otherDriverUser: Who;
  const id: Record<string, number> = {};

  beforeAll(async () => {
    const mod = await import("../../src/app");
    const prismaMod = await import("../../src/config/prisma");
    app = mod.createApp();
    disconnect = () => prismaMod.prisma.$disconnect();
    A = await registerCompany("x");
    B = await registerCompany("y");
    dispatcher = await createUser(A, "DISPATCHER", "docs-dispatcher@example.test");
    employee = await createUser(A, "EMPLOYEE", "docs-employee@example.test");
    manager = await createUser(A, "MANAGER", "docs-manager@example.test");
    driverUser = await createUser(A, "DRIVER", "docs-driver@example.test");
    otherDriverUser = await createUser(A, "DRIVER", "docs-driver2@example.test");

    const loc = async (name: string, lat: number, lng: number, type: string) => (await request(app).post("/api/locations").set(auth(A)).send({ name, lat, lng, type })).body.id as number;
    id.depot = await loc("Depot Gurugram", 28.4595, 77.0266, "DEPOT");
    id.cust = await loc("Customer Delhi", 28.6139, 77.209, "CUSTOMER");
    const v = await request(app)
      .post("/api/vehicles")
      .set(auth(A))
      .send({ registrationNumber: "HR26DK8337", type: "TRUCK", capacityKg: 5000, fuelType: "DIESEL", mileageKmPerUnit: 6, depotLocationId: id.depot, registrationState: "Haryana", ownershipType: "ATTACHED", ownerName: "Suresh Yadav" });
    expect(v.status).toBe(201);
    expect(v.body.ownershipType).toBe("ATTACHED");
    id.vehicle = v.body.id;
    const d = await request(app)
      .post("/api/drivers")
      .set(auth(A))
      .send({ name: "Mahesh Kumar", phone: "+91 98100 00001", licenseNumber: "HR2620150012345", licenseExpiry: iso(800), licenseIssuedOn: iso(-2000), licenseClass: "lmv, hgmv", userId: driverUser.userId });
    expect(d.status).toBe(201);
    expect(d.body.licenseClass).toBe("LMV, HGMV");
    id.driver = d.body.id;
    const d2 = await request(app).post("/api/drivers").set(auth(A)).send({ name: "Other Driver", phone: "+91 98100 00002", licenseNumber: "HR2620150099999", licenseExpiry: iso(800), userId: otherDriverUser.userId });
    id.driver2 = d2.body.id;
  });

  afterAll(async () => {
    await disconnect?.();
  });

  describe("vehicle and driver documents", () => {
    it("uploads a licence with front and back images and lists both files", async () => {
      const r = await request(app)
        .post("/api/documents")
        .set(auth(A))
        .field("type", "DRIVING_LICENSE")
        .field("documentNumber", "HR2620150012345")
        .field("driverId", String(id.driver))
        .field("expiresOn", iso(800))
        .attach("front", JPG, { filename: "front.jpg", contentType: "image/jpeg" })
        .attach("back", JPG, { filename: "back.jpg", contentType: "image/jpeg" });
      expect(r.status).toBe(201);
      expect(r.body.attachments.map((a: { role: string }) => a.role).sort()).toEqual(["BACK", "FRONT"]);
      expect(JSON.stringify(r.body)).not.toMatch(/storageKey/);
      expect(r.body.verificationStatus).toBe("PENDING");
      id.licence = r.body.id;
      id.licenceFront = r.body.attachments.find((a: { role: string }) => a.role === "FRONT").id;
    });

    it("rejects documents attached to the wrong kind of owner and bad dates", async () => {
      expect((await request(app).post("/api/documents").set(auth(A)).send({ type: "PUC", documentNumber: "X", driverId: id.driver })).status).toBe(400);
      expect((await request(app).post("/api/documents").set(auth(A)).send({ type: "DRIVING_LICENSE", documentNumber: "X", vehicleId: id.vehicle })).status).toBe(400);
      const bad = await request(app).post("/api/documents").set(auth(A)).send({ type: "RC", documentNumber: "X", vehicleId: id.vehicle, issuedOn: iso(-10), expiresOn: iso(-20) });
      expect(bad.status).toBe(400);
    });

    it("lets admins verify or reject, and resets verification when details change", async () => {
      expect((await request(app).post(`/api/documents/${id.licence}/verify`).set(auth(dispatcher)).send({ status: "VERIFIED" })).status).toBe(403);
      expect((await request(app).post(`/api/documents/${id.licence}/verify`).set(auth(A)).send({ status: "REJECTED" })).status).toBe(400); // reason required
      const ok = await request(app).post(`/api/documents/${id.licence}/verify`).set(auth(A)).send({ status: "VERIFIED" });
      expect(ok.status).toBe(200);
      expect(ok.body.verificationStatus).toBe("VERIFIED");
      const edited = await request(app).patch(`/api/documents/${id.licence}`).set(auth(A)).send({ expiresOn: iso(790) });
      expect(edited.body.verificationStatus).toBe("PENDING");
      await request(app).post(`/api/documents/${id.licence}/verify`).set(auth(A)).send({ status: "VERIFIED" });
      const noFile = await request(app).post("/api/documents").set(auth(A)).send({ type: "FASTAG", documentNumber: "FT-1", vehicleId: id.vehicle });
      expect((await request(app).post(`/api/documents/${noFile.body.id}/verify`).set(auth(A)).send({ status: "VERIFIED" })).status).toBe(400);
    });

    it("issues short-lived signed links only to permitted users of the same company", async () => {
      const link = await request(app).get(`/api/attachments/${id.licenceFront}/url`).set(auth(employee));
      expect(link.status).toBe(200);
      expect(link.body.url).toMatch(/^\/api\/files\//);
      const file = await request(app).get(link.body.url).buffer(true).parse(binary);
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toMatch(/image\/jpeg/);
      expect(Buffer.compare(file.body as Buffer, JPG)).toBe(0);
      const tampered = link.body.url.replace(/.$/, (c: string) => (c === "A" ? "B" : "A"));
      expect((await request(app).get(tampered)).status).toBe(404);
      expect((await request(app).get(`/api/attachments/${id.licenceFront}/url`).set(auth(B))).status).toBe(404);
      expect((await request(app).get(`/api/attachments/${id.licenceFront}`).set(auth(B))).status).toBe(404);
      expect((await request(app).get(`/api/attachments/${id.licenceFront}/url`).set(auth(driverUser))).status).toBe(404); // drivers cannot read fleet documents
      expect((await request(app).delete(`/api/attachments/${id.licenceFront}`).set(auth(employee))).status).toBe(404);
    });
  });

  describe("privacy-first driver KYC", () => {
    it("never accepts a full Aadhaar number and requires consent", async () => {
      expect((await request(app).put(`/api/drivers/${id.driver}/kyc`).set(auth(A)).send({ consent: true, idType: "AADHAAR", idLast4: "123456789012" })).status).toBe(400);
      expect((await request(app).put(`/api/drivers/${id.driver}/kyc`).set(auth(A)).send({ idType: "AADHAAR", idLast4: "9012" })).status).toBe(400);
      const kycDoc = await request(app).post("/api/documents").set(auth(A)).send({ type: "KYC_ID", documentNumber: "1234 5678 9012", driverId: id.driver });
      expect(kycDoc.status).toBe(400);
      const ok = await request(app).put(`/api/drivers/${id.driver}/kyc`).set(auth(A)).send({ consent: true, idType: "AADHAAR", idLast4: "9012", address: "Sector 14, Gurugram", emergencyContactName: "Sunita", emergencyContactPhone: "+91 98100 11111" });
      expect(ok.status).toBe(200);
      expect(ok.body.kycIdLast4).toBe("9012");
      expect(ok.body.kycConsentAt).toBeTruthy();
      const masked = await request(app).post("/api/documents").set(auth(A)).send({ type: "KYC_ID", documentNumber: "XXXX-XXXX-9012", driverId: id.driver });
      expect(masked.status).toBe(201);
      id.kycDoc = masked.body.id;
    });

    it("hides KYC fields and KYC documents from roles without the KYC permission", async () => {
      expect((await request(app).put(`/api/drivers/${id.driver}/kyc`).set(auth(dispatcher)).send({ consent: true })).status).toBe(403);
      const asDispatcher = await request(app).get(`/api/drivers/${id.driver}`).set(auth(dispatcher));
      expect(asDispatcher.status).toBe(200);
      expect(asDispatcher.body.kycIdLast4).toBeUndefined();
      expect(asDispatcher.body.address).toBeUndefined();
      expect(asDispatcher.body.kycOnFile).toBe(true);
      expect(asDispatcher.body.documents.some((d: { type: string }) => d.type === "KYC_ID")).toBe(false);
      const list = await request(app).get("/api/documents").set(auth(employee));
      expect(list.body.some((d: { type: string }) => d.type === "KYC_ID")).toBe(false);
      expect((await request(app).get(`/api/documents/${id.kycDoc}`).set(auth(employee))).status).toBe(404);
      const asAdmin = await request(app).get(`/api/drivers/${id.driver}`).set(auth(A));
      expect(asAdmin.body.address).toBe("Sector 14, Gurugram");
      const audit = await request(app).get("/api/audit").set(auth(A));
      expect(JSON.stringify(audit.body)).not.toMatch(/Sector 14|98100 11111/);
    });

    it("H1: KYC identity files are readable only with kyc:read, on both download and signed-link endpoints", async () => {
      const up = await request(app).post(`/api/documents/${id.kycDoc}/files`).set(auth(A)).attach("front", JPG, { filename: "masked-aadhaar.jpg", contentType: "image/jpeg" });
      expect(up.status).toBe(201);
      const att = up.body[0].id as number;
      for (const who of [employee, dispatcher]) {
        expect((await request(app).get(`/api/attachments/${att}`).set(auth(who))).status).toBe(404);
        expect((await request(app).get(`/api/attachments/${att}/url`).set(auth(who))).status).toBe(404);
        expect((await request(app).delete(`/api/attachments/${att}`).set(auth(who))).status).toBe(404);
      }
      expect((await request(app).get(`/api/attachments/${att}`).set(auth(driverUser))).status).toBe(404);
      expect((await request(app).get(`/api/attachments/${att}/url`).set(auth(B))).status).toBe(404); // other company
      for (const who of [A, manager]) {
        expect((await request(app).get(`/api/attachments/${att}`).set(auth(who))).status).toBe(200);
        const link = await request(app).get(`/api/attachments/${att}/url`).set(auth(who));
        expect(link.status).toBe(200);
        expect((await request(app).get(link.body.url)).status).toBe(200);
      }
      // A non-KYC document file stays readable for employees (no over-blocking).
      expect((await request(app).get(`/api/attachments/${id.licenceFront}`).set(auth(employee))).status).toBe(200);
    });

    it("H2: driver compliance hides KYC items from non-KYC roles and document numbers from roles without documents:read", async () => {
      // Require a KYC proof for this test: the unverified masked copy then produces a KYC warning.
      expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: { driverRequirements: ["DRIVING_LICENSE", "KYC_ID"] } } })).status).toBe(200);
      const asAdmin = await request(app).get(`/api/drivers/${id.driver}`).set(auth(A));
      expect(asAdmin.body.compliance.items.some((i: { type: string }) => i.type === "KYC_ID")).toBe(true);
      expect(asAdmin.body.compliance.warnings.join(" ")).toMatch(/KYC identity proof is awaiting verification/);
      for (const who of [dispatcher, employee]) {
        const r = await request(app).get(`/api/drivers/${id.driver}`).set(auth(who));
        const body = JSON.stringify(r.body.compliance);
        expect(r.body.compliance.items.some((i: { type: string }) => i.type === "KYC_ID")).toBe(false);
        expect(body).not.toMatch(/KYC_ID|KYC identity proof|XXXX-XXXX|9012/);
        expect(r.body.compliance.warnings).toContain("A KYC record needs attention (details are visible to admins and managers only)");
        expect(r.body.compliance.items.find((i: { type: string }) => i.type === "DRIVING_LICENSE").documentNumber).toBe("HR2620150012345"); // documents:read keeps numbers
      }
      const ov = await request(app).get("/api/compliance/overview").set(auth(employee));
      expect(JSON.stringify(ov.body.attention)).not.toMatch(/KYC_ID|KYC identity proof|XXXX/);
      expect(JSON.stringify(ov.body.attention)).toMatch(/A KYC record needs attention/);
      const ovAdmin = await request(app).get("/api/compliance/overview").set(auth(A));
      expect(JSON.stringify(ovAdmin.body.attention)).toMatch(/KYC identity proof is awaiting verification/);
      // Restore the default driver requirements for the following tests.
      expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: { driverRequirements: ["DRIVING_LICENSE"] } } })).status).toBe(200);
    });
  });

  describe("compliance-aware dispatch", () => {
    it("reports compliance on the vehicle and blocks planning when the company requires complete paperwork", async () => {
      const v = await request(app).get(`/api/vehicles/${id.vehicle}`).set(auth(A));
      expect(v.body.compliance.overall).toBe("MISSING");
      expect(v.body.compliance.eligible).toBe(true); // default policy only flags missing documents

      const o = await request(app).post("/api/orders").set(auth(A)).send({ customerName: "Delhi Traders", pickupLocationId: id.depot, dropLocationId: id.cust, weightKg: 1200, declaredValue: 75000 });
      expect(o.status).toBe(201);
      id.order = o.body.id;
      id.orderNumberLen = String(o.body.orderNumber).length;

      const strict = await request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: { blockOnMissing: true } } });
      expect(strict.status).toBe(200);
      const blocked = await request(app).post("/api/trips").set(auth(dispatcher)).send({ vehicleId: id.vehicle, driverId: id.driver, orderIds: [id.order] });
      expect(blocked.status).toBe(422);
      expect(JSON.stringify(blocked.body)).toMatch(/Registration certificate \(RC\) has not been added/);

      const check = await request(app).get(`/api/compliance/check?vehicleId=${id.vehicle}&driverId=${id.driver}&orderIds=${id.order}`).set(auth(dispatcher));
      expect(check.status).toBe(200);
      expect(check.body.eligible).toBe(false);
      expect(check.body.warnings.join(" ")).toMatch(/E-Way Bill expected/);
      expect(JSON.stringify(check.body)).not.toMatch(/KYC_ID|XXXX-XXXX/); // dispatcher: no KYC items
      // Drivers and employees cannot use the planning check to inspect vehicles or other drivers.
      for (const who of [driverUser, otherDriverUser, employee]) {
        expect((await request(app).get(`/api/compliance/check?vehicleId=${id.vehicle}&driverId=${id.driver2}`).set(auth(who))).status).toBe(403);
      }
      const asAdmin = await request(app).get(`/api/compliance/check?vehicleId=${id.vehicle}&driverId=${id.driver}`).set(auth(A));
      expect(asAdmin.body.driver.items.some((i: { type: string }) => i.type === "KYC_ID")).toBe(true);

      for (const type of ["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT"]) {
        const r = await request(app).post("/api/documents").set(auth(A)).field("type", type).field("documentNumber", `${type}-001`).field("vehicleId", String(id.vehicle)).field("expiresOn", iso(365)).attach("file", PDF, { filename: `${type}.pdf`, contentType: "application/pdf" });
        expect(r.status).toBe(201);
      }
      const ok = await request(app).post("/api/trips").set(auth(dispatcher)).send({ vehicleId: id.vehicle, driverId: id.driver, orderIds: [id.order] });
      expect(ok.status).toBe(201);
      id.trip = ok.body.id;
    });

    it("blocks dispatch on a missing E-Way Bill only when the company opts in, with an exact message", async () => {
      await request(app).patch("/api/company").set(auth(A)).send({ settings: { compliance: { blockOnMissing: true, blockOnMissingShipmentDocs: true } } });
      const blocked = await request(app).post(`/api/trips/${id.trip}/status`).set(auth(dispatcher)).send({ status: "DISPATCHED" });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("COMPLIANCE_BLOCKED");
      expect(blocked.body.error.message).toMatch(/E-Way Bill expected \(declared value ₹75000 exceeds ₹50000\)/);
    });

    it("lists overview counts from real records", async () => {
      const ov = await request(app).get("/api/compliance/overview").set(auth(employee));
      expect(ov.status).toBe(200);
      expect(ov.body.vehicles.total).toBe(1);
      expect(ov.body.drivers.total).toBe(2);
      expect((await request(app).get("/api/compliance/overview").set(auth(driverUser))).status).toBe(403);
    });
  });

  describe("E-Way Bills", () => {
    it("validates and records an E-Way Bill with its PDF, once", async () => {
      const base = { orderId: id.order, documentDate: iso(-1), validUntil: iso(2), supplierName: "Delhi Traders", recipientName: "Delhi Traders Retail", placeOfDispatch: "Gurugram", placeOfDelivery: "New Delhi", goodsDescription: "Steel almirahs", hsnCode: "9403", taxableValue: 75000, vehicleNumber: "HR 26 DK 8337" };
      expect((await request(app).post("/api/eway-bills").set(auth(A)).send({ ...base, ewbNumber: "12345" })).status).toBe(400);
      expect((await request(app).post("/api/eway-bills").set(auth(A)).send({ ...base, ewbNumber: "391000000001", supplierGstin: "BADGSTIN" })).status).toBe(400);
      expect((await request(app).post("/api/eway-bills").set(auth(A)).send({ ...base, ewbNumber: "391000000001", validUntil: iso(-5) })).status).toBe(400);
      expect((await request(app).post("/api/eway-bills").set(auth(employee)).send({ ...base, ewbNumber: "391000000001" })).status).toBe(403);
      const form = request(app).post("/api/eway-bills").set(auth(dispatcher));
      for (const [k, v] of Object.entries({ ...base, ewbNumber: "3910 0000 0001", supplierGstin: "06AABCU9603R1ZX" })) form.field(k, String(v));
      const r = await form.attach("file", PDF, { filename: "ewb.pdf", contentType: "application/pdf" });
      expect(r.status).toBe(201);
      expect(r.body.ewbNumber).toBe("391000000001");
      expect(r.body.vehicleNumber).toBe("HR26DK8337");
      expect(r.body.attachments).toHaveLength(1);
      id.ewb = r.body.id;
      expect((await request(app).post("/api/eway-bills").set(auth(A)).send({ ...base, ewbNumber: "391000000001" })).status).toBe(409);
      expect((await request(app).get(`/api/eway-bills/${id.ewb}`).set(auth(B))).status).toBe(404);
      expect((await request(app).post("/api/eway-bills").set(auth(B)).send({ ...base, ewbNumber: "391000000002" })).status).toBe(404); // order of another company
    });

    it("now lets the trip dispatch and start", async () => {
      expect((await request(app).post(`/api/trips/${id.trip}/status`).set(auth(dispatcher)).send({ status: "DISPATCHED" })).status).toBe(200);
      expect((await request(app).post(`/api/trips/${id.trip}/status`).set(auth(driverUser)).send({ status: "IN_TRANSIT" })).status).toBe(200);
    });

    it("shows drivers only the E-Way Bills of their own trips", async () => {
      expect((await request(app).get(`/api/eway-bills/${id.ewb}`).set(auth(driverUser))).status).toBe(200);
      expect((await request(app).get(`/api/eway-bills/${id.ewb}`).set(auth(otherDriverUser))).status).toBe(404);
      const list = await request(app).get("/api/eway-bills").set(auth(otherDriverUser));
      expect(list.body).toHaveLength(0);
    });
  });

  describe("lorry receipts and challans", () => {
    it("creates an LR pre-filled from the order and trip and renders it as PDF", async () => {
      const lr = await request(app).post("/api/lorry-receipts").set(auth(dispatcher)).send({ orderId: id.order, goodsDescription: "Steel almirahs", packages: 12, packageType: "cartons", freightAmount: 6500, paymentTerms: "TO_PAY" });
      expect(lr.status).toBe(201);
      expect(lr.body.lrNumber).toMatch(/^LR-\d{8}-[0-9A-Z]{6}$/);
      expect(lr.body.consigneeName).toBe("Delhi Traders");
      expect(lr.body.tripId).toBe(id.trip);
      id.lr = lr.body.id;
      const pdf = await request(app).get(`/api/lorry-receipts/${id.lr}/pdf`).set(auth(driverUser)).buffer(true).parse(binary);
      expect(pdf.status).toBe(200);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
      expect((await request(app).get(`/api/lorry-receipts/${id.lr}/pdf`).set(auth(B))).status).toBe(404);
      expect((await request(app).get(`/api/lorry-receipts/${id.lr}`).set(auth(otherDriverUser))).status).toBe(404);
    });

    it("issues a delivery challan with HSN codes and renders its PDF", async () => {
      const dc = await request(app)
        .post("/api/billing")
        .set(auth(A))
        .send({ kind: "DELIVERY_CHALLAN", tripId: id.trip, customerName: "Delhi Traders", reasonForTransport: "Supply", referenceDocuments: "EWB 391000000001", items: [{ description: "Steel almirah", hsnCode: "9403", quantity: 12, unit: "nos", rate: 6250 }] });
      expect(dc.status).toBe(201);
      expect(dc.body.items[0].hsnCode).toBe("9403");
      expect((await request(app).post("/api/billing").set(auth(A)).send({ kind: "INVOICE", customerName: "X Y", items: [{ description: "a", hsnCode: "12", quantity: 1, rate: 1 }] })).status).toBe(400);
      expect((await request(app).post(`/api/billing/${dc.body.id}/issue`).set(auth(A))).status).toBe(200);
      const pdf = await request(app).get(`/api/billing/${dc.body.id}/pdf`).set(auth(employee)).buffer(true).parse(binary);
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
      expect((await request(app).get(`/api/billing/${dc.body.id}/pdf`).set(auth(B))).status).toBe(404);
    });
  });

  describe("proof of delivery", () => {
    it("requires a signature and a valid image, then completes the stop and the order", async () => {
      const trip = await request(app).get(`/api/trips/${id.trip}`).set(auth(driverUser));
      const pickup = trip.body.stops.find((s: { type: string }) => s.type === "PICKUP");
      const drop = trip.body.stops.find((s: { type: string }) => s.type === "DROP");
      id.drop = drop.id;
      const fields = { tripId: id.trip, tripStopId: drop.id, status: "DELIVERED", receiverName: "Rakesh Gupta", receiverPhone: "+91 98111 22222" };
      // Pickup not done yet: the stop workflow refuses the delivery.
      const early = request(app).post("/api/pods").set(auth(driverUser));
      for (const [k, v] of Object.entries(fields)) early.field(k, String(v));
      expect((await early.attach("signature", PNG, { filename: "sig.png", contentType: "image/png" })).status).toBe(409);
      expect((await request(app).post(`/api/trips/${id.trip}/stops/${pickup.id}`).set(auth(driverUser)).send({ action: "COMPLETE" })).status).toBe(200);

      expect((await request(app).post("/api/pods").set(auth(driverUser)).send(fields)).status).toBe(400); // no signature
      const webp = request(app).post("/api/pods").set(auth(driverUser));
      for (const [k, v] of Object.entries(fields)) webp.field(k, String(v));
      expect((await webp.attach("signature", PDF, { filename: "sig.pdf", contentType: "application/pdf" })).status).toBe(400);
      const other = request(app).post("/api/pods").set(auth(otherDriverUser));
      for (const [k, v] of Object.entries(fields)) other.field(k, String(v));
      expect((await other.attach("signature", PNG, { filename: "sig.png", contentType: "image/png" })).status).toBe(404);

      const ok = request(app).post("/api/pods").set(auth(driverUser));
      for (const [k, v] of Object.entries(fields)) ok.field(k, String(v));
      const r = await ok.attach("signature", PNG, { filename: "sig.png", contentType: "image/png" }).attach("photos", JPG, { filename: "goods.jpg", contentType: "image/jpeg" });
      expect(r.status).toBe(201);
      expect(r.body.verificationToken).toBeUndefined();
      expect(r.body.deliveredQuantity).toBe(1200);
      expect(r.body.attachments.map((a: { role: string }) => a.role).sort()).toEqual(["PHOTO", "SIGNATURE"]);
      id.pod = r.body.id;

      const after = await request(app).get(`/api/trips/${id.trip}`).set(auth(A));
      expect(after.body.stops.find((s: { id: number }) => s.id === drop.id).status).toBe("COMPLETED");
      expect((await request(app).get(`/api/orders/${id.order}`).set(auth(A))).body.status).toBe("DELIVERED");

      const again = request(app).post("/api/pods").set(auth(driverUser));
      for (const [k, v] of Object.entries(fields)) again.field(k, String(v));
      expect((await again.attach("signature", PNG, { filename: "sig.png", contentType: "image/png" })).status).toBe(409);
    });

    it("audits edits, enforces consistency and renders the POD PDF", async () => {
      // Drivers may correct details while in transit, but never change the outcome.
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(driverUser)).send({ status: "PARTIALLY_DELIVERED", deliveredQuantity: 1000, shortageDetails: "2 cartons short" })).status).toBe(403);
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(driverUser)).send({ receiverName: "Rakesh K. Gupta" })).status).toBe(200);
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(driverUser)).send({ deliveredAt: iso(2) })).status).toBe(400); // future
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(A)).send({ status: "FAILED" })).status).toBe(409); // delivered ↔ not delivered
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(A)).send({ status: "PARTIALLY_DELIVERED", deliveredQuantity: 1000 })).status).toBe(400); // needs shortage/damage
      const upd = await request(app).patch(`/api/pods/${id.pod}`).set(auth(dispatcher)).send({ status: "PARTIALLY_DELIVERED", deliveredQuantity: 1000, shortageDetails: "2 cartons short" });
      expect(upd.status).toBe(200);
      const audit = await request(app).get("/api/audit").set(auth(A));
      const ev = audit.body.find((e: { action: string }) => e.action === "pod.updated");
      expect(ev.metadata.changes.status).toEqual({ from: "DELIVERED", to: "PARTIALLY_DELIVERED" });
      const pdf = await request(app).get(`/api/pods/${id.pod}/pdf`).set(auth(A)).buffer(true).parse(binary);
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
      expect((await request(app).get(`/api/pods/${id.pod}`).set(auth(otherDriverUser))).status).toBe(404);
      expect((await request(app).get(`/api/pods/${id.pod}/pdf`).set(auth(B))).status).toBe(404);
    });

    it("M4: only admins/managers resolve a disputed delivery, with remarks; drivers cannot touch it", async () => {
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(dispatcher)).send({ status: "DISPUTED", remarks: "Customer disputes quantity" })).status).toBe(200);
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(driverUser)).send({ receiverName: "Someone Else" })).status).toBe(403);
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(dispatcher)).send({ status: "DELIVERED" })).status).toBe(403);
      expect((await request(app).patch(`/api/pods/${id.pod}`).set(auth(manager)).send({ status: "PARTIALLY_DELIVERED", deliveredQuantity: 1000, shortageDetails: "2 cartons short", remarks: "" })).status).toBe(400); // remarks required
      const resolved = await request(app).patch(`/api/pods/${id.pod}`).set(auth(manager)).send({ status: "PARTIALLY_DELIVERED", deliveredQuantity: 1000, shortageDetails: "2 cartons short", remarks: "Agreed with customer: 2 cartons credited" });
      expect(resolved.status).toBe(200);
      expect(resolved.body.status).toBe("PARTIALLY_DELIVERED");
    });
  });

  describe("trip document section and pack", () => {
    it("summarises the trip's paperwork and compliance", async () => {
      const r = await request(app).get(`/api/trips/${id.trip}/documents`).set(auth(A));
      expect(r.status).toBe(200);
      expect(r.body.orders[0].ewayBills[0].ewbNumber).toBe("391000000001");
      expect(r.body.orders[0].lorryReceipts).toHaveLength(1);
      expect(r.body.orders[0].pod.status).toBe("PARTIALLY_DELIVERED");
      expect(r.body.vehicleDocuments.length).toBeGreaterThanOrEqual(5);
      expect(r.body.billing).toHaveLength(1);
      const asDriver = await request(app).get(`/api/trips/${id.trip}/documents`).set(auth(driverUser));
      expect(asDriver.body.vehicleDocuments).toBeNull();
      expect(asDriver.body.billing).toBeNull();
      // H2: the compliance block must not leak what vehicleDocuments/driverDocuments hide.
      for (const part of [asDriver.body.compliance.vehicle, asDriver.body.compliance.driver]) {
        expect(part.items.every((i: { documentNumber: string | null; documentId: number | null }) => i.documentNumber === null && i.documentId === null)).toBe(true);
        expect(part.items.some((i: { type: string }) => i.type === "KYC_ID")).toBe(false);
      }
      expect(JSON.stringify(asDriver.body.compliance)).not.toMatch(/RC-001|INSURANCE-001|HR2620150012345|KYC_ID|XXXX-XXXX/);
      const asDispatcher = await request(app).get(`/api/trips/${id.trip}/documents`).set(auth(dispatcher));
      expect(asDispatcher.body.compliance.vehicle.items.find((i: { type: string }) => i.type === "RC").documentNumber).toBe("RC-001");
      expect(JSON.stringify(asDispatcher.body.compliance)).not.toMatch(/KYC_ID|XXXX-XXXX/);
      expect((await request(app).get(`/api/trips/${id.trip}/documents`).set(auth(otherDriverUser))).status).toBe(404);
      expect((await request(app).get(`/api/trips/${id.trip}/documents`).set(auth(B))).status).toBe(404);
    });

    it("builds a ZIP containing only what the caller may see", async () => {
      const full = await request(app).get(`/api/trips/${id.trip}/documents/pack`).set(auth(A)).buffer(true).parse(binary);
      expect(full.status).toBe(200);
      expect(full.headers["content-type"]).toBe("application/zip");
      const files = zipEntries(full.body as Buffer);
      const names = Object.keys(files);
      expect(names[0]).toBe("MANIFEST.txt");
      expect(names.some((n) => n.startsWith("lorry-receipts/LR-"))).toBe(true);
      expect(names.some((n) => n.startsWith("eway-bills/391000000001"))).toBe(true);
      expect(names.some((n) => n.startsWith("challans/"))).toBe(true);
      expect(names.some((n) => n.startsWith("proof-of-delivery/POD-"))).toBe(true);
      expect(names.some((n) => n.startsWith("vehicle-HR26DK8337/RC-"))).toBe(true);
      expect(names.some((n) => /KYC/i.test(n))).toBe(false);
      expect(files["MANIFEST.txt"].toString()).toMatch(/KYC identity proofs are never included/);

      const drv = await request(app).get(`/api/trips/${id.trip}/documents/pack`).set(auth(driverUser)).buffer(true).parse(binary);
      const dNames = Object.keys(zipEntries(drv.body as Buffer));
      expect(dNames.some((n) => n.startsWith("vehicle-"))).toBe(false);
      expect(dNames.some((n) => n.startsWith("challans/"))).toBe(false);
      expect(dNames.some((n) => n.startsWith("proof-of-delivery/"))).toBe(true);
      expect((await request(app).get(`/api/trips/${id.trip}/documents/pack`).set(auth(B))).status).toBe(404);
    });
  });

  describe("order deletion keeps shipment records (M2)", () => {
    const newOrder = async () =>
      (await request(app).post("/api/orders").set(auth(A)).send({ customerName: "Delete Test", pickupLocationId: id.depot, dropLocationId: id.cust, weightKg: 100, declaredValue: 60000 })).body.id as number;
    const ewbBody = (orderId: number, n: string) => ({ orderId, ewbNumber: n, documentDate: iso(-1), supplierName: "Delhi Traders", recipientName: "Retail", placeOfDispatch: "Gurugram", placeOfDelivery: "Delhi", goodsDescription: "Goods" });

    it("deletes an order without shipment documents", async () => {
      const o = await newOrder();
      expect((await request(app).delete(`/api/orders/${o}`).set(auth(A))).status).toBe(204);
    });

    it("refuses to delete an order with an E-Way Bill (even cancelled) and keeps the record and its file", async () => {
      const o = await newOrder();
      const form = request(app).post("/api/eway-bills").set(auth(A));
      for (const [k, v] of Object.entries(ewbBody(o, "391000000099"))) form.field(k, String(v));
      const e = await form.attach("file", PDF, { filename: "ewb.pdf", contentType: "application/pdf" });
      expect(e.status).toBe(201);
      await request(app).post(`/api/eway-bills/${e.body.id}/cancel`).set(auth(A));
      const del = await request(app).delete(`/api/orders/${o}`).set(auth(A));
      expect(del.status).toBe(409);
      expect(del.body.error.code).toBe("ORDER_HAS_SHIPMENT_DOCUMENTS");
      expect(del.body.error.message).toMatch(/1 E-Way Bill recorded and cannot be deleted\. Use "Cancel order" instead/);
      expect((await request(app).get(`/api/eway-bills/${e.body.id}`).set(auth(A))).status).toBe(200);
      expect((await request(app).get(`/api/attachments/${e.body.attachments[0].id}`).set(auth(A))).status).toBe(200); // file still stored
      expect((await request(app).post(`/api/orders/${o}/cancel`).set(auth(A))).status).toBe(200); // the supported way out
    });

    it("refuses to delete an order with a lorry receipt", async () => {
      const o = await newOrder();
      expect((await request(app).post("/api/lorry-receipts").set(auth(A)).send({ orderId: o, goodsDescription: "Goods" })).status).toBe(201);
      const del = await request(app).delete(`/api/orders/${o}`).set(auth(A));
      expect(del.status).toBe(409);
      expect(del.body.error.details).toEqual({ ewayBills: 0, lorryReceipts: 1 });
    });
  });

  describe("upload and pack limits (M3)", () => {
    it("sends rate-limit headers on upload endpoints", async () => {
      const r = await request(app).post("/api/documents").set(auth(A)).send({ type: "OTHER", documentNumber: "RL-1", vehicleId: id.vehicle });
      expect(r.status).toBe(201);
      expect(r.headers["ratelimit-policy"]).toMatch(/^\d+;w=60/);
    });

    it("caps the pack size (1 MB in tests), lists omitted files and never loads them", async () => {
      const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(700 * 1024, 0x41)]);
      for (const n of ["BIG-1", "BIG-2"]) {
        const r = await request(app).post("/api/documents").set(auth(A)).field("type", "OTHER").field("documentNumber", n).field("vehicleId", String(id.vehicle)).attach("pages", big, { filename: `${n}.pdf`, contentType: "application/pdf" });
        expect(r.status).toBe(201);
      }
      const pack = await request(app).get(`/api/trips/${id.trip}/documents/pack`).set(auth(A)).buffer(true).parse(binary);
      expect(pack.status).toBe(200);
      expect((pack.body as Buffer).length).toBeLessThan(1.2 * 1024 * 1024);
      const files = zipEntries(pack.body as Buffer);
      const manifest = files["MANIFEST.txt"].toString();
      expect(manifest).toMatch(/NOTE: \d+ file\(s\) were left out because the pack reached its 1 MB limit/);
      expect(manifest).toMatch(/\[omitted \] vehicle-HR26DK8337\/OTHER-BIG-\d/);
      expect(Object.keys(files).filter((n) => /BIG-\d/.test(n)).length).toBeLessThan(2);
    });
  });

  describe("document deletion", () => {
    it("deletes a document with its files and audits it", async () => {
      const r = await request(app).post("/api/documents").set(auth(A)).field("type", "OTHER").field("documentNumber", "TMP-1").field("vehicleId", String(id.vehicle)).attach("pages", PDF, { filename: "p1.pdf", contentType: "application/pdf" });
      const attId = r.body.attachments[0].id;
      expect((await request(app).delete(`/api/documents/${r.body.id}`).set(auth(B))).status).toBe(404);
      expect((await request(app).delete(`/api/documents/${r.body.id}`).set(auth(A))).status).toBe(204);
      expect((await request(app).get(`/api/attachments/${attId}`).set(auth(A))).status).toBe(404);
    });
  });

  describe("transport document lifecycle (edit, files, finalize, cancel, history)", () => {
    it("edits an E-Way Bill, adds files later, and checks validity order", async () => {
      const base = { orderId: id.order, documentDate: iso(-1), validFrom: iso(-1), validUntil: iso(2), supplierName: "Delhi Traders", recipientName: "Delhi Traders Retail", placeOfDispatch: "Gurugram", placeOfDelivery: "New Delhi", goodsDescription: "Synthetic lifecycle goods" };
      expect((await request(app).post("/api/eway-bills").set(auth(A)).send({ ...base, ewbNumber: "391000000077", validFrom: iso(3) })).status).toBe(400); // until < from
      const r = await request(app).post("/api/eway-bills").set(auth(dispatcher)).send({ ...base, ewbNumber: "391000000077" });
      expect(r.status).toBe(201);
      const ewb = r.body.id as number;
      const edit = await request(app).patch(`/api/eway-bills/${ewb}`).set(auth(dispatcher)).send({ goodsDescription: "Synthetic goods (edited)", quantity: 12, quantityUnit: "BOX" });
      expect(edit.status).toBe(200);
      expect(edit.body.goodsDescription).toBe("Synthetic goods (edited)");
      expect((await request(app).patch(`/api/eway-bills/${ewb}`).set(auth(employee)).send({ notes: "x" })).status).toBe(403);
      expect((await request(app).patch(`/api/eway-bills/${ewb}`).set(auth(B)).send({ notes: "x" })).status).toBe(404);
      const add = await request(app).post(`/api/eway-bills/${ewb}/files`).set(auth(dispatcher)).attach("file", PDF, { filename: "ewb-page2.pdf", contentType: "application/pdf" });
      expect(add.status).toBe(201);
      expect(add.body).toHaveLength(1);
      const got = await request(app).get(`/api/eway-bills/${ewb}`).set(auth(A));
      expect(got.body.attachments).toHaveLength(1);
      expect(got.body.validFrom).toBeTruthy();
      id.ewbLife = ewb;
    });

    it("cancels an E-Way Bill only with a reason, then refuses edits and new files", async () => {
      const ewb = id.ewbLife;
      expect((await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(dispatcher)).send({})).status).toBe(400);
      expect((await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(dispatcher)).send({ reason: "x" })).status).toBe(400);
      const c = await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(dispatcher)).send({ reason: "Synthetic test: wrong vehicle" });
      expect(c.status).toBe(200);
      expect(c.body.status).toBe("CANCELLED");
      expect(c.body.cancelReason).toBe("Synthetic test: wrong vehicle");
      expect(c.body.cancelledAt).toBeTruthy();
      expect((await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(dispatcher)).send({ reason: "again please" })).status).toBe(409);
      expect((await request(app).patch(`/api/eway-bills/${ewb}`).set(auth(dispatcher)).send({ notes: "late edit" })).status).toBe(409);
      const late = await request(app).post(`/api/eway-bills/${ewb}/files`).set(auth(dispatcher)).attach("file", PDF, { filename: "late.pdf", contentType: "application/pdf" });
      expect(late.status).toBe(409);
      const h = await request(app).get(`/api/eway-bills/${ewb}/history`).set(auth(employee));
      expect(h.status).toBe(200);
      expect((h.body as Array<{ action: string }>).map((e) => e.action)).toEqual(["ewaybill.cancelled", "file.uploaded", "ewaybill.updated", "ewaybill.recorded"]);
      expect((await request(app).get(`/api/eway-bills/${ewb}/history`).set(auth(B))).status).toBe(404);
      expect((await request(app).get(`/api/eway-bills/${ewb}/history`).set(auth(otherDriverUser))).status).toBe(404);
    });

    it("records LR advance and balance, and rejects an advance above the freight", async () => {
      expect((await request(app).post("/api/lorry-receipts").set(auth(dispatcher)).send({ orderId: id.order, goodsDescription: "Synthetic", advanceAmount: 100 })).status).toBe(400); // no freight
      expect((await request(app).post("/api/lorry-receipts").set(auth(dispatcher)).send({ orderId: id.order, goodsDescription: "Synthetic", freightAmount: 1000, advanceAmount: 1500 })).status).toBe(400);
      const lr = await request(app).post("/api/lorry-receipts").set(auth(dispatcher)).send({ orderId: id.order, goodsDescription: "Synthetic lifecycle LR", freightAmount: 5000, advanceAmount: 2000 });
      expect(lr.status).toBe(201);
      expect(lr.body.balanceAmount).toBe(3000);
      expect(lr.body.editable).toBe(true);
      id.lrLife = lr.body.id;
      const edit = await request(app).patch(`/api/lorry-receipts/${id.lrLife}`).set(auth(dispatcher)).send({ freightAmount: 5500 });
      expect(edit.status).toBe(200);
      expect(edit.body.balanceAmount).toBe(3500);
      expect((await request(app).patch(`/api/lorry-receipts/${id.lrLife}`).set(auth(dispatcher)).send({ freightAmount: 1000 })).status).toBe(400); // advance would exceed freight
    });

    it("finalizes an LR with the company's own terms and then locks it", async () => {
      const terms = "Synthetic company terms for testing only.";
      expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { transportDocuments: { lrTerms: terms } } })).status).toBe(200);
      expect((await request(app).post(`/api/lorry-receipts/${id.lrLife}/finalize`).set(auth(employee))).status).toBe(403);
      const f = await request(app).post(`/api/lorry-receipts/${id.lrLife}/finalize`).set(auth(dispatcher));
      expect(f.status).toBe(200);
      expect(f.body.finalizedAt).toBeTruthy();
      expect(f.body.termsSnapshot).toBe(terms);
      expect(f.body.editable).toBe(false);
      expect((await request(app).post(`/api/lorry-receipts/${id.lrLife}/finalize`).set(auth(dispatcher))).status).toBe(409);
      expect((await request(app).patch(`/api/lorry-receipts/${id.lrLife}`).set(auth(dispatcher)).send({ goodsDescription: "changed after finalize" })).status).toBe(409);
      // Later settings changes do not alter the finalized LR.
      expect((await request(app).patch("/api/company").set(auth(A)).send({ settings: { transportDocuments: { lrTerms: "Changed terms" } } })).status).toBe(200);
      expect((await request(app).get(`/api/lorry-receipts/${id.lrLife}`).set(auth(A))).body.termsSnapshot).toBe(terms);
      const pdf = await request(app).get(`/api/lorry-receipts/${id.lrLife}/pdf`).set(auth(A)).buffer(true).parse(binary);
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    });

    it("cancels a finalized LR only with a reason and keeps its history", async () => {
      expect((await request(app).post(`/api/lorry-receipts/${id.lrLife}/cancel`).set(auth(dispatcher)).send({ reason: "" })).status).toBe(400);
      expect((await request(app).post(`/api/lorry-receipts/${id.lrLife}/cancel`).set(auth(B)).send({ reason: "Not yours" })).status).toBe(404);
      const c = await request(app).post(`/api/lorry-receipts/${id.lrLife}/cancel`).set(auth(dispatcher)).send({ reason: "Synthetic test: duplicate LR" });
      expect(c.status).toBe(200);
      expect(c.body.status).toBe("CANCELLED");
      expect(c.body.cancelReason).toBe("Synthetic test: duplicate LR");
      expect((await request(app).post(`/api/lorry-receipts/${id.lrLife}/finalize`).set(auth(dispatcher))).status).toBe(409);
      const h = await request(app).get(`/api/lorry-receipts/${id.lrLife}/history`).set(auth(A));
      expect((h.body as Array<{ action: string }>).map((e) => e.action)).toEqual(["lr.cancelled", "lr.pdf_downloaded", "lr.finalized", "lr.updated", "lr.created"]);
      expect(h.body[0].metadata.reason).toBe("Synthetic test: duplicate LR");
      const list = await request(app).get("/api/lorry-receipts?status=CANCELLED").set(auth(A));
      expect((list.body as Array<{ id: number }>).some((l) => l.id === id.lrLife)).toBe(true);
    });

    it("lets exactly one of several simultaneous E-Way Bill cancellations succeed, with one history entry", async () => {
      const base = { orderId: id.order, documentDate: iso(-1), validUntil: iso(2), supplierName: "Delhi Traders", recipientName: "Delhi Traders Retail", placeOfDispatch: "Gurugram", placeOfDelivery: "New Delhi", goodsDescription: "Synthetic race goods" };
      const r = await request(app).post("/api/eway-bills").set(auth(dispatcher)).send({ ...base, ewbNumber: "391000000088" });
      expect(r.status).toBe(201);
      const ewb = r.body.id as number;
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(i % 2 ? A : dispatcher)).send({ reason: `Synthetic race cancel ${i}` })),
      );
      const statuses = results.map((x) => x.status).sort();
      expect(statuses.filter((st) => st === 200)).toHaveLength(1);
      expect(statuses.filter((st) => st === 409)).toHaveLength(5);
      const winner = results.find((x) => x.status === 200)!;
      const stored = await request(app).get(`/api/eway-bills/${ewb}`).set(auth(A));
      expect(stored.body.status).toBe("CANCELLED");
      expect(stored.body.cancelReason).toBe(winner.body.cancelReason); // the winner's reason is kept, not overwritten
      const h = await request(app).get(`/api/eway-bills/${ewb}/history`).set(auth(A));
      expect((h.body as Array<{ action: string }>).filter((e) => e.action === "ewaybill.cancelled")).toHaveLength(1);
    });

    it("never lets a simultaneous edit change an E-Way Bill once its cancellation has succeeded", async () => {
      const base = { orderId: id.order, documentDate: iso(-1), validUntil: iso(2), supplierName: "Delhi Traders", recipientName: "Delhi Traders Retail", placeOfDispatch: "Gurugram", placeOfDelivery: "New Delhi", goodsDescription: "Synthetic before" };
      for (let round = 0; round < 4; round++) {
        const r = await request(app).post("/api/eway-bills").set(auth(dispatcher)).send({ ...base, ewbNumber: `39100000009${round}` });
        expect(r.status).toBe(201);
        const ewb = r.body.id as number;
        const [edit, cancel] = await Promise.all([
          request(app).patch(`/api/eway-bills/${ewb}`).set(auth(A)).send({ goodsDescription: "Synthetic after" }),
          request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(dispatcher)).send({ reason: "Synthetic edit-vs-cancel" }),
        ]);
        expect(cancel.status).toBe(200); // the cancellation always succeeds (it was the only one)
        expect([200, 409]).toContain(edit.status);
        const stored = (await request(app).get(`/api/eway-bills/${ewb}`).set(auth(A))).body;
        expect(stored.status).toBe("CANCELLED");
        const actions = ((await request(app).get(`/api/eway-bills/${ewb}/history`).set(auth(A))).body as Array<{ action: string }>).map((e) => e.action);
        if (edit.status === 200) {
          // The edit landed first: it is in the history BEFORE the cancellation.
          expect(stored.goodsDescription).toBe("Synthetic after");
          expect(actions).toEqual(["ewaybill.cancelled", "ewaybill.updated", "ewaybill.recorded"]);
        } else {
          // The cancellation landed first: the edit changed nothing and left no history.
          expect(stored.goodsDescription).toBe("Synthetic before");
          expect(actions).toEqual(["ewaybill.cancelled", "ewaybill.recorded"]);
        }
        // Afterwards, edits are always refused.
        expect((await request(app).patch(`/api/eway-bills/${ewb}`).set(auth(A)).send({ goodsDescription: "late" })).status).toBe(409);
      }
    });

    it("keeps scoping and validation on guarded E-Way Bill updates", async () => {
      const base = { orderId: id.order, documentDate: iso(-1), validUntil: iso(2), supplierName: "Delhi Traders", recipientName: "Delhi Traders Retail", placeOfDispatch: "Gurugram", placeOfDelivery: "New Delhi", goodsDescription: "Synthetic scoping" };
      const created = await request(app).post("/api/eway-bills").set(auth(dispatcher)).send({ ...base, ewbNumber: "391000000066" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const ewb = created.body.id as number;
      expect((await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(B)).send({ reason: "Other company" })).status).toBe(404);
      expect((await request(app).patch(`/api/eway-bills/${ewb}`).set(auth(B)).send({ goodsDescription: "x" })).status).toBe(404);
      expect((await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(employee)).send({ reason: "No permission" })).status).toBe(403);
      expect((await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(driverUser)).send({ reason: "No permission" })).status).toBe(403);
      expect((await request(app).post(`/api/eway-bills/${ewb}/cancel`).set(auth(dispatcher)).send({ reason: "no" })).status).toBe(400);
      // A duplicate number is still a conflict, not a server error.
      expect((await request(app).patch(`/api/eway-bills/${ewb}`).set(auth(dispatcher)).send({ ewbNumber: "391000000001" })).status).toBe(409);
      const actions = ((await request(app).get(`/api/eway-bills/${ewb}/history`).set(auth(A))).body as Array<{ action: string }>).map((e) => e.action);
      expect(actions).toEqual(["ewaybill.recorded"]); // none of the refused requests wrote history
      expect((await request(app).get(`/api/eway-bills/${ewb}`).set(auth(A))).body.status).toBe("ACTIVE");
    });
  });
});
