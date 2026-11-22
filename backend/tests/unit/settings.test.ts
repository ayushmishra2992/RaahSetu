import { describe, expect, it } from "vitest";
import { applySettingsPatch, mergeSettings, parseSettings } from "../../src/modules/company/settings";

describe("mergeSettings", () => {
  it("merges nested objects key by key and keeps untouched keys", () => {
    const base = { a: 1, nested: { x: 1, y: 2 }, keep: "yes" };
    expect(mergeSettings(base, { nested: { y: 3 } })).toEqual({ a: 1, nested: { x: 1, y: 3 }, keep: "yes" });
  });

  it("replaces arrays and scalars instead of merging them", () => {
    expect(mergeSettings({ list: [1, 2, 3], n: 1 }, { list: [9], n: 2 })).toEqual({ list: [9], n: 2 });
    expect(mergeSettings({ list: [1, 2] }, { list: [] })).toEqual({ list: [] });
  });

  it("ignores undefined values and prototype-polluting keys", () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "a": 2}');
    const out = mergeSettings({ a: 1, b: 1 }, { ...patch, b: undefined }) as Record<string, unknown>;
    expect(out).toEqual({ a: 2, b: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not mutate its inputs", () => {
    const base = { nested: { x: 1 } };
    mergeSettings(base, { nested: { x: 2 } });
    expect(base).toEqual({ nested: { x: 1 } });
  });
});

describe("applySettingsPatch", () => {
  const custom = parseSettings({ compliance: { blockOnMissing: true, driverRequirements: [], ewayBillValueThreshold: null }, documentExpiryAlertDays: 45 });

  it("changing one section never resets another (the reported bug)", () => {
    const r = applySettingsPatch(custom, { fuelPricePerUnit: { DIESEL: 99 } });
    expect(r.success).toBe(true);
    const s = r.data!;
    expect(s.fuelPricePerUnit.DIESEL).toBe(99);
    expect(s.fuelPricePerUnit.PETROL).toBe(custom.fuelPricePerUnit.PETROL);
    expect(s.compliance.blockOnMissing).toBe(true);
    expect(s.compliance.driverRequirements).toEqual([]);
    expect(s.compliance.ewayBillValueThreshold).toBeNull();
    expect(s.documentExpiryAlertDays).toBe(45);
  });

  it("partial compliance updates keep the rest of the policy", () => {
    const r = applySettingsPatch(custom, { compliance: { blockOnUnverified: true } });
    expect(r.data!.compliance).toMatchObject({ blockOnMissing: true, blockOnUnverified: true, driverRequirements: [], ewayBillValueThreshold: null });
    expect(r.data!.compliance.vehicleRequirements.map((v) => v.type)).toEqual(["RC", "INSURANCE", "PUC", "FITNESS", "PERMIT"]);
  });

  it("validates the merged result as a whole", () => {
    expect(applySettingsPatch(custom, { documentExpiryAlertDays: 0 }).success).toBe(false);
    expect(applySettingsPatch(custom, { compliance: { vehicleRequirements: [{ type: "NOT_A_DOC" }] } }).success).toBe(false);
    expect(applySettingsPatch(custom, { compliance: { ewayBillValueThreshold: -5 } }).success).toBe(false);
  });

  it("drops unknown keys rather than storing them", () => {
    const r = applySettingsPatch(custom, { somethingElse: { deep: 1 } });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).somethingElse).toBeUndefined();
  });

  it("starts from defaults when nothing valid is stored", () => {
    const r = applySettingsPatch(null, { compliance: { blockOnMissing: true } });
    expect(r.data!.compliance.blockOnMissing).toBe(true);
    expect(r.data!.documentExpiryAlertDays).toBe(30);
  });
});
