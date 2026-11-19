import { describe, expect, it } from "vitest";
import { ComplianceSettingsSchema } from "../../src/modules/company/settings";
import { evaluateDriver, evaluateShipment, evaluateVehicle, KYC_HIDDEN_MESSAGE, pickBest, redactCompliance, type DocLike } from "../../src/modules/compliance/compliance";

const AT = new Date("2026-11-18T06:00:00Z");
const day = (n: number) => new Date(AT.getTime() + n * 86_400_000);
const settings = (over: Record<string, unknown> = {}) => ComplianceSettingsSchema.parse(over);
let nextId = 1;
const doc = (type: string, expiresInDays: number | null, verificationStatus: DocLike["verificationStatus"] = "VERIFIED"): DocLike => ({
  id: nextId++,
  type,
  documentNumber: `${type}-${nextId}`,
  expiresOn: expiresInDays === null ? null : day(expiresInDays),
  verificationStatus,
});
const fullSet = () => ["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT"].map((t) => doc(t, t === "RC" ? null : 200));
const truck = (documents: DocLike[], fuelType = "DIESEL") => ({ type: "TRUCK", fuelType, documents });

describe("compliance engine — vehicles", () => {
  it("is compliant with every required document valid and verified", () => {
    const c = evaluateVehicle(truck(fullSet()), settings(), 30, AT);
    expect(c.overall).toBe("COMPLIANT");
    expect(c.eligible).toBe(true);
    expect(c.blockers).toEqual([]);
  });

  it("blocks on an expired mandatory document with the established message", () => {
    const docs = fullSet().map((d) => (d.type === "INSURANCE" ? { ...d, expiresOn: day(-1) } : d));
    const c = evaluateVehicle(truck(docs), settings(), 30, AT);
    expect(c.eligible).toBe(false);
    expect(c.overall).toBe("EXPIRED");
    expect(c.blockers).toEqual([`INSURANCE expired on ${day(-1).toISOString().slice(0, 10)}`]);
  });

  it("uses the renewed copy when an old expired copy is still on file", () => {
    const docs = [...fullSet().filter((d) => d.type !== "INSURANCE"), doc("INSURANCE", -10), doc("INSURANCE", 300)];
    const c = evaluateVehicle(truck(docs), settings(), 30, AT);
    expect(c.eligible).toBe(true);
    expect(c.items.find((i) => i.type === "INSURANCE")!.state).toBe("COMPLIANT");
  });

  it("flags missing documents but only blocks when the company opts in", () => {
    const docs = fullSet().filter((d) => d.type !== "FITNESS");
    const lenient = evaluateVehicle(truck(docs), settings(), 30, AT);
    expect(lenient.eligible).toBe(true);
    expect(lenient.overall).toBe("MISSING");
    expect(lenient.warnings.join()).toMatch(/Fitness certificate has not been added/);
    const strict = evaluateVehicle(truck(docs), settings({ blockOnMissing: true }), 30, AT);
    expect(strict.eligible).toBe(false);
    expect(strict.blockers.join()).toMatch(/Fitness certificate has not been added/);
  });

  it("treats a type whose only copies were rejected like a missing one", () => {
    const docs = [...fullSet().filter((d) => d.type !== "PUC"), doc("PUC", 100, "REJECTED")];
    const c = evaluateVehicle(truck(docs), settings({ blockOnMissing: true }), 30, AT);
    expect(c.items.find((i) => i.type === "PUC")!.state).toBe("REJECTED");
    expect(c.eligible).toBe(false);
  });

  it("reports pending verification and blocks only with blockOnUnverified", () => {
    const docs = fullSet().map((d) => (d.type === "PERMIT" ? { ...d, verificationStatus: "PENDING" as const } : d));
    expect(evaluateVehicle(truck(docs), settings(), 30, AT).overall).toBe("PENDING_VERIFICATION");
    expect(evaluateVehicle(truck(docs), settings(), 30, AT).eligible).toBe(true);
    expect(evaluateVehicle(truck(docs), settings({ blockOnUnverified: true }), 30, AT).eligible).toBe(false);
  });

  it("warns (never blocks) when a document expires within the alert window", () => {
    const docs = fullSet().map((d) => (d.type === "PUC" ? { ...d, expiresOn: day(10) } : d));
    const c = evaluateVehicle(truck(docs), settings(), 30, AT);
    expect(c.overall).toBe("EXPIRING_SOON");
    expect(c.eligible).toBe(true);
    expect(c.warnings.join()).toMatch(/PUC certificate expires on .* \(10 days\)/);
  });

  it("does not require PUC for electric vehicles, but still reports an expired copy", () => {
    const noPuc = fullSet().filter((d) => d.type !== "PUC");
    const ev = evaluateVehicle(truck(noPuc, "ELECTRIC"), settings({ blockOnMissing: true }), 30, AT);
    expect(ev.eligible).toBe(true);
    expect(ev.items.find((i) => i.type === "PUC")!.state).toBe("NOT_APPLICABLE");
    const withExpired = evaluateVehicle(truck([...noPuc, doc("PUC", -5)], "ELECTRIC"), settings(), 30, AT);
    expect(withExpired.eligible).toBe(true);
    expect(withExpired.warnings.join()).toMatch(/PUC expired/);
  });

  it("follows company-configured requirements and exemptions", () => {
    const s = settings({ vehicleRequirements: [{ type: "RC" }, { type: "PERMIT", exemptVehicleTypes: ["VAN"] }] });
    const van = evaluateVehicle({ type: "VAN", fuelType: "DIESEL", documents: [doc("RC", null)] }, { ...s, blockOnMissing: true }, 30, AT);
    expect(van.eligible).toBe(true);
    const trk = evaluateVehicle({ type: "TRUCK", fuelType: "DIESEL", documents: [doc("RC", null)] }, { ...s, blockOnMissing: true }, 30, AT);
    expect(trk.eligible).toBe(false);
    expect(trk.blockers.join()).toMatch(/Permit/);
  });

  it("warns about an expired optional document without blocking", () => {
    const c = evaluateVehicle(truck([...fullSet(), doc("FASTAG", -3)]), settings(), 30, AT);
    expect(c.eligible).toBe(true);
    expect(c.warnings.join()).toMatch(/FASTAG expired/);
  });
});

describe("compliance engine — drivers", () => {
  const driver = (licenseExpiry: Date, documents: DocLike[] = [doc("DRIVING_LICENSE", 400)], status = "AVAILABLE") => ({ status, licenseExpiry, documents });

  it("always blocks an expired licence on the driver record", () => {
    const c = evaluateDriver(driver(day(-2)), settings(), 30, AT);
    expect(c.eligible).toBe(false);
    expect(c.blockers).toEqual([`Driving licence expired on ${day(-2).toISOString().slice(0, 10)}`]);
  });

  it("uses the record expiry even when the uploaded copy says otherwise, and warns about the mismatch", () => {
    const c = evaluateDriver(driver(day(400), [doc("DRIVING_LICENSE", 100)]), settings(), 30, AT);
    expect(c.eligible).toBe(true);
    expect(c.warnings.join()).toMatch(/differs from the driver record/);
  });

  it("flags a missing licence copy and blocks only with blockOnMissing", () => {
    expect(evaluateDriver(driver(day(400), []), settings(), 30, AT).overall).toBe("MISSING");
    expect(evaluateDriver(driver(day(400), []), settings(), 30, AT).eligible).toBe(true);
    expect(evaluateDriver(driver(day(400), []), settings({ blockOnMissing: true }), 30, AT).eligible).toBe(false);
  });

  it("only checks the record when no licence copy is required", () => {
    const c = evaluateDriver(driver(day(400), []), settings({ driverRequirements: [], blockOnMissing: true }), 30, AT);
    expect(c.eligible).toBe(true);
    expect(c.overall).toBe("COMPLIANT");
  });

  it("blocks inactive drivers", () => {
    expect(evaluateDriver(driver(day(400), undefined, "INACTIVE"), settings(), 30, AT).blockers).toContain("Driver is inactive");
  });
});

describe("compliance engine — shipment documents", () => {
  const order = (declaredValue: number | null, ewayBills: Array<{ ewbNumber: string; validUntil: Date | null; vehicleNumber: string | null; status: string }> = []) => ({
    id: 1,
    orderNumber: "ORD-1",
    declaredValue,
    ewayBills,
  });
  const ewb = (validInDays: number, vehicleNumber: string | null = "MH01AB1234", status = "ACTIVE") => ({ ewbNumber: "123456789012", validUntil: day(validInDays), vehicleNumber, status });

  it("does not expect an E-Way Bill at or below the threshold", () => {
    expect(evaluateShipment(order(50_000), settings(), AT).result.ewayBill.state).toBe("NOT_APPLICABLE");
  });

  it("flags a missing E-Way Bill above the threshold and blocks only when configured", () => {
    const lenient = evaluateShipment(order(75_000), settings(), AT);
    expect(lenient.result.ewayBill.state).toBe("MISSING");
    expect(lenient.blockers).toEqual([]);
    expect(lenient.warnings.join()).toMatch(/E-Way Bill expected/);
    expect(evaluateShipment(order(75_000), settings({ blockOnMissingShipmentDocs: true }), AT).blockers).toHaveLength(1);
  });

  it("detects expired and cancelled E-Way Bills", () => {
    expect(evaluateShipment(order(75_000, [ewb(-1)]), settings(), AT).result.ewayBill.state).toBe("EXPIRED");
    expect(evaluateShipment(order(75_000, [ewb(2, null, "CANCELLED")]), settings(), AT).result.ewayBill.state).toBe("MISSING");
    expect(evaluateShipment(order(75_000, [ewb(2)]), settings(), AT).result.ewayBill.state).toBe("COMPLIANT");
  });

  it("warns when the E-Way Bill names a different vehicle", () => {
    const r = evaluateShipment(order(75_000, [ewb(2, "MH01AB1234")]), settings(), AT, "MH 02 CD 9999");
    expect(r.warnings.join()).toMatch(/update Part-B/);
    expect(evaluateShipment(order(75_000, [ewb(2, "MH01AB1234")]), settings(), AT, "MH-01-AB-1234").warnings).toEqual([]);
  });

  it("reports unknown applicability when the declared value is missing, and can be switched off", () => {
    expect(evaluateShipment(order(null), settings(), AT).result.ewayBill.applicable).toBeNull();
    expect(evaluateShipment(order(1e6), settings({ ewayBillValueThreshold: null }), AT).result.ewayBill.state).toBe("NOT_APPLICABLE");
  });
});

describe("pickBest", () => {
  it("prefers no-expiry, then latest expiry, ignoring rejected copies", () => {
    const a = doc("RC", 10);
    const b = doc("RC", null);
    const c = { ...doc("RC", 999), verificationStatus: "REJECTED" as const };
    expect(pickBest([a, b, c]).doc).toBe(b);
    expect(pickBest([c]).onlyRejected).toBe(true);
    expect(pickBest([]).doc).toBeNull();
  });
});

describe("settings defaults", () => {
  it("parse to the documented defaults", () => {
    const s = settings();
    expect(s.vehicleRequirements.map((r) => r.type)).toEqual(["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT"]);
    expect(s.vehicleRequirements.find((r) => r.type === "PUC")!.exemptFuelTypes).toEqual(["ELECTRIC"]);
    expect(s.blockOnMissing).toBe(false);
    expect(s.ewayBillValueThreshold).toBe(50000);
  });
});

describe("redactCompliance (role-based trimming)", () => {
  const withKyc = () =>
    evaluateDriver(
      { status: "AVAILABLE", licenseExpiry: day(400), documents: [doc("DRIVING_LICENSE", 400), { ...doc("KYC_ID", null, "PENDING"), documentNumber: "XXXX-XXXX-1234" }] },
      settings({ driverRequirements: ["DRIVING_LICENSE", "KYC_ID"], blockOnUnverified: true }),
      30,
      AT,
    );

  it("keeps everything for admins/managers", () => {
    const c = withKyc();
    expect(redactCompliance(c, { kyc: true, documents: true })).toEqual(c);
  });

  it("removes KYC items and replaces their messages, keeping eligibility", () => {
    const c = withKyc();
    expect(c.eligible).toBe(false); // the unverified KYC proof blocks
    const r = redactCompliance(c, { kyc: false, documents: true });
    expect(r.items.map((i) => i.type)).toEqual(["DRIVING_LICENSE"]);
    expect(r.eligible).toBe(false);
    expect(r.blockers).toEqual([KYC_HIDDEN_MESSAGE]);
    expect(JSON.stringify(r)).not.toMatch(/KYC_ID|KYC identity|XXXX/);
    expect(r.items[0].documentNumber).toBe(c.items[0].documentNumber);
  });

  it("blanks document numbers and ids without documents:read", () => {
    const r = redactCompliance(withKyc(), { kyc: false, documents: false });
    expect(r.items.every((i) => i.documentNumber === null && i.documentId === null)).toBe(true);
  });

  it("leaves results without KYC items untouched apart from numbers", () => {
    const c = evaluateVehicle(truck(fullSet()), settings(), 30, AT);
    expect(redactCompliance(c, { kyc: false, documents: true })).toEqual(c);
  });
});
